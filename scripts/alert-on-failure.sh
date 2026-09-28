#!/usr/bin/env bash
# Mashahd — Service failure alerter (Pass 88 Rec #7)
#
# Checks /api/cost-dashboard + /api/env-health on production and alerts
# if any of the 5 services (Turso + Vercel + Inngest + Neon + AI) is
# not HEALTHY, or if any required env var is missing.
#
# Wire this as a cron job on a monitoring host (NOT on the production
# server — if production is down, the cron host should still be up).
# Example crontab (runs every 5 min):
#   */5 * * * * VERCEL_TOKEN=<token> bash /path/to/scripts/alert-on-failure.sh >> /var/log/mashahd-alerts.log 2>&1
#
# Alert destinations:
#   - Logs to stdout/stderr (cron captures to the log file above)
#   - Optional webhook: set ALERT_WEBHOOK_URL env var to a Slack/Discord/
#     PagerDuty incoming webhook URL and the script will POST a JSON alert.
#
# Usage:
#   bash scripts/alert-on-failure.sh
#   ALERT_WEBHOOK_URL=https://hooks.slack.com/services/... bash scripts/alert-on-failure.sh
set -euo pipefail

PRODUCTION_URL="${MASHAHD_URL:-https://mashahd.vercel.app}"
WEBHOOK="${ALERT_WEBHOOK_URL:-}"

TS=$(date -u +%Y-%m-%dT%H:%M:%SZ)
ALERTS=()

echo "[$TS] Checking Mashahd production: $PRODUCTION_URL"

# ── Check 1: /api/ready ──
READY_HTTP=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$PRODUCTION_URL/api/ready" 2>/dev/null || echo "000")
if [ "$READY_HTTP" = "200" ]; then
  echo "  ✓ /api/ready → 200"
else
  echo "  ✗ /api/ready → $READY_HTTP" >&2
  ALERTS+=("/api/ready returned $READY_HTTP (expected 200)")
fi

# ── Check 2: /api/cost-dashboard (all 5 services) ──
COST_RESP=$(curl -sS --max-time 15 "$PRODUCTION_URL/api/cost-dashboard" 2>/dev/null || echo "{}")

# Parse the response and check each service's status
COST_CHECK=$(echo "$COST_RESP" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception as e:
    print('PARSE_ERROR: ' + str(e))
    sys.exit(0)

alerts = []
for svc in ['turso', 'vercel', 'inngest', 'neon']:
    s = d.get(svc, {})
    status = s.get('status', 'UNKNOWN')
    if status != 'HEALTHY':
        alerts.append(f'{svc}: status={status}')
    # For Turso, also check circuit state
    if svc == 'turso' and s.get('circuitState', '') not in ['CLOSED', 'HALF_OPEN']:
        alerts.append(f'turso: circuitState={s.get(\"circuitState\",\"?\")} (expected CLOSED)')

# AI providers
ai = d.get('ai', {})
if ai.get('status', 'UNKNOWN') != 'HEALTHY':
    alerts.append(f'ai: status={ai.get(\"status\",\"?\")}')
if ai.get('activeCount', 0) < 5:
    alerts.append(f'ai: activeCount={ai.get(\"activeCount\",0)}/5 (expected 5/5)')

# Cost summary
cost = d.get('costSummary', {}).get('platformMonthlyCost', '?')
print('COST:' + str(cost))

if alerts:
    print('|'.join(alerts))
" 2>/dev/null || echo "PARSE_ERROR")

COST_LINE=$(echo "$COST_CHECK" | head -1)
ALERTS_LINE=$(echo "$COST_CHECK" | tail -1)

if [ "$COST_LINE" = "PARSE_ERROR" ]; then
  echo "  ✗ /api/cost-dashboard → could not parse response" >&2
  ALERTS+=("/api/cost-dashboard response unparseable")
elif echo "$COST_LINE" | grep -q "^COST:"; then
  COST=$(echo "$COST_LINE" | sed 's/^COST://')
  echo "  ✓ /api/cost-dashboard → cost: $COST"
  if [ -n "$ALERTS_LINE" ] && [ "$ALERTS_LINE" != "$COST_LINE" ]; then
    echo "  ✗ Service health issues found:" >&2
    IFS='|' read -ra ISSUES <<< "$ALERTS_LINE"
    for issue in "${ISSUES[@]}"; do
      echo "    - $issue" >&2
      ALERTS+=("$issue")
    done
  fi
fi

# ── Check 3: /api/env-health (always-required env vars) ──
ENV_RESP=$(curl -sS --max-time 15 "$PRODUCTION_URL/api/env-health" 2>/dev/null || echo "{}")

ENV_CHECK=$(echo "$ENV_RESP" | python3 -c "
import sys, json
try:
    d = json.load(sys.stdin)
except Exception as e:
    print('PARSE_ERROR')
    sys.exit(0)

alerts = []
for svc_name, svc in d.get('services', {}).items():
    # For vercel, check alwaysRequired (not devOnly — those are intentionally missing on Vercel)
    if svc_name == 'vercel':
        req = svc.get('alwaysRequired', {})
        for k, v in req.items():
            if not v:
                alerts.append(f'vecel.alwaysRequired.{k} is missing')
    else:
        # For other services, check the 'configured' flag
        if not svc.get('configured', False):
            alerts.append(f'{svc_name}: configured=false')

# Interconnection matrix
ic = d.get('interconnection', {})
for k, v in ic.items():
    if v is not True and not isinstance(v, str):
        alerts.append(f'interconnection.{k} = {v} (expected true)')

if alerts:
    print('|'.join(alerts))
" 2>/dev/null || echo "PARSE_ERROR")

if [ "$ENV_CHECK" = "PARSE_ERROR" ]; then
  echo "  ✗ /api/env-health → could not parse response" >&2
  ALERTS+=("/api/env-health response unparseable")
elif [ -n "$ENV_CHECK" ]; then
  echo "  ✗ Env var issues:" >&2
  IFS='|' read -ra ISSUES <<< "$ENV_CHECK"
  for issue in "${ISSUES[@]}"; do
    echo "    - $issue" >&2
    ALERTS+=("$issue")
  done
else
  echo "  ✓ /api/env-health → all services configured"
fi

# ── Send alerts ──
ALERT_COUNT=${#ALERTS[@]}
echo ""
if [ "$ALERT_COUNT" -eq 0 ]; then
  echo "[$TS] ✓ All 5 services HEALTHY. No alerts."
  exit 0
else
  MSG="🚨 Mashahd production alert ($ALERT_COUNT issue(s)) at $TS:"
  for a in "${ALERTS[@]}"; do
    MSG="$MSG
  - $a"
  done
  MSG="$MSG

Production URL: $PRODUCTION_URL
Runbook: see OPERATIONS_RUNBOOK.md (§2.2 root cause matrix)"

  echo "$MSG" >&2

  # Optional webhook (Slack/Discord/PagerDuty)
  if [ -n "$WEBHOOK" ]; then
    curl -sS -X POST "$WEBHOOK" \
      -H "Content-Type: application/json" \
      -d "{\"text\":\"$(echo "$MSG" | sed 's/\\n/\\\\n/g')\"}" \
      > /dev/null 2>&1 || true
    echo "  → alert sent to webhook"
  fi

  exit 1
fi
