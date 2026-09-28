#!/usr/bin/env bash
# Mashahd — Vercel auto-deploy monitor (Pass 88 Rec #2)
#
# After every `git push origin main`, this script:
#   1. Polls https://mashahd.vercel.app/api/ready every 30s for up to 5 min.
#   2. Queries the Vercel REST API to find the latest production deployment.
#   3. Verifies the latest deployment's gitSha matches the local HEAD.
#   4. Alerts (exit 1 + stderr) if no new deploy within 5 min, OR if the
#      deployed gitSha doesn't match local HEAD (stale production).
#
# This guards against the Pass 84 incident where Vercel auto-deploy was
# stuck for 10+ minutes and the operator had no idea.
#
# Usage:
#   git push origin main && bash scripts/monitor-deploy.sh
#   # OR after a manual REST API trigger:
#   bash scripts/monitor-deploy.sh
#
# Requirements:
#   - VERCEL_TOKEN env var (from https://vercel.com/account/tokens)
#   - curl + python3
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo "$(dirname "$0")/..")"

TOKEN="${VERCEL_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "ERROR: VERCEL_TOKEN env var required." >&2
  echo "  VERCEL_TOKEN=<token> bash scripts/monitor-deploy.sh" >&2
  echo "Get a token from: https://vercel.com/account/tokens" >&2
  exit 1
fi

TEAM_ID="team_bVAdJfvsNGW6Os3KxkhvHoq8"
PROJECT="mashahd"
PRODUCTION_URL="https://mashahd.vercel.app"
READY_ENDPOINT="$PRODUCTION_URL/api/ready"

LOCAL_SHA=$(git rev-parse HEAD)
LOCAL_SHORT=$(echo "$LOCAL_SHA" | cut -c1-12)

echo "Monitoring Vercel deploy for local HEAD: $LOCAL_SHORT"
echo "Production URL: $PRODUCTION_URL"
echo ""

# ── Phase 1: poll /api/ready every 30s for up to 5 min ──
echo "Phase 1: polling $READY_ENDPOINT every 30s (max 5 min)..."
READY_DETECTED_AT=""
for i in $(seq 1 10); do
  HTTP_CODE=$(curl -sS -o /dev/null -w "%{http_code}" --max-time 10 "$READY_ENDPOINT" 2>/dev/null || echo "000")
  TS=$(date -u +%H:%M:%S)
  if [ "$HTTP_CODE" = "200" ]; then
    echo "  [$TS] /api/ready → HTTP 200 ✓ (production is up)"
    READY_DETECTED_AT="$TS"
    break
  else
    echo "  [$TS] /api/ready → HTTP $HTTP_CODE (waiting...)"
  fi
  sleep 30
done

if [ -z "$READY_DETECTED_AT" ]; then
  echo ""
  echo "⚠ /api/ready did NOT return 200 within 5 min." >&2
  echo "  Production may be down OR the deploy hasn't finished yet." >&2
  echo "  Manual check: curl -sS $READY_ENDPOINT" >&2
  # Don't exit 1 yet — the deploy might just be slow. Continue to Phase 2.
fi

# ── Phase 2: query Vercel REST API for latest production deploy ──
echo ""
echo "Phase 2: fetching latest Vercel production deployment..."
sleep 5  # give Vercel a moment to register the new deploy

LATEST_DEPLOY=$(curl -sS "https://api.vercel.com/v6/deployments?app=$PROJECT&teamId=$TEAM_ID&limit=5&target=production" \
  -H "Authorization: Bearer $TOKEN")

DEPLOYED_SHA=$(echo "$LATEST_DEPLOY" | python3 -c "
import sys, json
d = json.load(sys.stdin)
deployments = d.get('deployments', [])
if not deployments:
    print('NONE')
else:
    # Find the most recent READY production deployment
    for dep in deployments:
        if dep.get('readyState') == 'READY':
            sha = dep.get('meta', {}).get('githubCommitSha', '')
            print(sha[:12])
            sys.exit(0)
    # If none READY, return the latest's state
    print('NOT_READY')
" 2>/dev/null || echo "PARSE_ERROR")

TS=$(date -u +%H:%M:%S)
echo "  [$TS] Latest Vercel production deploy gitSha: $DEPLOYED_SHA"
echo "  [$TS] Local HEAD:                          $LOCAL_SHORT"

# ── Phase 3: verify deployed gitSha matches local HEAD ──
echo ""
echo "Phase 3: verifying deployed gitSha matches local HEAD..."
if [ "$DEPLOYED_SHA" = "NONE" ] || [ "$DEPLOYED_SHA" = "PARSE_ERROR" ]; then
  echo "✗ Could not fetch latest Vercel deploy (token may be invalid or no deploys exist)." >&2
  exit 1
elif [ "$DEPLOYED_SHA" = "NOT_READY" ]; then
  echo "⚠ Latest production deploy is NOT READY (still building or failed)." >&2
  echo "  Check Vercel dashboard: https://vercel.com/fortleem/$PROJECT" >&2
  exit 1
elif [ "$DEPLOYED_SHA" = "$LOCAL_SHORT" ]; then
  echo "✓ Deployed gitSha matches local HEAD — production is in sync."
  exit 0
else
  echo "✗ STALE PRODUCTION — deployed gitSha ($DEPLOYED_SHA) ≠ local HEAD ($LOCAL_SHORT)." >&2
  echo "  Vercel auto-deploy may be stuck. Trigger manual deploy:" >&2
  echo "    curl -X POST 'https://api.vercel.com/v13/deployments?teamId=$TEAM_ID' \\" >&2
  echo "      -H 'Authorization: Bearer \$VERCEL_TOKEN' \\" >&2
  echo "      -H 'Content-Type: application/json' \\" >&2
  echo "      -d '{\"name\":\"$PROJECT\",\"gitSource\":{\"type\":\"github\",\"org\":\"cirkle-superapp\",\"repo\":\"mashahd\",\"ref\":\"$LOCAL_SHA\"},\"target\":\"production\"}'" >&2
  exit 1
fi
