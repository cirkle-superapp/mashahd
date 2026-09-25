import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/live-tv-channels/[id]
 * Returns a single live TV channel by ID.
 *
 * PATCH /api/live-tv-channels/[id]
 * Updates channel metadata (nowPlaying, nextProgram, isLive, viewers).
 *
 * DELETE /api/live-tv-channels/[id]
 * Removes the channel (owner-only in production).
 */
export async function GET(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const channel = await db.liveTVChannel.findUnique({ where: { id } }).catch(() => null);
    if (!channel) return NextResponse.json({ error: "not found" }, { status: 404 });

    return NextResponse.json({
      channel: {
        id: (channel as any).id, name: (channel as any).name, slug: (channel as any).slug,
        logoUrl: (channel as any).logoUrl, description: (channel as any).description,
        category: (channel as any).category, country: (channel as any).country,
        language: (channel as any).language, streamUrl: (channel as any).streamUrl,
        streamType: (channel as any).streamType, isLive: !!(channel as any).isLive,
        isVerified: !!(channel as any).isVerified, nowPlaying: (channel as any).nowPlaying,
        nextProgram: (channel as any).nextProgram, viewers: (channel as any).viewers,
      },
    });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export async function PATCH(req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const data: any = { updatedAt: new Date() };
  if (typeof body.isLive === "boolean") data.isLive = body.isLive;
  if (typeof body.nowPlaying === "string") data.nowPlaying = body.nowPlaying.slice(0, 200);
  if (typeof body.nextProgram === "string") data.nextProgram = body.nextProgram.slice(0, 200);
  if (typeof body.viewers === "number") data.viewers = Math.max(0, body.viewers);

  try {
    const updated = await db.liveTVChannel.update({ where: { id }, data }).catch(() => null);
    if (!updated) return NextResponse.json({ error: "not found" }, { status: 404 });
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

export async function DELETE(_req: NextRequest, { params }: { params: Promise<{ id: string }> }) {
  const { id } = await params;
  try {
    await db.liveTVChannel.deleteMany({ where: { id } }).catch(() => {});
    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
