#!/usr/bin/env bash
# Mashahd — Protected File Verifier (proactive restoration)
#
# This script is the SECOND line of defense against the recurring
# "upload route got deleted" bug. The pre-commit hook only fires on
# `git commit` — but files can be deleted in the working tree between
# commits (by editors, build cleaners, or accidental rm). This script
# RESTORES any missing protected file immediately from HEAD.
#
# Wire it into package.json as a `predev` / `prebuild` / `prestart` hook
# so it runs before every dev session and every build.
#
# Usage:
#   ./scripts/verify-protected.sh           # check + restore, exit 0
#   ./scripts/verify-protected.sh --check   # check only, exit 1 if missing
set -euo pipefail

cd "$(git rev-parse --show-toplevel 2>/dev/null || echo "$(dirname "$0")/..")"

CHECK_ONLY=0
if [ "${1:-}" = "--check" ]; then
  CHECK_ONLY=1
fi

# ── Protected files (must match .git/hooks/pre-commit) ──
ESSENTIAL_FILES=(
  # API routes
  "src/app/api/route.ts"
  "src/app/api/seed/route.ts"
  "src/app/api/ready/route.ts"
  "src/app/api/user-state/route.ts"
  "src/app/api/videos/route.ts"
  "src/app/api/videos/[id]/route.ts"
  "src/app/api/videos/[id]/comments/route.ts"
  "src/app/api/videos/[id]/like/route.ts"
  "src/app/api/videos/[id]/views/route.ts"
  "src/app/api/channels/[id]/route.ts"
  "src/app/api/channels/[id]/subscribe/route.ts"
  "src/app/api/clips/route.ts"
  "src/app/api/clips/[id]/route.ts"
  "src/app/api/playlists/route.ts"
  "src/app/api/playlists/[id]/route.ts"
  "src/app/api/playlists/[id]/items/route.ts"
  "src/app/api/auth/check-username/route.ts"
  "src/app/api/auth/login/route.ts"
  "src/app/api/auth/logout/route.ts"
  "src/app/api/auth/register/route.ts"
  "src/app/api/auth/session/route.ts"
  "src/app/api/ai/chapters/route.ts"
  "src/app/api/ai/oracle/route.ts"
  "src/app/api/ai/starters/route.ts"
  "src/app/api/ai/summarize/route.ts"
  "src/app/api/ai/tone/route.ts"
  "src/app/api/ai/translate/route.ts"
  "src/app/api/ai/trending-digest/route.ts"
  "src/app/api/ai/transcript/route.ts"
  "src/app/api/media/health/route.ts"
  "src/app/api/media/telemetry/route.ts"
  "src/app/api/media/videos/route.ts"
  "src/app/api/media/presign-upload/route.ts"
  "src/app/api/media/upload-complete/route.ts"
  "src/app/api/media/videos/[id]/playback/route.ts"
  "src/app/api/media/videos/[id]/status/route.ts"
  "src/app/api/media/videos/[id]/upload/route.ts"
  "src/app/api/media/videos/[id]/delete/route.ts"
  "src/app/api/media/videos/[id]/manifest/[...path]/route.ts"
  "src/app/api/analytics/route.ts"
  "src/app/api/metrics/route.ts"
  "src/app/api/cost-dashboard/route.ts"
  "src/app/api/decisions/route.ts"
  "src/app/api/inngest/route.ts"
  "src/app/api/webhooks/brevo/route.ts"
  # Lib modules
  "src/lib/ai-provider.ts" "src/lib/blob-storage.ts" "src/lib/circuit-breaker.ts"
  "src/lib/content-gc.ts" "src/lib/db.ts" "src/lib/decision-record.ts"
  "src/lib/delivery-scheduler.ts" "src/lib/demand-transcoder.ts" "src/lib/economy-state.ts"
  "src/lib/email-service.ts" "src/lib/failure-taxonomy.ts" "src/lib/feature-flags.ts"
  "src/lib/format.ts" "src/lib/heat-predictor.ts" "src/lib/inngest-jobs.ts"
  "src/lib/job-manager.ts" "src/lib/lan-optimization.ts" "src/lib/local-media-cache.ts"
  "src/lib/mashahd-bridge.ts" "src/lib/media-object.ts" "src/lib/media-reconciliation.ts"
  "src/lib/media-transport.ts" "src/lib/media-worker.ts" "src/lib/metrics-store.ts"
  "src/lib/migration-safety.ts" "src/lib/neon-analytics.ts" "src/lib/neon-recovery.ts"
  "src/lib/notification-service.ts" "src/lib/outbox-processor.ts" "src/lib/p2p-policy.ts"
  "src/lib/peer-scorer.ts" "src/lib/placement-engine.ts" "src/lib/rate-limiter.ts"
  "src/lib/request-coalescer.ts" "src/lib/request-priority.ts" "src/lib/resource-governor.ts"
  "src/lib/scarcity-engine.ts" "src/lib/seed-data.ts" "src/lib/signed-urls.ts"
  "src/lib/sms-service.ts" "src/lib/source-retention.ts" "src/lib/storage-quota-governor.ts"
  "src/lib/storage-replication.ts" "src/lib/storage.ts" "src/lib/swarm.ts"
  "src/lib/turso-db.ts" "src/lib/types.ts" "src/lib/user-state.ts" "src/lib/utils.ts"
  "src/lib/webhook-security.ts"
  # Server-lib
  "server-lib/filebase-storage.ts"
  # Stores
  "src/store/app-store.ts" "src/store/command-palette-store.ts" "src/store/mini-player-store.ts"
  # Entry + error boundaries
  "src/app/page.tsx" "src/app/layout.tsx" "src/app/error.tsx" "src/app/global-error.tsx"
  "src/app/providers.tsx"
  "prisma/schema.prisma"
  # Mini-services
  "mini-services/p2p-tracker/index.ts" "mini-services/watch-party/index.ts"
)

MISSING=()
RESTORED=0

for f in "${ESSENTIAL_FILES[@]}"; do
  if [ ! -e "$f" ]; then
    # Only attempt restore if the file exists in HEAD.
    if git cat-file -e "HEAD:$f" 2>/dev/null; then
      MISSING+=("$f")
      if [ "$CHECK_ONLY" -eq 0 ]; then
        mkdir -p "$(dirname "$f")"
        git checkout HEAD -- "$f" 2>/dev/null && RESTORED=$((RESTORED + 1)) || true
      fi
    fi
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  PROTECTED FILE VERIFICATION — ${#MISSING[@]} missing"
  echo "═══════════════════════════════════════════════════════════════"
  for f in "${MISSING[@]}"; do
    if [ "$CHECK_ONLY" -eq 0 ]; then
      echo "  ↻ restored: $f"
    else
      echo "  ✗ missing:  $f"
    fi
  done
  if [ "$CHECK_ONLY" -eq 0 ] && [ "$RESTORED" -gt 0 ]; then
    echo ""
    echo "  ✓ Restored $RESTORED protected file(s) from HEAD."
  fi
  echo ""
  if [ "$CHECK_ONLY" -eq 1 ]; then
    exit 1
  fi
else
  # Silent on success when run as a predev/prebuild hook (no output = no noise).
  if [ "${MASHAHD_VERBOSE:-0}" = "1" ]; then
    echo "✓ All ${#ESSENTIAL_FILES[@]} protected files present."
  fi
fi

exit 0
