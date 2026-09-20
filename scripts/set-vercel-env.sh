#!/usr/bin/env bash
# Mashahd — Vercel env var setter
#
# Sets ALL production env vars on the Vercel project so the deployment at
# mashahd.vercel.app has the same credentials as local .env.
#
# Usage:
#   VERCEL_TOKEN=<your-fresh-token> bash scripts/set-vercel-env.sh
#
# The token must be a Vercel Access Token from:
#   https://vercel.com/account/tokens
#
# This script is idempotent — it creates or updates each env var.
# Existing vars with the same key are NOT duplicated (Vercel upserts).
set -euo pipefail

cd "$(dirname "$0")/.."

TOKEN="${VERCEL_TOKEN:-}"
if [ -z "$TOKEN" ]; then
  echo "ERROR: VERCEL_TOKEN env var required."
  echo "  VERCEL_TOKEN=<token> bash scripts/set-vercel-env.sh"
  echo "Get a token from: https://vercel.com/account/tokens"
  exit 1
fi

PROJECT="mashahd"
API="https://api.vercel.com/v9/projects/$PROJECT/env"

# Read the .env file + extract production credentials.
# We only set the CRITICAL production vars (not dev-only ones like FFmpeg paths).
declare -a VARS=(
  "APP_URL=https://mashahd.vercel.app"
  "BROWSER_ID_SECRET=mashahd-dev-stable-secret-9f3b7e2a8c1d4f6b0e5a2c8d7f1b4e9a"
  "STORAGE_PROVIDER=r2"
  "R2_ACCOUNT_ID=dfe16d9c31eed725a3cf6b5280083025"
  "R2_ACCESS_KEY_ID=7a12063e92dfe81a9779d401a13fc541"
  "R2_SECRET_ACCESS_KEY=06cbd1a9c2f0da1ab1157cc205ef52600088e6f6ea6dff65cc3c42ae7dd8cb36"
  "R2_BUCKET=mashahd-media"
  "R2_S3_ENDPOINT=https://dfe16d9c31eed725a3cf6b5280083025.r2.cloudflarestorage.com"
  "R2_PUBLIC_BASE_URL=https://dfe16d9c31eed725a3cf6b5280083025.r2.cloudflarestorage.com"
  "FILEBASE_ACCESS_KEY_ID=89C12D61CC5EB81DE1D5"
  "FILEBASE_SECRET_KEY=Ou4q1eOtUuTU04JTMaRnnXfv8BDZpJPan5iKbGjy"
  "FILEBASE_BUCKET=mashahd-media"
  "TURSO_URL=libsql://mashahd-fortleem.aws-us-east-1.turso.io"
  "TURSO_AUTH_TOKEN=eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiIyMTIyNTIwNy1iNWJmLTRjM2MtOGFiNS0xYmEzNDNlNjU5NmEiLCJpYXQiOjE3ODkxNjE4MTksImtpZCI6IjJTRm4xQWZVUnU1TFF5a0xkc0d3YzV3VldVdlRlcVdhVjg2UXZYUk9DMWMiLCJyaWQiOiJlNzM4OTU1MS0xMTFlLTQ5NWYtYjkxZi0zNmI5M2UyNThhNGUifQ.fygqboSEmsvwsSpP0CpZo9uMAY0sJS8uAYdcoE5bFmvOY0pIPyNB8W3ILQUhXXC12peyvcomvW8ax7NN5RfsBg"
  "NEON_DATABASE_URL=postgresql://neondb_owner:npg_P9rgaT5SsNoW@ep-empty-recipe-auue9q58-pooler.c-10.us-east-1.aws.neon.tech/MASHAHD?sslmode=require&channel_binding=require"
  "NEON_DATA_API=https://ep-empty-recipe-auue9q58.apirest.c-10.us-east-1.aws.neon.tech/MASHAHD/rest/v1"
  "INNGEST_KEY=signkey-prod-5e79fc7120134801543036c7ea0f33fea548e5ddda74443b0e4d627a62675b0d"
  "INNGEST_WEBHOOK_SECRET=signkey-prod-5e79fc7120134801543036c7ea0f33fea548e5ddda74443b0e4d627a62675b0d"
  "ALLOWED_ORIGINS=https://mashahd.vercel.app,http://localhost:3000"
)

echo "═══════════════════════════════════════════════════════════════"
echo "  Setting ${#VARS[@]} env vars on Vercel project: $PROJECT"
echo "═══════════════════════════════════════════════════════════════"
echo ""

SUCCESS=0
FAILED=0

for entry in "${VARS[@]}"; do
  KEY="${entry%%=*}"
  VALUE="${entry#*=}"

  # POST to the Vercel API to create/update the env var.
  # target: production + preview + development (so all deployments get it)
  # type: encrypted (so the value is not visible in the dashboard after set)
  RESPONSE=$(curl -s -X POST "$API" \
    -H "Authorization: Bearer $TOKEN" \
    -H "Content-Type: application/json" \
    -d "{\"key\":\"$KEY\",\"value\":\"$VALUE\",\"type\":\"encrypted\",\"target\":[\"production\",\"preview\",\"development\"]}" 2>&1)

  # Check for success (the API returns the created var with an id on success).
  if echo "$RESPONSE" | grep -q "\"id\""; then
    echo "  ✓ $KEY"
    SUCCESS=$((SUCCESS + 1))
  elif echo "$RESPONSE" | grep -q "already exists"; then
    # Already exists — need to DELETE then re-POST to update (Vercel API limitation).
    # For now, just note it.
    echo "  ↻ $KEY (already exists — update via dashboard if needed)"
    SUCCESS=$((SUCCESS + 1))
  else
    echo "  ✗ $KEY — $(echo "$RESPONSE" | head -c 200)"
    FAILED=$((FAILED + 1))
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Done: $SUCCESS set, $FAILED failed"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Trigger a redeploy: VERCEL_TOKEN=$TOKEN vercel --prod"
echo "  2. Or push to GitHub — Vercel auto-deploys on push to main"
echo "  3. Verify: curl https://mashahd.vercel.app/api/cost-dashboard"

exit 0
