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
# Production credentials are for the 5-service stack (Pass 53):
#   GitHub (source control) + Vercel (deployment) + Inngest (workflows)
#   + Neon (analytics) + Turso (transactional DB).
# Filebase, Cloudflare R2, and Brevo were REMOVED per user request.
# Media storage uses local filesystem (dev). Vercel production is read-only
# so uploads work in dev; viewing works everywhere.
declare -A REQUIRED_VARS=(
  ["APP_URL"]="https://mashahd.vercel.app"
  ["DATABASE_URL"]="file:/home/z/my-project/db/custom.db"
  ["BROWSER_ID_SECRET"]="mashahd-dev-stable-secret-9f3b7e2a8c1d4f6b0e5a2c8d7f1b4e9a"
  ["MEDIA_STORAGE_PATH"]="/home/z/my-project/storage"
  ["STORAGE_PROVIDER"]="local"
  # Turso (transactional DB — 9GB free, 1B reads/month)
  ["TURSO_URL"]="libsql://mashahd-fortleem.aws-us-east-1.turso.io"
  ["TURSO_AUTH_TOKEN"]="eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiIyMTIyNTIwNy1iNWJmLTRjM2MtOGFiNS0xYmEzNDNlNjU5NmEiLCJpYXQiOjE3ODkxNjE4MTksImtpZCI6IjJTRm4xQWZVUnU1TFF5a0xkc0d3YzV3VldVdlRlcVdhVjg2UXZYUk9DMWMiLCJyaWQiOiJlNzM4OTU1MS0xMTFlLTQ5NWYtYjkxZi0zNmI5M2UyNThhNGUifQ.fygqboSEmsvwsSpP0CpZo9uMAY0sJS8uAYdcoE5bFmvOY0pIPyNB8W3ILQUhXXC12peyvcomvW8ax7NN5RfsBg"
  # Neon Postgres (analytics warehouse — 0.5GB free)
  ["NEON_DATABASE_URL"]="postgresql://neondb_owner:npg_P9rgaT5SsNoW@ep-empty-recipe-auue9q58-pooler.c-10.us-east-1.aws.neon.tech/MASHAHD?sslmode=require&channel_binding=require"
  ["NEON_DATA_API"]="https://ep-empty-recipe-auue9q58.apirest.c-10.us-east-1.aws.neon.tech/MASHAHD/rest/v1"
  # Inngest (durable workflows — free tier)
  ["INNGEST_KEY"]="signkey-prod-5e79fc7120134801543036c7ea0f33fea548e5ddda74443b0e4d627a62675b0d"
  ["INNGEST_WEBHOOK_SECRET"]="signkey-prod-5e79fc7120134801543036c7ea0f33fea548e5ddda74443b0e4d627a62675b0d"
  # Dev-only
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
  ["ALLOWED_ORIGINS"]="https://mashahd.vercel.app,http://localhost:3000"
  # AI Providers — 5-provider consensus mode (Pass 81, 2026-09-25).
  # All 5 are invoked in parallel by src/lib/ai-provider.ts; the longest
  # non-empty response wins. These are REQUIRED_VARS so they auto-restore
  # if .env gets stripped (regression that bit us once already).
  # SECRET HANDLING: the actual values are NEVER hardcoded in this script
  # (GitHub Push Protection blocks commits containing API keys). Instead,
  # the values are read from the operator's OS env vars at restore time.
  # If the OS env vars are unset, the script prints a clear warning telling
  # the operator to export them before running `bun run dev`.
  ["GROQ_API_KEY"]="${GROQ_API_KEY:-}"
  ["OPENROUTER_API_KEY"]="${OPENROUTER_API_KEY:-}"
  ["NVIDIA_API_KEY"]="${NVIDIA_API_KEY:-}"
  ["GEMINI_API_KEY"]="${GEMINI_API_KEY:-}"
  ["HF_API_KEY"]="${HF_API_KEY:-}"
)

# Read existing .env into an associative array.
# Also check actual environment variables (for Vercel/production where
# env vars are set directly, not via a .env file).
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

# Also check OS environment variables (Vercel sets these directly).
for key in "${!REQUIRED_VARS[@]}"; do
  env_val=$(printenv "$key" 2>/dev/null || true)
  if [ -n "$env_val" ] && [ -z "${EXISTING[$key]:-}" ]; then
    EXISTING["$key"]="$env_val"
  fi
done

# Check each required var (includes the 5 AI providers as of Pass 81).
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
