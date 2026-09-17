import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * Clips API — user-created short segments of videos (viral growth feature).
 *
 * GET  /api/clips?videoId=<id>
 *   Returns all clips for a video, newest first.
 *
 * POST /api/clips
 *   Body: { videoId, creatorId, creatorName?, title, startSec, endSec, note? }
 *   Creates a new clip. Validates: 5s ≤ (endSec - startSec) ≤ 120s, and
 *   both bounds within [0, video.durationSec].
 *
 * §43: "Creators must be able to control clipping behavior."
 * The video's clipPolicy field controls whether clips are allowed:
 *   - "allowed" (default): anyone can clip
 *   - "disabled": no clips allowed (returns 403)
 *   - "followers_only": only subscribers can clip (checked via UserState)
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const videoId = url.searchParams.get("videoId") || "";
  if (!videoId) {
    return NextResponse.json({ error: "videoId required" }, { status: 400 });
  }

  const clips = await db.clip.findMany({
    where: { videoId },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  return NextResponse.json({
    clips: clips.map((c: any) => ({
      id: c.id,
      videoId: c.videoId,
      creatorId: c.creatorId,
      creatorName: c.creatorName,
      title: c.title,
      startSec: c.startSec,
      endSec: c.endSec,
      note: c.note,
      views: c.views,
      createdAt: c.createdAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`clips-c:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many clips created" }, { status: 429 });
  }

  const body = await req.json();
  const { videoId, creatorId, creatorName, title, startSec, endSec, note } = body || {};
  if (!videoId || !creatorId || !title || typeof startSec !== "number" || typeof endSec !== "number") {
    return NextResponse.json({ error: "videoId, creatorId, title, startSec, endSec required" }, { status: 400 });
  }

  const video = await db.video.findUnique({ where: { id: videoId } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  // §43: Enforce clip policy.
  const clipPolicy = (video as any).clipPolicy || "allowed";
  if (clipPolicy === "disabled") {
    return NextResponse.json(
      { error: "Clipping is disabled for this video by the creator." },
      { status: 403 }
    );
  }
  if (clipPolicy === "followers_only") {
    // Check if the clipper is a subscriber of the channel.
    const state = await db.userState.findUnique({ where: { browserId: creatorId } });
    if (!state) {
      return NextResponse.json(
        { error: "Clipping is followers-only. Subscribe to the channel to clip." },
        { status: 403 }
      );
    }
    const subs = (state.subscribedChannelIds || "").split("|").filter(Boolean);
    if (!subs.includes(video.channelId)) {
      return NextResponse.json(
        { error: "Clipping is followers-only. Subscribe to the channel to clip." },
        { status: 403 }
      );
    }
  }

  // Validate the clip bounds.
  const duration = video.durationSec || 0;
  const len = endSec - startSec;
  if (len < 5) {
    return NextResponse.json({ error: "Clip must be at least 5 seconds" }, { status: 400 });
  }
  if (len > 120) {
    return NextResponse.json({ error: "Clip must be at most 120 seconds" }, { status: 400 });
  }
  if (startSec < 0 || endSec > duration) {
    return NextResponse.json({ error: `Clip must be within [0, ${duration}]` }, { status: 400 });
  }

  const clip = await db.clip.create({
    data: {
      videoId,
      creatorId,
      creatorName: String(creatorName || "Anonymous").slice(0, 60),
      title: String(title).slice(0, 120),
      startSec: Math.floor(startSec),
      endSec: Math.floor(endSec),
      note: String(note || "").slice(0, 300),
    },
  });

  return NextResponse.json({ clip });
}
