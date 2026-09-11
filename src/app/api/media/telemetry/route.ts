import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/media/telemetry
 * Body: { sessionId, videoId, cdnBytes, p2pBytes, rebufferCount, ... }
 * Batched telemetry from the player. Called every 10-30s + on events.
 *
 * Also creates a PlaybackSession if this is the first report.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const sessionId: string = body.sessionId || "";
  const videoId: string = body.videoId || "";

  if (!sessionId || !videoId) {
    return NextResponse.json({ error: "sessionId + videoId required" }, { status: 400 });
  }

  // Upsert the playback session.
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
  }

  // Record the telemetry point.
  await db.playbackTelemetry.create({
    data: {
      sessionId,
      videoId,
      cdnBytes: Number(body.cdnBytes) || 0,
      p2pBytes: Number(body.p2pBytes) || 0,
      rebufferCount: Number(body.rebufferCount) || 0,
      rebufferDuration: Number(body.rebufferDuration) || 0,
      startupTime: Number(body.startupTime) || 0,
      peerCount: Number(body.peerCount) || 0,
      p2pFailures: Number(body.p2pFailures) || 0,
      httpFallbackCount: Number(body.httpFallbackCount) || 0,
      currentRendition: String(body.currentRendition || ""),
    },
  });

  return NextResponse.json({ ok: true });
}
