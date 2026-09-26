import { NextResponse } from "next/server";
import { getAIProviderStatus } from "@/lib/ai-provider";

/**
 * GET /api/env-health
 *
 * Per user request (Pass 84): "if one [service] fails check .env in each
 * of them as it may be connected to each other". This endpoint exposes
 * which env vars are configured per service so the operator can debug
 * connection failures quickly — e.g. if /api/videos returns 500, the
 * operator checks /api/env-health and sees Turso → TURSO_URL: false
 * (not configured on Vercel), which explains why the DB query failed.
 *
 * SECURITY: this endpoint exposes ONLY whether each var is set
 * (true/false), NEVER the actual values. The values are secrets and
 * must never leak. The endpoint is read-only and unauthenticated
 * because it leaks no PII and is critical for debugging the 5-service
 * stack interconnection.
 *
 * Response shape:
 *   {
 *     "timestamp": "...",
 *     "services": {
 *       "github":  { "configured": true,  "vars": { ... } },
 *       "vercel":  { "configured": true,  "vars": { "APP_URL": true, ... } },
 *       "inngest": { "configured": true,  "vars": { "INNGEST_KEY": true, ... } },
 *       "neon":    { "configured": true,  "vars": { "NEON_DATABASE_URL": true, ... } },
 *       "turso":   { "configured": true,  "vars": { "TURSO_URL": true, ... } },
 *       "ai":      { "configured": true,  "activeCount": 5,
 *                    "vars": { "GROQ_API_KEY": true, ... } }
 *     },
 *     "interconnection": {
 *       "vercel_to_turso":   true,
 *       "vercel_to_neon":    true,
 *       "vercel_to_inngest": true,
 *       "github_to_vercel":  "auto-deploy via Vercel git integration",
 *       "vercel_to_ai":      true
 *     },
 *     "cost": "$0/month"
 *   }
 */
export async function GET() {
  // For each var, return true/false (presence only — never the value).
  const has = (k: string): boolean => {
    const v = process.env[k];
    return typeof v === "string" && v.length > 0;
  };

  // GitHub: the local → GitHub connection is verified by git push
  // succeeding. We can't check git from inside the API route (no .git
  // on Vercel), but we expose APP_URL as a sanity-check that the
  // operator has set the production URL.
  const github = {
    configured: has("APP_URL"),
    vars: {
      APP_URL: has("APP_URL"),
    },
    note: "GitHub → Vercel auto-deploy is configured via Vercel's git integration (not via env vars). Verify by pushing to main and watching Vercel rebuild.",
  };

  // Vercel: this endpoint itself is proof Vercel is running. We expose
  // the app-level env vars that Vercel needs to talk to the other 4
  // services + run the app correctly.
  const vercel = {
    configured: true, // this endpoint is running, so Vercel is up
    vars: {
      APP_URL: has("APP_URL"),
      ALLOWED_ORIGINS: has("ALLOWED_ORIGINS"),
      BROWSER_ID_SECRET: has("BROWSER_ID_SECRET"),
      DATABASE_URL: has("DATABASE_URL"),
      STORAGE_PROVIDER: has("STORAGE_PROVIDER"),
      MEDIA_STORAGE_PATH: has("MEDIA_STORAGE_PATH"),
      FFMPEG_PATH: has("FFMPEG_PATH"),
      FFPROBE_PATH: has("FFPROBE_PATH"),
    },
  };

  // Inngest: Vercel needs INNGEST_KEY + INNGEST_WEBHOOK_SECRET to sign
  // and verify webhook payloads between Vercel and Inngest's job runners.
  const inngest = {
    configured: has("INNGEST_KEY") && has("INNGEST_WEBHOOK_SECRET"),
    vars: {
      INNGEST_KEY: has("INNGEST_KEY"),
      INNGEST_WEBHOOK_SECRET: has("INNGEST_WEBHOOK_SECRET"),
    },
    note: "Inngest auto-syncs from /api/inngest on every Vercel deploy. If INNGEST_KEY is missing, webhooks can't be signed and Inngest jobs fail silently.",
  };

  // Neon: Vercel needs NEON_DATABASE_URL for analytics + DR.
  const neon = {
    configured: has("NEON_DATABASE_URL"),
    vars: {
      NEON_DATABASE_URL: has("NEON_DATABASE_URL"),
      NEON_DATA_API: has("NEON_DATA_API"),
    },
    note: "Neon is the analytics + DR warehouse. If NEON_DATABASE_URL is missing, /api/analytics returns 500 and DR fails.",
  };

  // Turso: Vercel needs TURSO_URL + TURSO_AUTH_TOKEN for the main DB.
  const turso = {
    configured: has("TURSO_URL") && has("TURSO_AUTH_TOKEN"),
    vars: {
      TURSO_URL: has("TURSO_URL"),
      TURSO_AUTH_TOKEN: has("TURSO_AUTH_TOKEN"),
    },
    note: "Turso is the main transactional DB. If TURSO_URL or TURSO_AUTH_TOKEN is missing, every DB query fails and /api/videos, /api/channels, etc. return 500.",
  };

  // AI providers: 5 keys for the consensus mode.
  const aiProviderStatus = getAIProviderStatus();
  const ai = {
    configured: Object.values(aiProviderStatus).filter(Boolean).length > 0,
    activeCount: Object.values(aiProviderStatus).filter(Boolean).length,
    vars: aiProviderStatus,
    note: "5-provider consensus mode (Pass 81). If any provider key is missing, that provider is skipped; the remaining providers still answer. If ALL 5 are missing, the caller's deterministic fallback is used.",
  };

  // Interconnection matrix — derived from the per-service vars above.
  // Each link is "true" only if the vars on BOTH ends are configured.
  const interconnection = {
    vercel_to_turso: turso.configured,
    vercel_to_neon: neon.configured,
    vercel_to_inngest: inngest.configured,
    github_to_vercel: "auto-deploy via Vercel git integration (not env-var based)",
    vercel_to_ai: ai.activeCount === 5,
  };

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    services: { github, vercel, inngest, neon, turso, ai },
    interconnection,
    cost: "$0/month — zero-cost-by-default 5-service stack",
  });
}
