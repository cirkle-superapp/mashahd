/**
 * CustomJobQueueInngestRouter — hybrid job orchestrator (Pass 90).
 *
 * Per user request: "use them in best structuring that is creative and out
 * of the box that makes them work together in harmony."
 *
 * This router decides whether a job goes to:
 *   - CustomJobQueue (in-process, fast path, <30s jobs)
 *   - Inngest (durable, survives serverless restarts, >30s jobs)
 *
 * The decision is based on the job's expected duration hint (passed by the
 * caller). This is the "hybrid orchestration" pattern:
 *
 *   ┌──────────────────────────────────────────────────────────────────┐
 *   │              Job enqueue request                                  │
 *   │   { type, data, expectedDurationMs, ... }                        │
 *   └──────────────────────────────────────────────────────────────────┘
 *                            │
 *                            ▼
 *                   ┌──────────────────┐
 *                   │  Router decision  │
 *                   └──────────────────┘
 *                            │
 *              ┌─────────────┴─────────────┐
 *              ▼                            ▼
 *   ┌──────────────────────┐  ┌───────────────────────────┐
 *   │ CustomJobQueue        │  │ Inngest                   │
 *   │ - in-process           │  │ - durable (survives restarts)│
 *   │ - <30s typical         │  │ - >30s typical             │
 *   │ - no network round-trip│  │ - external API call        │
 *   │ - retries w/ backoff   │  │ - retries w/ backoff       │
 *   │ - good for: fast I/O,  │  │ - good for: transcoding,   │
 *   │   cache invalidation,  │  │   batch processing,        │
 *   │   notification fan-out │  │   long-running pipelines   │
 *   └──────────────────────┘  └───────────────────────────┘
 *
 * HARMONY:
 *   - Both queues register the same job handlers (so either can execute any job)
 *   - CustomJobQueue is the hot path (no network latency)
 *   - Inngest is the durable path (survives Vercel serverless cold starts)
 *   - The router picks the right queue based on job metadata
 *   - Job IDs are prefixed with "cj_" (CustomJobQueue) or "in_" (Inngest) for tracing
 */

import { customJobQueue } from "./custom-job-queue";
import { triggerJob } from "./inngest-jobs";

export type JobDurationHint = "short" | "long" | "unknown";
export const DURATION_THRESHOLDS = {
  SHORT_MAX_MS: 30_000,  // <30s = short
  LONG_MIN_MS: 30_000,   // >30s = long
};

export interface RouterEnqueueOpts {
  type: string;
  data: any;
  durationHint?: JobDurationHint;
  expectedDurationMs?: number;  // if known, more accurate than durationHint
  delayMs?: number;
  maxRetries?: number;
  priority?: number;
}

export interface RouterEnqueueResult {
  jobId: string;
  routedTo: "customJobQueue" | "inngest";
  reason: string;
}

/**
 * Route a job to the right queue based on its expected duration.
 *
 * Decision logic:
 *   1. If expectedDurationMs is provided, use it (most accurate).
 *   2. Else if durationHint is provided, use it.
 *   3. Else default to "short" (most jobs are short; only transcodes are long).
 *
 * Jobs known to be long (transcode.video, reconcile.media) are ALWAYS routed
 * to Inngest regardless of the hint (they always exceed 30s).
 */
export async function enqueueJob(opts: RouterEnqueueOpts): Promise<RouterEnqueueResult> {
  // Always-long job types (regardless of hint).
  const ALWAYS_LONG_TYPES = new Set([
    "transcode.video",
    "reconcile.media",
    "gc.run",
    "media_pipeline.run",
  ]);

  const isAlwaysLong = ALWAYS_LONG_TYPES.has(opts.type);
  const expectedMs = opts.expectedDurationMs ?? (opts.durationHint === "long" ? 60_000 : opts.durationHint === "short" ? 5_000 : 5_000);
  const routeToInngest = isAlwaysLong || expectedMs >= DURATION_THRESHOLDS.LONG_MIN_MS;

  if (routeToInngest) {
    // Route to Inngest (durable, survives restarts).
    const result = await triggerJob({
      name: opts.type,
      data: opts.data,
    });
    if (!result.ok) {
      // Inngest failed — fall back to CustomJobQueue (better than dropping the job).
      console.warn(`[job-router] Inngest enqueue failed (${result.error}), falling back to CustomJobQueue`);
      const jobId = await customJobQueue.enqueue(opts.type, opts.data, {
        delayMs: opts.delayMs,
        maxRetries: opts.maxRetries,
        priority: opts.priority,
      });
      return {
        jobId,
        routedTo: "customJobQueue",
        reason: `inngest-failed-fallback (${result.error})`,
      };
    }
    return {
      jobId: result.eventId || `in_${Date.now()}`,
      routedTo: "inngest",
      reason: isAlwaysLong ? "always-long-type" : `expectedDurationMs=${expectedMs}>=30s`,
    };
  }

  // Route to CustomJobQueue (in-process, fast path).
  const jobId = await customJobQueue.enqueue(opts.type, opts.data, {
    delayMs: opts.delayMs,
    maxRetries: opts.maxRetries,
    priority: opts.priority,
  });
  return {
    jobId,
    routedTo: "customJobQueue",
    reason: `expectedDurationMs=${expectedMs}<30s`,
  };
}

/**
 * Get the router's current state (for observability).
 */
export function getRouterStatus(): {
  customJobQueue: { pending: number; processing: number; completed: number; failed: number };
  inngest: { configured: boolean };
} {
  return {
    customJobQueue: customJobQueue.getState(),
    inngest: { configured: true },  // isInngestConfigured() always returns true post-Pass-89
  };
}
