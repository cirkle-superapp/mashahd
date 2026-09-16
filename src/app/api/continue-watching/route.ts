import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/continue-watching?bid=<browserId>
 * Returns videos the user has started but not finished, with resume positions.
 * Sorted by most recently watched.
 *
 * POST /api/continue-watching
 * Body: { browserId, videoId, position, completed?, playbackSpeed?, qualityPref?, audioLang?, subtitleLang? }
 * Upserts the playback state for cross-device resume (§32).
 *
 * DELETE /api/continue-watching
 * Body: { browserId, videoId }
 * Removes a video from continue watching.
 *
 * Per spec §32: "Synchronize playback state across devices. Persist where
 * appropriate: timestamp, playback speed, quality preference, audio track,
 * subtitle selection."
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  if (!bid) return NextResponse.json({ items: [] });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const items = await db.continueWatching.findMany({
    where: { userId: verification.id, completed: false },
    orderBy: { updatedAt: "desc" },
    take: 20,
  });

  // Fetch the full video + channel data for each item.
  const videoIds = items.map(i => i.videoId);
  const videos = videoIds.length > 0
    ? await db.video.findMany({
        where: { id: { in: videoIds } },
        include: { channel: true },
      })
    : [];

  const videoMap = new Map(videos.map(v => [v.id, v]));

  return NextResponse.json({
    items: items
      .filter(i => videoMap.has(i.videoId))
      .map(i => {
        const v = videoMap.get(i.videoId)!;
        return {
          videoId: i.videoId,
          position: i.position,
          completed: i.completed,
          playbackSpeed: i.playbackSpeed,
          qualityPref: i.qualityPref,
          audioLang: i.audioLang,
          subtitleLang: i.subtitleLang,
          updatedAt: i.updatedAt.toISOString(),
          video: v,
        };
      }),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const videoId: string = body.videoId || "";

  if (!bid || !videoId) {
    return NextResponse.json({ error: "browserId+videoId required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`continue:${ip}`, 60, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const position = Math.max(0, Number(body.position) || 0);
  const completed = !!body.completed;
  const playbackSpeed = [0.5, 0.75, 1, 1.25, 1.5, 2].includes(Number(body.playbackSpeed))
    ? Number(body.playbackSpeed) : 1;
  const qualityPref = typeof body.qualityPref === "string" ? body.qualityPref.slice(0, 20) : "auto";
  const audioLang = typeof body.audioLang === "string" ? body.audioLang.slice(0, 10) : "";
  const subtitleLang = typeof body.subtitleLang === "string" ? body.subtitleLang.slice(0, 10) : "";

  const item = await db.continueWatching.upsert({
    where: { userId_videoId: { userId: verification.id, videoId } },
    create: {
      userId: verification.id,
      videoId,
      position,
      completed,
      playbackSpeed,
      qualityPref,
      audioLang,
      subtitleLang,
    },
    update: {
      position,
      completed,
      playbackSpeed,
      qualityPref,
      audioLang,
      subtitleLang,
    },
  });

  return NextResponse.json({ ok: true, position: item.position, completed: item.completed });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const videoId: string = body.videoId || "";

  if (!bid || !videoId) {
    return NextResponse.json({ error: "browserId+videoId required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  await db.continueWatching.deleteMany({
    where: { userId: verification.id, videoId },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
