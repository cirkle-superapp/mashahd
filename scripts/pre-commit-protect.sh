#!/usr/bin/env bash
# Mashahd — Pre-commit hook: structural protection
#
# Blocks commits that would delete essential files. Essential files are the
# core source of the app — they must never be removed without an explicit,
# deliberate force flag (MASHAHD_ALLOW_DELETE=1).
#
# This prevents the recurring "upload route got deleted" class of bug.
set -euo pipefail

# The list of essential files — every core route, component, lib, hook.
# Adding to this list is encouraged as the codebase grows.
ESSENTIAL_FILES=(
  # API routes (all 32)
  "src/app/api/route.ts"
  "src/app/api/seed/route.ts"
  "src/app/api/user-state/route.ts"
  "src/app/api/videos/route.ts"
  "src/app/api/videos/[id]/route.ts"
  "src/app/api/videos/[id]/comments/route.ts"
  "src/app/api/videos/[id]/like/route.ts"
  "src/app/api/videos/[id]/views/route.ts"
  "src/app/api/channels/[id]/route.ts"
  "src/app/api/channels/[id]/subscribe/route.ts"
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
  "src/app/api/media/health/route.ts"
  "src/app/api/media/telemetry/route.ts"
  "src/app/api/media/videos/route.ts"
  "src/app/api/media/videos/[id]/playback/route.ts"
  "src/app/api/media/videos/[id]/status/route.ts"
  "src/app/api/media/videos/[id]/upload/route.ts"
  "src/app/api/media/videos/[id]/manifest/[...path]/route.ts"
  "src/app/api/playlists/route.ts"
  "src/app/api/playlists/[id]/route.ts"
  "src/app/api/playlists/[id]/items/route.ts"
  # Core lib modules
  "src/lib/db.ts"
  "src/lib/turso-db.ts"
  "src/lib/media-worker.ts"
  "src/lib/storage.ts"
  "src/lib/swarm.ts"
  "src/lib/p2p-policy.ts"
  "src/lib/rate-limiter.ts"
  "src/lib/user-state.ts"
  "src/lib/mashahd-bridge.ts"
  # Stores
  "src/store/app-store.ts"
  "src/store/command-palette-store.ts"
  "src/store/mini-player-store.ts"
  # Core entry
  "src/app/page.tsx"
  "src/app/layout.tsx"
  "prisma/schema.prisma"
  # Mini-services
  "mini-services/p2p-tracker/index.ts"
  "mini-services/watch-party/index.ts"
)

# Get the list of staged deletions.
DELETED=$(git diff --cached --name-only --diff-filter=D || true)

if [ -z "$DELETED" ]; then
  exit 0
fi

BLOCKED=""
for f in $DELETED; do
  for essential in "${ESSENTIAL_FILES[@]}"; do
    if [ "$f" = "$essential" ]; then
      BLOCKED="$BLOCKED\n  ✗ $f"
      break
    fi
  done
done

if [ -n "$BLOCKED" ]; then
  echo ""
  echo "═══════════════════════════════════════════════════════════════"
  echo "  COMMIT BLOCKED — Essential file deletion detected"
  echo "═══════════════════════════════════════════════════════════════"
  echo ""
  echo -e "The following essential files are being deleted:$BLOCKED"
  echo ""
  echo "These files are protected because they are core to the app."
  echo "If this deletion is intentional and necessary (e.g. a real"
  echo "refactor that moves the file), override with:"
  echo ""
  echo "  MASHAHD_ALLOW_DELETE=1 git commit ..."
  echo ""
  echo "Otherwise, restore the file(s) with:"
  echo "  git checkout HEAD -- <file>"
  echo ""
  exit 1
fi

exit 0
