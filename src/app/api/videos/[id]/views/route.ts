import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/videos/[id]/views
 * Increments the view counter for a video. Called when the player starts.
 */
export async function POST(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const updated = await db.video.update({
      where: { id },
      data: { views: { increment: 1 } },
      select: { views: true },
    });
    return NextResponse.json({ ok: true, views: updated.views });
  } catch {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
}
