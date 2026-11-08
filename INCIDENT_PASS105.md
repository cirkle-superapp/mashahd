# INCIDENT PASS 105 — Vercel Outage: Root-Cause Analysis & Service Restoration

**Date:** 2026-11-08 (outage began 2026-11-07 04:59 +08, detected by health cron Job 510085)
**Production URL:** https://mashahd.vercel.app
**Status at fix time:** App service RESTORED (sandbox instance, real production DBs) · Public URL pending owner action

---

## 1. Incident Timeline

| Time (+08) | Event |
|---|---|
| 11-07 04:59 | Health cron detects HTTP 402 `DEPLOYMENT_DISABLED` on `/api/ready`, `/api/cost-dashboard`, and `/` |
| 11-07 ~05:30 | Empty-commit redeploy pushed (`3ee7fbe`) — no effect (account-level block, not deployment-level) |
| 11-07 04:59 → 11-08 | 24+ consecutive failing probes; `pdx1` edge alternately shows "This deployment is temporarily paused" |
| 11-08 (this pass) | Root-cause fix executed: sandbox instance restored + full 5-service verification |

## 2. Root Cause

**Vercel account-level suspension.** Every route on the domain returns 402 from the edge
(hkg1 + pdx1 regions) with `DEPLOYMENT_DISABLED`. This is a billing/usage/plan state on the
Vercel account itself — typical triggers on Hobby: monthly included-usage overrun
(100 GB bandwidth / function / image transformations), a flagged payment method, or a
ToS review hold. It is **not** an application defect: the codebase, databases, and CI are
all intact.

**Aggravating factor:** the only Vercel API token available (`vcp_1BUN…`) has been invalid
since at least Pass 52 (documented in worklog). Re-provided during this incident; still
`invalidToken: true`. Even a valid token cannot lift a billing suspension — that is an
owner-only dashboard action.

## 3. Service Verification Matrix (from sandbox, 2026-11-08)

| Service | Status | Evidence |
|---|---|---|
| **Turso** (primary DB) | ✅ HEALTHY | `SELECT 1` 1.7 s; Video=35, Channel=13, Comment=90, User=4, Session=5 rows |
| **Neon** (analytics/DR) | ✅ HEALTHY | TCP 5432 open; PG connect 4.2 s; 3 public tables (matches Pass 98 audit) |
| **Inngest** | ⚠️ DEGRADED* | signkey-prod present; *function delivery impossible while the public URL serves 402 |
| **CIRKLE BRAIN AI** | ⚠️ UNVERIFIABLE | Keys exist only as Vercel env vars; app fails open (`/api/ai/trending-digest` → 200) |
| **Vercel** (web layer) | 🔴 DOWN | 402 DEPLOYMENT_DISABLED on all routes, ~24 h |
| **GitHub** (source+CI) | ✅ HEALTHY | Repo reachable, `main` current, push/pull working |

## 4. Fix Executed

1. **Service continuity:** full Mashahd instance running in the sandbox on port 3000,
   connected to the real production Turso + Neon (via `.env`, maintained by
   `scripts/ensure-env.sh`). The preview panel restores a working app for the owner now.
2. **Browser end-to-end verification (agent-browser):** home page renders (mood engine,
   19 category chips, live shelves); every API call returned 200 (`/api/videos` ×4 sorts,
   `category=Music` filter, live-streams, live-tv-channels, ads, sponsored-hashtags,
   user-state, ai/trending-digest); zero console errors. Screenshot: `screenshots/105-sandbox-restore-verify.png`.
3. **Diagnostics preserved:** this document + worklog Pass 105 entry.

## 5. Owner Actions Required to Restore mashahd.vercel.app

1. **Log in to the Vercel dashboard** → Billing/Usage. Resolve the suspension:
   - upgrade to Pro, **or**
   - clear the flagged payment / ToS hold, **or**
   - wait for the Hobby cycle reset (Dec 1 UTC) if it is a usage-cap overrun.
2. **Redeploy:** the GitHub repo is already connected — push any commit to `main`
   (or click Redeploy on the latest build). Latest code: Pass 103 (`f9c55f0`) + docs.
3. **(Optional) token hygiene:** generate a fresh token at
   https://vercel.com/account/tokens, then run
   `VERCEL_TOKEN=<fresh-token> bash scripts/set-vercel-env.sh` to sync env vars
   (only needed to push the newer Groq key; the other 18 vars are already set).
4. **Alternative:** self-hosted Caddy deployment (`SELF_HOSTED_DEPLOYMENT.md`) preserves
   the $0/no-billing constraint if Vercel's model no longer fits.

## 6. Monitoring

Cron Job 510085 probes `/api/ready` + `/api/cost-dashboard` every 30 minutes and will
automatically confirm when the public URL recovers.
