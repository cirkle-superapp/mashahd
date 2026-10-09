# Mashahd — Operations Runbook

**Consolidated from**: worklog Pass 1–87 + scripts/ + AUDIT_PASS87_FULL_REPORT.md
**Last updated**: Pass 88 (2026-09-28)
**Production URL**: https://mashahd.vercel.app
**Repository**: https://github.com/cirkle-superapp/mashahd
**5-service stack**: GitHub + Vercel + Inngest + Neon + Turso
**Monthly cost**: $0 (zero-cost-by-default)

---

## Table of Contents

1. [Daily Operations](#1-daily-operations)
2. [Incident Response](#2-incident-response)
3. [Deployment Procedures](#3-deployment-procedures)
4. [Backup + Recovery](#4-backup--recovery)
5. [Environment Variable Management](#5-environment-variable-management)
6. [Service-Specific Runbooks](#6-service-specific-runbooks)
7. [Anti-Rollback Protections](#7-anti-rollback-protections)
8. [Debugging Tools](#8-debugging-tools)
9. [Emergency Procedures](#9-emergency-procedures)

---

## 1. Daily Operations

### 1.1 Start the dev server

```bash
cd /home/z/my-project
bun run dev
```

This auto-runs `predev` hooks: `verify-protected.sh` (108 protected files) + `ensure-env.sh` (5 AI keys + 13 service vars). The dev server starts on port 3000.

### 1.2 Lint + type-check

```bash
bun run lint              # ESLint (must be 0 errors)
npx tsc --noEmit          # TypeScript check (must be 0 errors)
```

### 1.3 Run tests

```bash
bun test                  # All tests
bun test tests/unit.test.ts         # Unit tests (13 pass)
bun test tests/security.test.ts     # Security tests (11 pass)
bun test tests/rate-limiter.test.ts # Rate limiter tests (7 pass)
bun test tests/streak.test.ts       # Streak tests (11 pass)
```

### 1.4 Backup

```bash
bash scripts/backup.sh    # Creates DB + schema + worklog backups (keep=20)
```

Backups go to `backups/` directory. 3 backups retained currently.

### 1.5 Verify protected files

```bash
bash scripts/verify-protected.sh --check    # check only (exit 1 if missing)
bash scripts/verify-protected.sh             # check + restore from HEAD
MASHAHD_VERBOSE=1 bash scripts/verify-protected.sh  # verbose mode
```

108 protected files (API routes + lib modules + stores + entry points). Stale-path detection fails loudly (exit 2) if manifest has paths that never existed in git HEAD.

---

## 2. Incident Response

### 2.1 Service failure triage

**If a user reports a 500 error or unexpected behavior:**

1. Hit `/api/env-health` first:
   ```bash
   curl -sS https://mashahd.vercel.app/api/env-health | python3 -m json.tool
   ```
   This shows which env vars are configured per service. Look for `configured: false`.

2. Hit `/api/cost-dashboard`:
   ```bash
   curl -sS https://mashahd.vercel.app/api/cost-dashboard | python3 -m json.tool
   ```
   This shows service health (HEALTHY/DEGRADED/DOWN) + circuit state.

3. Match the failure to a service using the table below.

### 2.2 Service failure → root cause matrix

| Symptom | Likely Service | Root Cause | Fix |
|---|---|---|---|
| `/api/videos` returns 500 | Turso | TURSO_URL or TURSO_AUTH_TOKEN missing/invalid | Set vars on Vercel: `VERCEL_TOKEN=<token> bash scripts/set-vercel-env.sh` |
| `/api/analytics` returns 500 | Neon | NEON_DATABASE_URL missing/invalid | Same as above |
| Inngest jobs not running | Inngest | INNGEST_KEY or INNGEST_WEBHOOK_SECRET missing | Same as above |
| AI features return "fallback" | AI providers | GROQ_API_KEY etc. missing | Same as above; check activeCount=5/5 in /api/cost-dashboard |
| Vercel deploy not picking up new commits | Vercel | Auto-deploy webhook stuck | Trigger manual deploy (see §3.3) |
| 403 on every authenticated endpoint | BrowserId | BROWSER_ID_SECRET missing → server uses random per-process secret | Set BROWSER_ID_SECRET (it's in `ensure-env.sh` REQUIRED_VARS) |

### 2.3 If Vercel auto-deploy is stuck

This happened in Pass 84 — Vercel was serving a cached build for 10+ minutes. Bypass via REST API:

```bash
export VERCEL_TOKEN="vcp_..."  # from https://vercel.com/account/tokens
GIT_SHA=$(git rev-parse HEAD)
curl -X POST "https://api.vercel.com/v13/deployments?teamId=team_bVAdJfvsNGW6Os3KxkhvHoq8" \
  -H "Authorization: Bearer $VERCEL_TOKEN" \
  -H "Content-Type: application/json" \
  -d "{\"name\":\"mashahd\",\"gitSource\":{\"type\":\"github\",\"org\":\"cirkle-superapp\",\"repo\":\"mashahd\",\"ref\":\"$GIT_SHA\"},\"target\":\"production\"}"
```

Returns deploy ID. Poll until `readyState: READY` (typically 60-120s):
```bash
DEPLOY_ID="dpl_..."
curl -sS "https://api.vercel.com/v13/deployments/$DEPLOY_ID?teamId=team_bVAdJfvsNGW6Os3KxkhvHoq8" \
  -H "Authorization: Bearer $VERCEL_TOKEN" | python3 -c "import sys,json; d=json.load(sys.stdin); print(d.get('readyState'))"
```

---

## 3. Deployment Procedures

### 3.1 Standard deployment (GitHub → Vercel auto-deploy)

```bash
git add -A
git commit -m "feat: ..."
git push origin main
```

Vercel auto-deploys from the GitHub main branch (typically 60-120s). Verify with:
```bash
curl -sS -o /dev/null -w "%{http_code}\n" https://mashahd.vercel.app/api/ready
# Should be 200
```

### 3.2 Set production env vars on Vercel

```bash
# Load .env into shell (so scripts/set-vercel-env.sh can read AI keys via ${VAR:-})
set -a
while IFS= read -r line; do
  case "$line" in ""|\#*) continue ;; esac
  key="${line%%=*}"; value="${line#*=}"
  export "$key=$value"
done < .env
set +a

export VERCEL_TOKEN="vcp_..."
bash scripts/set-vercel-env.sh
```

Pushes 15 vars (10 service + 5 AI) to Vercel. Idempotent (creates or updates).

### 3.3 Force fresh Vercel deploy (bypass auto-deploy)

See §2.3 above.

### 3.4 Verify deployment success

```bash
# Production endpoints
for ep in ready env-health cost-dashboard videos analytics inngest catalog; do
  curl -sS -o /dev/null -w "/api/$ep: %{http_code}\n" "https://mashahd.vercel.app/api/$ep"
done

# All should be 200
```

---

## 4. Backup + Recovery

### 4.1 What gets backed up

`scripts/backup.sh` creates 3 files in `backups/`:
- `custom-{timestamp}.db` — SQLite DB (videos, channels, comments, user state)
- `schema-{timestamp}.prisma` — Prisma schema (DB structure)
- `worklog-{timestamp}.md` — Full project worklog (Pass 1 to current)

Retention: `keep=20` (most recent 20 backups of each type).

### 4.2 Restore from backup

```bash
# Find the backup you want
ls -la backups/

# Restore the DB
cp backups/custom-{timestamp}.db db/custom.db

# Restore the schema (if needed)
cp backups/schema-{timestamp}.prisma prisma/schema.prisma

# Restart the dev server to pick up the restored DB
bun run dev
```

### 4.3 Production DB (Turso) recovery

The Turso DB is separate from the local SQLite. To restore Turso from a local backup:

```bash
# Push local DB to Turso
bash scripts/push-turso.ts backups/custom-{timestamp}.db
```

(Use with caution — overwrites production data.)

---

## 5. Environment Variable Management

### 5.1 Local `.env`

- File: `/home/z/my-project/.env`
- Gitignored + NOT tracked in git (untracked since Pass 81)
- Contains 26 vars: 5 AI keys + 21 service creds
- Verified by `bash scripts/ensure-env.sh --check` (exit 0 if all present)

### 5.2 Hardened `ensure-env.sh` (Pass 85)

- AI keys use `${VAR:-}` expansion (no hardcoded secrets)
- Empty values are SKIPPED with a warning (won't clobber real keys)
- Override OS env vars: `export GROQ_API_KEY=...; bash scripts/ensure-env.sh`

### 5.3 Production env vars (Vercel)

Set via `scripts/set-vercel-env.sh` (15 vars). Verify via:
```bash
curl -sS https://mashahd.vercel.app/api/env-health | python3 -m json.tool
```

The `vercel.alwaysRequired` object shows vars that MUST be set on Vercel. The `vercel.devOnly` object shows vars that are only needed locally (Vercel production uses Turso instead of DATABASE_URL, read-only FS instead of STORAGE_PROVIDER=local, etc.).

### 5.4 Secret hygiene

- `.env` is gitignored + NOT tracked in git
- No hardcoded secrets in `src/` or `scripts/` (grep verified clean)
- GitHub Push Protection satisfied (Pass 82 had a rejection that we resolved)
- AI keys never appear in commits (use `${VAR:-}` expansion)

---

## 6. Service-Specific Runbooks

### 6.1 GitHub (source control)

- **Repo**: `github.com/cirkle-superapp/mashahd`
- **Branch**: `main` (only branch)
- **Auto-deploys**: Vercel watches main → triggers deploy on push
- **Protected files**: 108 files protected against deletion (pre-commit hook + verify-protected.sh)
- **Anti-rollback**: pre-push hook blocks rollback/force-push/main deletion (override: `MASHAHD_ALLOW_FORCE_PUSH=1`)

### 6.2 Vercel (hosting)

- **Project**: `mashahd` (team: `team_bVAdJfvsNGW6Os3KxkhvHoq8`)
- **Domain**: `mashahd.vercel.app`
- **Framework**: Next.js 16 (App Router)
- **Build**: `bun run build` (lint_or_type_error fails the build — keep tsc clean)
- **Region**: `iad1` (US East)
- **Free tier**: 100GB bandwidth, 100GB-hr function execution

### 6.3 Inngest (workflows)

- **Endpoint**: `/api/inngest` (auto-syncs on every Vercel deploy)
- **Webhook secret**: `INNGEST_WEBHOOK_SECRET` (signs/verifies payloads)
- **Free tier**: 25,000 invocations/month
- **Jobs**: durable workflows (e.g. media transcoding, notification outbox processing)

### 6.4 Neon (analytics DB)

- **URL**: `libsql://mashahd-fortleem.aws-us-east-1.turso.io` — wait, that's Turso.
- **Neon URL**: `postgresql://neondb_owner:...@ep-empty-recipe-auue9q58-pooler.c-10.us-east-1.aws.neon.tech/MASHAHD`
- **Role**: analytics + disaster recovery warehouse
- **Free tier**: 0.5GB storage
- **Test**: `curl https://mashahd.vercel.app/api/analytics` (should return 200)

### 6.5 Turso (main DB)

- **URL**: `libsql://mashahd-fortleem.aws-us-east-1.turso.io`
- **Auth token**: in `.env` as `TURSO_AUTH_TOKEN`
- **Circuit breaker**: CLOSED (healthy) / OPEN (failing) / HALF_OPEN (recovering)
- **Free tier**: 9GB storage, 1B reads/month
- **Current data**: 35 videos, 13 channels, 89 comments, 3 users, 4 sessions (144 rows total)
- **Test**: `curl "https://mashahd.vercel.app/api/videos?limit=1"` (should return video data)

### 6.6 AI providers (5-provider consensus)

- **Providers**: Groq + OpenRouter + NVIDIA + Gemini + HuggingFace
- **Per-provider model fallback chains** (Pass 83): 3-4 models per provider = up to 20 attempts per request
- **Consensus mode** (`aiChat()`): waits for all 5, returns longest non-empty
- **Fast race mode** (`aiChatFast()`, Pass 88): returns first non-empty (latency-optimized for real-time UX)
- **Test**: `curl -X POST https://mashahd.vercel.app/api/ai/summarize -d '{"videoId":"cmtxhplp0dolq3ghq"}'`

---

## 7. Anti-Rollback Protections

### 7.1 Pre-commit hook (`.git/hooks/pre-commit`)

- **Blocks**: deletion of any of 108 protected files (API routes + lib modules + stores + entry points)
- **Override**: `MASHAHD_ALLOW_DELETE=1 git commit ...` (use only for intentional removal)

### 7.2 Pre-push hook (`.git/hooks/pre-push`)

Blocks 3 cases:
1. **Main/master deletion**: cannot delete the main branch on remote
2. **Rollback push**: cannot push a commit that's BEHIND origin/main (would revert production to older code)
3. **Force-push to main**: cannot rewrite shared history (non-fast-forward)

Override (disaster recovery only): `MASHAHD_ALLOW_FORCE_PUSH=1 git push ...`

### 7.3 Protected files manifest

- `scripts/verify-protected.sh` — 108 files listed
- `scripts/verify-protected.sh --check` — exit 1 if any missing
- `scripts/verify-protected.sh` — check + restore from HEAD
- Stale-path detection: exit 2 if manifest has paths that never existed in git HEAD (Pass 83 hardening)

### 7.4 .env untracking

- `.env` is gitignored + NOT tracked in git (untracked since Pass 81)
- Secrets never appear in commits
- GitHub Push Protection satisfied

---

## 8. Debugging Tools

### 8.1 `/api/env-health` (Pass 84)

```bash
curl -sS https://mashahd.vercel.app/api/env-health | python3 -m json.tool
```

Returns presence-only (true/false) status for every env var per service. NEVER exposes actual values.

### 8.2 `/api/cost-dashboard`

```bash
curl -sS https://mashahd.vercel.app/api/cost-dashboard | python3 -m json.tool
```

Returns all 5 services' health + cost + utilization.

### 8.3 `/api/ready`

```bash
curl -sS https://mashahd.vercel.app/api/ready
# {"status":"ready"}
```

Simple readiness probe.

### 8.4 `/api/catalog`

```bash
curl -sS https://mashahd.vercel.app/api/catalog | python3 -m json.tool
```

Lists all 90+ API endpoints by domain.

### 8.5 `/api/metrics`

```bash
curl -sS https://mashahd.vercel.app/api/metrics
```

Returns system metrics (CPU, memory, concurrent jobs).

---

## 9. Emergency Procedures

### 9.1 Production is down (5xx errors everywhere)

1. Check `/api/cost-dashboard` — are all 5 services HEALTHY?
2. Check `/api/env-health` — any `configured: false`?
3. If Turso circuit is OPEN: wait 60s for auto-recovery, or trigger manual close
4. If Vercel auto-deploy is stuck: trigger manual deploy (§3.3)
5. If all else fails: roll back to last known-good commit:
   ```bash
   git log --oneline -10  # find last good commit
   git reset --hard <last-good-sha>
   MASHAHD_ALLOW_FORCE_PUSH=1 git push origin main --force
   ```
   **WARNING**: force-push is blocked by default for good reason. Only use in disaster recovery.

### 9.2 Secrets leaked (e.g. AI key exposed in a commit)

1. Immediately rotate the leaked key at the provider's dashboard:
   - Groq: https://console.groq.com/keys
   - OpenRouter: https://openrouter.ai/keys
   - NVIDIA: https://build.nvidia.com/
   - Gemini: https://aistudio.google.com/
   - HuggingFace: https://huggingface.co/settings/tokens
2. Update `.env` locally with the new key
3. Push to Vercel: `VERCEL_TOKEN=<token> bash scripts/set-vercel-env.sh`
4. Trigger fresh deploy (§3.3)
5. Audit git history: `git log -p --all | grep -E "gsk_|sk-or-v1-|nvapi--|AQ.Ab|hf_"` (should be empty after the fix)

### 9.3 DB corruption

1. Stop the dev server
2. Restore from backup: `cp backups/custom-{latest}.db db/custom.db`
3. Restart: `bun run dev`
4. For production Turso: contact Turso support (their free tier has point-in-time recovery)

### 9.4 AI consensus degraded (all 5 providers slow/failing)

1. Check `/api/cost-dashboard` — is `ai.activeCount` < 5?
2. If a provider key is missing/invalid: re-set on Vercel (§3.2)
3. If all 5 are rate-limited: wait 60s, the rate limits reset
4. If persistent: switch to `aiChatFast()` mode for non-critical features (returns first non-empty)

---

## Appendix A — Key Contacts

- **Operator**: fortleem (GitHub) / fortleem (Vercel)
- **Vercel team**: `team_bVAdJfvsNGW6Os3KxkhvHoq8`
- **Turso DB**: `mashahd-fortleem.aws-us-east-1.turso.io`
- **Neon DB**: `ep-empty-recipe-auue9q58`
- **GitHub repo**: `cirkle-superapp/mashahd`

## Appendix B — Documentation Index

| Document | Purpose |
|---|---|
| `OPERATIONS_RUNBOOK.md` (this file) | Daily ops + incident response |
| `AUDIT_PASS87_FULL_REPORT.md` | 4-hat audit report (COO+CFO+CTO+PM) |
| `MASTER_BLUEPRINT.md` | Architecture spec |
| `DEPLOYMENT.md` | Deployment guide |
| `ZERO_COST_ARCHITECTURE.md` | Cost-optimization rationale |
| `PRODUCTION_GATE.md` | Pre-production checklist |
| `COO_AUDIT_REPORT.md` + `COO_AUDIT_REPORT_v2.md` + `COO_RECOMMENDATIONS.md` | Prior operational audits |
| `INTEGRATION.md` | Service integration notes |
| `SELF_HOSTED_DEPLOYMENT.md` | Self-host guide |
| `worklog.md` | Full project history (Pass 1 → current) |

---

*Runbook maintained by the COO agent. Updated each Pass. Last updated Pass 88.*
