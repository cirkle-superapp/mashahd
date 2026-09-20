#!/usr/bin/env bash
# Mashahd — Vercel env var setter (5-service stack)
#
# Sets ALL production env vars on the Vercel project so the deployment at
# mashahd.vercel.app has the same credentials as local .env.
#
# Pass 53: restructured to use ONLY GitHub + Vercel + Inngest + Neon + Turso.
# Filebase, Cloudflare R2, and Brevo were REMOVED per user request.
#
# Usage:
#   VERCEL_TOKEN=<your-fresh-token> bash scripts/set-vercel-env.sh
#
# The token must be a Vercel Access Token from:
#   https://vercel.com/account/tokens
#
# This script is idempotent — it creates or updates each env var.
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
# The project belongs to a team — we need the teamId for all API calls.
# Fetch it automatically (the token works for the projects endpoint).
TEAM_ID=$(curl -s "https://api.vercel.com/v9/projects/$PROJECT" \
  -H "Authorization: Bearer $TOKEN" \
  | python3 -c "import sys,json;print(json.load(sys.stdin).get('accountId',''))" 2>/dev/null || echo "")

if [ -z "$TEAM_ID" ]; then
  echo "ERROR: could not fetch teamId for project $PROJECT"
  echo "  Check that the token is valid + the project exists."
  exit 1
fi
echo "Project: $PROJECT | Team: $TEAM_ID"
API="https://api.vercel.com/v9/projects/$PROJECT/env?teamId=$TEAM_ID"

# Fetch existing env var IDs (so we can PATCH existing ones instead of failing).
declare -A EXISTING_IDS
curl -s "https://api.vercel.com/v9/projects/$PROJECT/env?limit=100&teamId=$TEAM_ID" \
  -H "Authorization: Bearer $TOKEN" | python3 -c "
import sys, json
d = json.load(sys.stdin)
for e in d.get('envs', []):
    print(f\"{e.get('key','')}={e.get('id','')}\")
" > /tmp/existing-envs.txt
while IFS='=' read -r key id; do
  [ -n "$key" ] && EXISTING_IDS["$key"]="$id"
done < /tmp/existing-envs.txt
echo "Found ${#EXISTING_IDS[@]} existing env vars"

# The 13 production credentials for the 5-service stack.
declare -a VARS=(
  "APP_URL=https://mashahd.vercel.app"
  "BROWSER_ID_SECRET=mashahd-dev-stable-secret-9f3b7e2a8c1d4f6b0e5a2c8d7f1b4e9a"
  "STORAGE_PROVIDER=local"
  "TURSO_URL=libsql://mashahd-fortleem.aws-us-east-1.turso.io"
  "TURSO_AUTH_TOKEN=eyJhbGciOiJFZERTQSIsInR5cCI6IkpXVCJ9.eyJhIjoicnciLCJnaWQiOiIyMTIyNTIwNy1iNWJmLTRjM2MtOGFiNS0xYmEzNDNlNjU5NmEiLCJpYXQiOjE3ODkxNjE4MTksImtpZCI6IjJTRm4xQWZVUnU1TFF5a0xkc0d3YzV3VldVdlRlcVdhVjg2UXZYUk9DMWMiLCJyaWQiOiJlNzM4OTU1MS0xMTFlLTQ5NWYtYjkxZi0zNmI5M2UyNThhNGUifQ.fygqboSEmsvwsSpP0CpZo9uMAY0sJS8uAYdcoE5bFmvOY0pIPyNB8W3ILQUhXXC12peyvcomvW8ax7NN5RfsBg"
  "NEON_DATABASE_URL=postgresql://neondb_owner:npg_P9rgaT5SsNoW@ep-empty-recipe-auue9q58-pooler.c-10.us-east-1.aws.neon.tech/MASHAHD?sslmode=require&channel_binding=require"
  "NEON_DATA_API=https://ep-empty-recipe-auue9q58.apirest.c-10.us-east-1.aws.neon.tech/MASHAHD/rest/v1"
  "INNGEST_KEY=signkey-prod-5e79fc7120134801543036c7ea0f33fea548e5ddda74443b0e4d627a62675b0d"
  "INNGEST_WEBHOOK_SECRET=signkey-prod-5e79fc7120134801543036c7ea0f33fea548e5ddda74443b0e4d627a62675b0d"
  "ALLOWED_ORIGINS=https://mashahd.vercel.app,http://localhost:3000"
)

SUCCESS=0
FAILED=0
UPDATED=0
CREATED=0

for entry in "${VARS[@]}"; do
  KEY="${entry%%=*}"
  VALUE="${entry#*=}"
  EXISTING_ID="${EXISTING_IDS[$KEY]:-}"

  if [ -n "$EXISTING_ID" ]; then
    # PATCH existing var (update value)
    RESP=$(curl -s -X PATCH "https://api.vercel.com/v9/projects/$PROJECT/env/$EXISTING_ID?teamId=$TEAM_ID" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"value\":\"$VALUE\",\"type\":\"encrypted\",\"target\":[\"production\",\"preview\",\"development\"]}")
    if echo "$RESP" | grep -q "\"id\""; then
      echo "  ✓ updated: $KEY"
      UPDATED=$((UPDATED + 1))
      SUCCESS=$((SUCCESS + 1))
    else
      echo "  ✗ update failed: $KEY — $(echo "$RESP" | head -c 100)"
      FAILED=$((FAILED + 1))
    fi
  else
    # POST new var
    RESP=$(curl -s -X POST "$API" \
      -H "Authorization: Bearer $TOKEN" \
      -H "Content-Type: application/json" \
      -d "{\"key\":\"$KEY\",\"value\":\"$VALUE\",\"type\":\"encrypted\",\"target\":[\"production\",\"preview\",\"development\"]}")
    if echo "$RESP" | grep -q "\"id\""; then
      echo "  ✓ created: $KEY"
      CREATED=$((CREATED + 1))
      SUCCESS=$((SUCCESS + 1))
    else
      echo "  ✗ create failed: $KEY — $(echo "$RESP" | head -c 100)"
      FAILED=$((FAILED + 1))
    fi
  fi
done

echo ""
echo "═══════════════════════════════════════════════════════════════"
echo "  Done: $SUCCESS success ($CREATED created, $UPDATED updated), $FAILED failed"
echo "═══════════════════════════════════════════════════════════════"
echo ""
echo "Next steps:"
echo "  1. Trigger a redeploy: VERCEL_TOKEN=$TOKEN vercel --prod"
echo "  2. Or push to GitHub — Vercel auto-deploys on push to main"
echo "  3. Verify: curl https://mashahd.vercel.app/api/cost-dashboard"

exit 0
