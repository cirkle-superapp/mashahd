import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET  /api/clips/[id]
 *   Returns a single clip with its video metadata. Increments the view
 *   count on each GET (clip views are a vanity metric for creators).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = rateLimit(`clips-v:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const clip = await db.clip.findUnique({
    where: { id },
    include: { video: { include: { channel: true } } },
  });
  if (!clip) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Increment view count (best-effort).
  try {
    await db.clip.update({
      where: { id },
      data: { views: { increment: 1 } },
    });
  } catch {
    /* ignore */
  }

  return NextResponse.json({
    clip: {
      id: clip.id,
      videoId: clip.videoId,
      creatorId: clip.creatorId,
      creatorName: clip.creatorName,
      title: clip.title,
      startSec: clip.startSec,
      endSec: clip.endSec,
      note: clip.note,
      views: clip.views + 1,
      createdAt: clip.createdAt,
    },
    video: clip.video,
  });
}
