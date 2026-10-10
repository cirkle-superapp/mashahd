import { NextResponse } from "next/server";
import { getAIProviderStatus } from "@/lib/ai-provider";
import { getFlushStatus } from "@/lib/custom-store-neon-flush";
import { getRouterStatus } from "@/lib/custom-job-queue-inngest-router";

/**
 * GET /api/architecture
 *
 * Per user request (Pass 90): "use them in best structuring that is creative
 * and out of the box that makes them work together in harmony that gives top
 * tier and state of art output and processing."
 *
 * This endpoint exposes the LIVE architecture state — which stores are wired,
 * which are healthy, how the polyglot persistence layers are bridged, and the
 * current flow of events through the system. Used for:
 *   - Architecture observability (one-glance health check)
 *   - Debugging (which store is failing?)
 *   - Documentation (live architecture diagram)
 *
 * SECURITY: read-only, exposes only presence/health, never secrets.
 */
export async function GET() {
  const has = (k: string): boolean => {
    const v = process.env[k];
    return typeof v === "string" && v.length > 0;
  };

  const ai = getAIProviderStatus();
  const flushStatus = getFlushStatus();
  const routerStatus = getRouterStatus();

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    architecture: "Event-Sourced Polyglot Persistence with CQRS",
    version: "Pass 90 — 5-service harmony",

    // ── The 5-service cloud structure (kept per user request) ──
    cloudStack: {
      github: {
        role: "source control + CI/CD pipeline",
        configured: has("APP_URL"),
        note: "Commits to main trigger Vercel auto-deploy. Protected files (108) + anti-rollback hooks.",
      },
      vercel: {
        role: "hosting + edge functions + auto-deploy",
        configured: true,  // this endpoint is running, so Vercel is up
        runtime: process.env.VERCEL ? "serverless" : "self-hosted",
        region: process.env.VERCEL_REGION || "iad1",
      },
      turso: {
        role: "durable write-ahead-log for CustomStore + transactional DB",
        configured: has("TURSO_URL") && has("TURSO_AUTH_TOKEN"),
        note: "CustomStore event log + snapshots mirror here (durable, survives cold starts).",
      },
      neon: {
        role: "cold analytics warehouse + disaster recovery",
        configured: has("NEON_DATABASE_URL"),
        note: "CustomStore analytics projection flushes here every 50 events or 5 min.",
        flushStatus,
      },
      inngest: {
        role: "durable workflow orchestrator (long jobs >30s)",
        configured: has("INNGEST_KEY"),
        note: "Routes long jobs (transcode.video, reconcile.media, gc.run) here.",
        routerStatus,
      },
    },

    // ── From-scratch primitives (built in Pass 89) ──
    fromScratch: {
      customAvatar: {
        role: "procedural SVG avatar generator (replaces DiceBear)",
        design: "Cirkle Constellation — 3-circle brand motif + hash-derived dots + monogram",
        externalHttpDependencies: 0,
      },
      customThumbnail: {
        role: "procedural SVG thumbnail generator (replaces image-search)",
        design: "Category Landscape — 6 scene types + 12 brand palettes + hash-driven jitter",
        externalHttpDependencies: 0,
      },
      customStore: {
        role: "hot in-memory event log + projections (replaces Turso/Neon read path)",
        design: "Event Sourcing + CQRS — append-only log + materialized views",
        backedBy: "Turso (durable) + local file (fast)",
        externalHttpDependencies: 0,
      },
      customJobQueue: {
        role: "in-process fast-path job queue (handles <30s jobs)",
        design: "Event-sourced queue — jobs are events, workers tail the log",
        backedBy: "CustomStore event log",
        externalHttpDependencies: 0,
      },
      localOutboxEmail: {
        role: "from-scratch email adapter (replaces Brevo)",
        design: "Outbox pattern — writes RFC 822 .eml files to data/outbox/",
        externalHttpDependencies: 0,
      },
    },

    // ── CIRKLE BRAIN providers (the ONLY external APIs we use) ──
    ai: {
      role: "5-provider consensus + per-provider model fallback chains",
      design: "5×4=20 model attempts per request (Groq + OpenRouter + NVIDIA + Gemini + HF)",
      activeCount: Object.values(ai).filter(Boolean).length,
      providers: ai,
      externalHttpDependencies: Object.values(ai).filter(Boolean).length,
      note: "The ONLY external APIs the platform consumes. All other external services replaced in Pass 89.",
    },

    // ── Data flow diagram (live) ──
    dataFlow: {
      writePath: [
        "API route",
        "→ CustomStore.append(event) [local file, ~1ms]",
        "→ mirror async to Turso events table [durable, fire-and-forget]",
        "→ CustomStore projection updates [in-memory, <1ms]",
      ],
      readPath: [
        "API route",
        "→ CustomStore.projection(name) [in-memory, <1ms]",
        "(cold start) → CustomStore.warmUp() → reads from Turso → rebuilds projections",
      ],
      analyticsPath: [
        "API route → recordAnalyticsEvent(type, payload)",
        "→ CustomStore.append('analytics_' + type, payload)",
        "→ every 50 events OR 5 min → flushToNeon()",
        "→ Neon mashahd_analytics + mashahd_analytics_daily tables",
      ],
      jobPath: [
        "API route → enqueueJob({type, data, durationHint})",
        "→ if expectedDurationMs >= 30s OR always-long type → Inngest (durable)",
        "→ else → CustomJobQueue (in-process, fast path)",
        "→ both queues share the same handlers (registerHandler)",
      ],
      deployPath: [
        "git push origin main",
        "→ GitHub triggers Vercel auto-deploy (60-120s build)",
        "→ Vercel serverless function starts",
        "→ /api/inngest endpoint triggers Inngest auto-sync",
        "→ CustomStore cold-starts → warms up by replaying from Turso",
      ],
    },

    // ── Harmony matrix (which services talk to which) ──
    harmony: {
      github_to_vercel: "auto-deploy via Vercel git integration",
      vercel_to_turso: has("TURSO_URL") && has("TURSO_AUTH_TOKEN"),
      vercel_to_neon: has("NEON_DATABASE_URL"),
      vercel_to_inngest: has("INNGEST_KEY"),
      vercel_to_ai: Object.values(ai).filter(Boolean).length === 5,
      customstore_to_turso: "TurboBackedStorageAdapter (async mirror)",
      customstore_to_neon: "flushToNeon() every 50 events OR 5 min",
      customjobqueue_to_inngest: "enqueueJob() routes long jobs to Inngest",
    },

    cost: "$0/month — zero-cost-by-default 5-service stack",
  });
}
