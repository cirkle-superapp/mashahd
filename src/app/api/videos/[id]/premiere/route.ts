import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/videos/[id]/premiere
 * Body: { premiereAt: "2026-01-01T20:00:00Z" }
 *
 * Video Premiere (gap feature from YouTube): schedule a video to auto-publish
 * at a future time. Before that time, the video has visibility="scheduled"
 * and shows a countdown timer. At the scheduled time, it flips to "public".
 *
 * This is the "premiere" feature that YouTube has — creators can build hype
 * before a video goes live, and viewers can set a reminder.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`premiere:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({} as any));
  const { premiereAt } = body;

  if (!premiereAt) {
    return NextResponse.json({ error: "premiereAt (ISO datetime) required" }, { status: 400 });
  }

  const premiereDate = new Date(premiereAt);
  if (isNaN(premiereDate.getTime())) {
    return NextResponse.json({ error: "invalid premiereAt datetime" }, { status: 400 });
  }

  if (premiereDate.getTime() <= Date.now()) {
    return NextResponse.json({ error: "premiereAt must be in the future" }, { status: 400 });
  }

  try {
    const video = await db.video.findUnique({ where: { id } });
    if (!video) {
      return NextResponse.json({ error: "video not found" }, { status: 404 });
    }

    // Set visibility to "scheduled" + publishedAt to the premiere time
    const updated = await db.video.update({
      where: { id },
      data: {
        visibility: "scheduled",
        publishedAt: premiereDate,
      },
    }).catch(() => null);

    if (!updated) {
      return NextResponse.json({ error: "failed to schedule premiere" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      video: {
        id: updated.id,
        title: updated.title,
        visibility: updated.visibility,
        publishedAt: updated.publishedAt,
        premiereAt: premiereDate.toISOString(),
        countdownMs: premiereDate.getTime() - Date.now(),
      },
      note: "Video is now scheduled as a premiere. It will automatically become public at the scheduled time.",
    });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
