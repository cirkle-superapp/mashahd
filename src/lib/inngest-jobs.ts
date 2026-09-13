/**
 * Inngest Background Jobs — serverless job queue for media processing.
 *
 * Uses Inngest (free tier: 25,000 invocations/month).
 * No payment card required.
 *
 * Use cases (per v6 spec):
 *   - Media transcoding pipeline (§22: upload → ffprobe → transcode → CMAF)
 *   - Periodic garbage collection (§155: temp + orphan cleanup)
 *   - Media reconciliation (§153: Turso ↔ storage consistency)
 *   - Source retention cleanup (§150: delete old source files)
 *   - Stale job recovery (§148: reset crashed jobs)
 *   - Telemetry aggregation flush (§79: batch → Neon)
 *
 * Inngest replaces the in-process async pipeline that was fire-and-forget.
 * With Inngest, jobs are:
 *   - Durable (survive restarts)
 *   - Retriable (automatic retry with backoff)
 *   - Observable (dashboard at inngest.com)
 *   - Scalable (concurrent execution)
 */

const INNGEST_KEY = process.env.INNGEST_KEY || "";
const INNGEST_API = "https://api.inngest.com";

interface InngestEvent {
  name: string;
  data: Record<string, any>;
}

/**
 * Send an event to Inngest to trigger a background job.
 * Returns { ok, eventId } on success.
 */
export async function triggerJob(event: InngestEvent): Promise<{ ok: boolean; eventId?: string; error?: string }> {
  if (!INNGEST_KEY) {
    console.warn("[inngest] INNGEST_KEY not configured — job not triggered");
    return { ok: false, error: "inngest not configured" };
  }

  try {
    const response = await fetch(`${INNGEST_API}/e/${INNGEST_KEY}`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: event.name,
        data: event.data,
      }),
    });

    if (!response.ok) {
      const error = await response.text();
      console.warn("[inngest] Trigger failed:", response.status, error.slice(0, 200));
      return { ok: false, error: error.slice(0, 200) };
    }

    const data = await response.json();
    return { ok: true, eventId: data.id || data.eventId };
  } catch (e) {
    console.warn("[inngest] Trigger error:", e);
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

/**
 * Trigger the media transcoding pipeline as a background job.
 * Replaces the fire-and-forget async pipeline in the upload route.
 */
export async function triggerTranscodeJob(opts: {
  videoId: string;
  sourcePath: string;
  contentId: string;
}): Promise<void> {
  const result = await triggerJob({
    name: "mashahd/media/transcode",
    data: {
      videoId: opts.videoId,
      sourcePath: opts.sourcePath,
      contentId: opts.contentId,
    },
  });

  if (result.ok) {
    console.log(`[inngest] Transcode job triggered for ${opts.videoId}`);
  } else {
    console.warn(`[inngest] Failed to trigger transcode for ${opts.videoId}: ${result.error}`);
    // Fall back to in-process pipeline (existing code handles this).
  }
}

/**
 * Trigger garbage collection as a scheduled job.
 */
export async function triggerGCJob(): Promise<void> {
  await triggerJob({
    name: "mashahd/maintenance/gc",
    data: { scheduledAt: new Date().toISOString() },
  });
}

/**
 * Trigger media reconciliation as a scheduled job.
 */
export async function triggerReconciliationJob(): Promise<void> {
  await triggerJob({
    name: "mashahd/maintenance/reconcile",
    data: { scheduledAt: new Date().toISOString() },
  });
}

/**
 * Trigger stale job recovery.
 */
export async function triggerStaleJobRecovery(): Promise<void> {
  await triggerJob({
    name: "mashahd/maintenance/recover-stale-jobs",
    data: { scheduledAt: new Date().toISOString() },
  });
}

/**
 * Trigger telemetry flush to Neon Postgres.
 */
export async function triggerTelemetryFlush(opts: {
  videoId: string;
  views: number;
  watchTime: number;
  p2pBytes: number;
  cdnBytes: number;
}): Promise<void> {
  await triggerJob({
    name: "mashahd/analytics/flush",
    data: opts,
  });
}

/**
 * Check if Inngest is configured.
 */
export function isInngestConfigured(): boolean {
  return !!INNGEST_KEY;
}
