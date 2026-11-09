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
SECRETS_FILE=".env.secrets"  # gitignored — see Pass 106 scrub
RESTORED=0
MISSING=()

# Source the gitignored secrets file (operational credentials that must
# NEVER be committed). Falls back to OS env vars for Vercel/production.
declare -A SECRETS=()
if [ -f "$SECRETS_FILE" ]; then
  while IFS='=' read -r key value; do
    case "$key" in
      ""|\#*) continue ;;
    esac
    SECRETS["$key"]="$value"
  done < "$SECRETS_FILE"
fi

# Helper: resolve a secret var. Precedence: .env.secrets file → OS env → empty.
secret_val() {
  local key="$1"
  if [ -n "${SECRETS[$key]:-}" ]; then printf '%s' "${SECRETS[$key]}"
  else printenv "$key" 2>/dev/null || true
  fi
}

# ── Critical env vars ──
# Non-secret defaults are inline. SECRET values are resolved via secret_val()
# from .env.secrets (gitignored) or OS env — NEVER hardcoded in this tracked file.
# Pass 106 root-cause: the previous version hardcoded live Turso/Neon/Inngest
# credentials in this tracked script, exposing them in the public repo history.
declare -A REQUIRED_VARS=(
  ["APP_URL"]="https://mashahd.vercel.app"
  ["DATABASE_URL"]="file:/home/z/my-project/db/custom.db"
  ["MEDIA_STORAGE_PATH"]="/home/z/my-project/storage"
  ["STORAGE_PROVIDER"]="local"
  # Turso (transactional DB — 9GB free, 1B reads/month)
  ["TURSO_URL"]="$(secret_val TURSO_URL)"
  ["TURSO_AUTH_TOKEN"]="$(secret_val TURSO_AUTH_TOKEN)"
  # Neon Postgres (analytics warehouse — 0.5GB free)
  ["NEON_DATABASE_URL"]="$(secret_val NEON_DATABASE_URL)"
  ["NEON_DATA_API"]="$(secret_val NEON_DATA_API)"
  # Inngest (durable workflows — free tier)
  ["INNGEST_KEY"]="$(secret_val INNGEST_KEY)"
  ["INNGEST_WEBHOOK_SECRET"]="$(secret_val INNGEST_WEBHOOK_SECRET)"
  # browserId signing secret (stable across dev restarts)
  ["BROWSER_ID_SECRET"]="$(secret_val BROWSER_ID_SECRET)"
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
  # AI Providers — 5-provider consensus mode. Read from OS env (operator exports).
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
    # CRITICAL: do NOT restore AI provider keys with empty values. The
    # ${VAR:-} expansion in REQUIRED_VARS gives an empty string when the
    # operator hasn't exported the AI keys to OS env. Writing empty values
    # to .env would clobber the real keys on the next dev server restart
    # (Pass 85 regression — every AI call would fail).
    SKIPPED_EMPTY=()
    RESTORABLE=()
    for key in "${MISSING[@]}"; do
      val="${REQUIRED_VARS[$key]}"
      if [ -z "$val" ]; then
        SKIPPED_EMPTY+=("$key")
      else
        RESTORABLE+=("$key")
      fi
    done

    if [ ${#RESTORABLE[@]} -gt 0 ]; then
      echo "" >> "$ENV_FILE"
      echo "# ── Restored by scripts/ensure-env.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ) ──" >> "$ENV_FILE"
      for key in "${RESTORABLE[@]}"; do
        echo "$key=${REQUIRED_VARS[$key]}" >> "$ENV_FILE"
        RESTORED=$((RESTORED + 1))
      done
    fi

    if [ ${#SKIPPED_EMPTY[@]} -gt 0 ]; then
      echo ""
      echo "═══════════════════════════════════════════════════════════════"
      echo "  ⚠ ${#SKIPPED_EMPTY[@]} var(s) SKIPPED (empty value — would clobber real key)"
      echo "═══════════════════════════════════════════════════════════════"
      echo "  These vars are listed in REQUIRED_VARS but their value resolved to"
      echo "  empty (the operator hasn't exported them to OS env). NOT writing them"
      echo "  to .env to avoid clobbering the real values."
      echo ""
      for key in "${SKIPPED_EMPTY[@]}"; do
        echo "  ⚠ skipped: $key"
      done
      echo ""
      echo "  To restore manually, add the real value to .env:"
      echo "    echo '$key=<real-value>' >> .env"
      echo ""
    fi
    echo ""
    echo "═══════════════════════════════════════════════════════════════"
    echo "  .ENV VERIFICATION — ${#RESTORABLE[@]} restored, ${#SKIPPED_EMPTY[@]} skipped (empty values)"
    echo "═══════════════════════════════════════════════════════════════"
    for key in "${RESTORABLE[@]}"; do
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
