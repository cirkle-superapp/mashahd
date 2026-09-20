#!/usr/bin/env bash
# Mashahd — .env Verifier (anti-stripping protection)
#
# The .env file has been STRIPPED of all credentials multiple times (recurring
# regression — tracked in worklog as "BROWSER_ID_SECRET removed from .env").
# This script ensures the critical env vars are always present, restoring them
# if a stray process or editor strips them.
#
# Wire it into package.json as a `predev` hook alongside verify-protected.sh:
#   "predev": "bash scripts/verify-protected.sh && bash scripts/ensure-env.sh"
#
# Usage:
#   ./scripts/ensure-env.sh           # check + restore, exit 0
#   ./scripts/ensure-env.sh --check   # check only, exit 1 if missing
set -euo pipefail

cd "$(dirname "$0")/.."

CHECK_ONLY=0
if [ "${1:-}" = "--check" ]; then
  CHECK_ONLY=1
fi

ENV_FILE=".env"
RESTORED=0
MISSING=()

# ── Critical env vars (with stable defaults for dev) ──
# These are the vars that, if missing, cause real bugs:
#   - BROWSER_ID_SECRET missing → 403s on every authenticated endpoint
#     (server falls back to a random per-process secret, invalidating all
#      browserIds on every dev restart)
#   - APP_URL missing → webhook/signature URLs use wrong base
#   - ALLOWED_ORIGINS missing → watch-party WS blocks cross-origin
#   - P2P_SIGNALING_URL missing → player can't find the tracker
# Production secrets (Turso, Neon, Inngest, Brevo, AI providers) are NOT
# included here — they're set in Vercel env vars for prod, and commented
# out in .env for dev.
declare -A REQUIRED_VARS=(
  ["APP_URL"]="http://localhost:3000"
  ["DATABASE_URL"]="file:/home/z/my-project/db/custom.db"
  ["BROWSER_ID_SECRET"]="mashahd-dev-stable-secret-9f3b7e2a8c1d4f6b0e5a2c8d7f1b4e9a"
  ["MEDIA_STORAGE_PATH"]="/home/z/my-project/storage"
  ["STORAGE_PROVIDER"]="local"
  ["FFMPEG_PATH"]="ffmpeg"
  ["FFPROBE_PATH"]="ffprobe"
  ["P2P_ENABLED"]="true"
  ["P2P_MAX_PEERS"]="6"
  ["P2P_MAX_UPLOAD_MBPS"]="2"
  ["P2P_MAX_UPLOAD_BYTES"]="262144000"
  ["P2P_SIGNALING_URL"]="ws://localhost:3003"
  ["P2P_BACKGROUND_ENABLED"]="false"
  ["P2P_LOW_BATTERY_MODE"]="true"
  ["TURN_ENABLED"]="false"
  ["ALLOWED_ORIGINS"]="http://localhost:3000"
)

# Read existing .env into an associative array.
declare -A EXISTING=()
if [ -f "$ENV_FILE" ]; then
  while IFS='=' read -r key value; do
    # Skip comments + blank lines.
    case "$key" in
      ""|\#*) continue ;;
    esac
    EXISTING["$key"]="$value"
  done < "$ENV_FILE"
fi

# Check each required var.
for key in "${!REQUIRED_VARS[@]}"; do
  if [ -z "${EXISTING[$key]:-}" ]; then
    MISSING+=("$key")
  fi
done

if [ ${#MISSING[@]} -gt 0 ]; then
  if [ "$CHECK_ONLY" -eq 0 ]; then
    # Restore: append the missing vars to .env.
    echo "" >> "$ENV_FILE"
    echo "# ── Restored by scripts/ensure-env.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ) ──" >> "$ENV_FILE"
    for key in "${MISSING[@]}"; do
      echo "$key=${REQUIRED_VARS[$key]}" >> "$ENV_FILE"
      RESTORED=$((RESTORED + 1))
    done
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "  .ENV VERIFICATION — ${#MISSING[@]} missing var(s) restored"
    echo "═══════════════════════════════════════════════════════════════"
    for key in "${MISSING[@]}"; do
      echo "  ↻ restored: $key"
    done
    echo ""
    echo "  ✓ Restored $RESTORED env var(s). Restart the dev server to pick them up."
    echo ""
  else
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "  .ENV VERIFICATION — ${#MISSING[@]} missing var(s)"
    echo "═══════════════════════════════════════════════════════════════"
    for key in "${MISSING[@]}"; do
      echo "  ✗ missing:  $key"
    done
    echo ""
    exit 1
  fi
fi

exit 0
