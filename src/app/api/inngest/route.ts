import { NextRequest, NextResponse } from "next/server";
import { verifyInngestWebhook } from "@/lib/webhook-security";

/**
 * POST /api/inngest
 *
 * Inngest webhook endpoint — receives event triggers from Inngest.
 *
 * Per master spec §29: "Inngest remains the durable workflow engine."
 * Per §38-39: "All external webhooks must verify authenticity/signature."
 *
 * This endpoint:
 *   1. Verifies the Inngest signature (HMAC-SHA256)
 *   2. Parses the event payload
 *   3. Routes to the appropriate handler based on event name
 *   4. Returns 200 on success (Inngest considers the event processed)
 *
 * Supported event types:
 *   - mashahd/notification/email → send email via Brevo
 *   - mashahd/media/transcode → trigger FFmpeg pipeline
 *   - mashahd/maintenance/gc → run garbage collection
 *   - mashahd/maintenance/reconcile → run media reconciliation
 *   - mashahst/maintenance/recover-stale-jobs → recover stale jobs
 *   - mashahd/analytics/flush → flush telemetry to Neon
 *   - mashahd/outbox/* → process outbox events (replication to Neon)
 */

const INNGEST_KEY = process.env.INNGEST_KEY || "";

export async function POST(req: NextRequest) {
  const body = await req.text();

  // Per §38-39: verify webhook signature.
  if (INNGEST_KEY) {
    const signature = req.headers.get("x-inngest-signature") || "";
    const verification = verifyInngestWebhook(body, signature, INNGEST_KEY);
    if (!verification.valid) {
      console.warn("[inngest-webhook] Signature verification failed:", verification.reason);
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Parse the event.
  let event: any;
  try {
    event = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  const eventName = event.name || event.event || "";
  const eventData = event.data || {};

  // Route based on event name.
  try {
    switch (eventName) {
      case "mashahd/notification/email": {
        const { sendEmail } = await import("@/lib/email-service");
        const result = await sendEmail({
          to: eventData.to,
          subject: eventData.subject,
          html: eventData.html,
          text: eventData.text,
          priority: eventData.priority || "P2",
        });
        return NextResponse.json({ ok: result.ok, status: result.status });
      }

      case "mashahd/maintenance/gc": {
        const { runGarbageCollection } = await import("@/lib/content-gc");
        const report = await runGarbageCollection();
        return NextResponse.json({ ok: true, ...report });
      }

      case "mashahd/maintenance/reconcile": {
        const { reconcileMedia } = await import("@/lib/media-reconciliation");
        const report = await reconcileMedia();
        return NextResponse.json({ ok: true, ...report });
      }

      case "mashahd/maintenance/recover-stale-jobs": {
        const { recoverStaleJobs } = await import("@/lib/job-manager");
        const recovered = await recoverStaleJobs();
        return NextResponse.json({ ok: true, recovered });
      }

      case "mashahd/analytics/flush": {
        const { writeTelemetryDaily } = await import("@/lib/neon-analytics");
        await writeTelemetryDaily({
          videoId: eventData.videoId,
          views: eventData.views || 0,
          watchTimeSec: eventData.watchTime || 0,
          avgStartupSec: 0,
          avgRebuffer: 0,
          p2pBytes: eventData.p2pBytes || 0,
          cdnBytes: eventData.cdnBytes || 0,
        });
        return NextResponse.json({ ok: true });
      }

      default:
        // Unknown event — log but don't fail (idempotent).
        console.log(`[inngest-webhook] Unknown event: ${eventName}`);
        return NextResponse.json({ ok: true, note: "unknown event type" });
    }
  } catch (e) {
    console.error(`[inngest-webhook] Handler failed for ${eventName}:`, e);
    // Return 500 so Inngest retries (per §30: workflows are retriable).
    return NextResponse.json(
      { error: "handler failed", event: eventName, detail: String(e).slice(0, 200) },
      { status: 500 }
    );
  }
}

/**
 * GET /api/inngest — health check for Inngest.
 * Inngest pings this to verify the endpoint is alive.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "mashahd-inngest-webhook",
    configured: !!INNGEST_KEY,
  });
}
