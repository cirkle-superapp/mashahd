import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

// Import the metrics incrementer (in-memory aggregation per §79).
// We can't import from the metrics route directly (circular dep), so we
// use a shared in-memory module.
import { incrementMetric } from "@/lib/metrics-store";

/**
 * POST /api/media/telemetry
 * Body: { sessionId, videoId, cdnBytes, p2pBytes, rebufferCount, ... }
 * Batched telemetry from the player. Called every 10-30s + on events.
 *
 * Per v6 §79: aggregate before persistence. The in-memory metrics store
 * is updated here; the DB write happens for durable session records only.
 *
 * Pass 57: added rate limiting (60/min/IP) to prevent telemetry-spam.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`telemetry:${ip}`, 60, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const body = await req.json().catch(() => ({}));
  const sessionId: string = body.sessionId || "";
  const videoId: string = body.videoId || "";

  if (!sessionId || !videoId) {
    return NextResponse.json({ error: "sessionId + videoId required" }, { status: 400 });
  }

  // ── Update in-memory metrics (§174-180 observability) ──
  const cdnBytes = Number(body.cdnBytes) || 0;
  const p2pBytes = Number(body.p2pBytes) || 0;
  const rebufferCount = Number(body.rebufferCount) || 0;
  const startupTime = Number(body.startupTime) || 0;

  if (cdnBytes > 0) incrementMetric("originBytesServed", cdnBytes);
  if (p2pBytes > 0) {
    incrementMetric("p2pBytesServed", p2pBytes);
    incrementMetric("p2pHits");
  } else if (cdnBytes > 0) {
    incrementMetric("p2pMisses");
  }
  if (rebufferCount > 0) {
    incrementMetric("totalRebufferCount", rebufferCount);
  }
  if (startupTime > 0) {
    incrementMetric("totalStartupTime", startupTime);
    incrementMetric("startupCount");
  }

  // Upsert the playback session (durable record).
  let session = await db.playbackSession.findUnique({ where: { id: sessionId } });
  if (!session) {
    session = await db.playbackSession.create({
      data: {
        id: sessionId,
        videoId,
        renditionId: body.renditionId || "",
        peerId: body.peerId || `p_${Math.random().toString(36).slice(2, 10)}`,
        browserId: body.browserId || "anon",
        networkType: body.networkType || "unknown",
        swarmId: body.swarmId || null,
        p2pEnabled: Boolean(body.p2pEnabled),
      },
    });
    // New session = count rebuffer sessions.
    incrementMetric("rebufferSessions");
  }

  // Record the telemetry point (durable — batched, not high-frequency).
  await db.playbackTelemetry.create({
    data: {
      sessionId,
      videoId,
      cdnBytes,
      p2pBytes,
      rebufferCount,
      rebufferDuration: Number(body.rebufferDuration) || 0,
      startupTime,
      peerCount: Number(body.peerCount) || 0,
      p2pFailures: Number(body.p2pFailures) || 0,
      httpFallbackCount: Number(body.httpFallbackCount) || 0,
      currentRendition: String(body.currentRendition || ""),
    },
  });

  return NextResponse.json({ ok: true });
}
