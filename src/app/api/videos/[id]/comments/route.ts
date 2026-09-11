import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/videos/[id]/comments
 * Returns all comments for a video, newest first.
 *
 * POST /api/videos/[id]/comments
 * Body: { author, avatarUrl, text }
 * Adds a new comment to the video.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const comments = await db.comment.findMany({
    where: { videoId: id },
    orderBy: { createdAt: "desc" },
  });
  return NextResponse.json({ comments });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const author: string = (body.author || "Anonymous").slice(0, 60);
  const avatarUrl: string =
    body.avatarUrl ||
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(author)}`;
  const text: string = (body.text || "").trim().slice(0, 1000);

  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const comment = await db.comment.create({
    data: { videoId: id, author, avatarUrl, text },
  });
  return NextResponse.json({ comment });
}
