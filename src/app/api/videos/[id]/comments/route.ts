import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/videos/[id]/comments
 * Returns all comments for a video. Top-level comments come with their
 * replies (max 2 levels of threading). Newest first.
 *
 * POST /api/videos/[id]/comments
 * Body: { author, avatarUrl, text, timestamp?, parentId? }
 *   - timestamp: optional number — pins the comment to a video moment.
 *   - parentId: optional string — posts as a reply to that comment.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Fetch top-level comments (parentId is null).
  const topLevel = await db.comment.findMany({
    where: { videoId: id, parentId: null },
    orderBy: { createdAt: "desc" },
    take: 100,
  });

  // Fetch all replies for these top-level comments in one query.
  const parentIds = topLevel.map((c: any) => c.id);
  const replies = parentIds.length > 0
    ? await db.comment.findMany({
        where: { parentId: { in: parentIds } },
        orderBy: { createdAt: "asc" },
      })
    : [];

  // Group replies by parentId.
  const repliesByParent: Record<string, any[]> = {};
  for (const r of replies) {
    const pid = (r as any).parentId;
    if (!repliesByParent[pid]) repliesByParent[pid] = [];
    repliesByParent[pid].push(r);
  }

  // Attach replies to their parents.
  const commentsWithReplies = topLevel.map((c: any) => ({
    ...c,
    replies: repliesByParent[c.id] || [],
  }));

  return NextResponse.json({ comments: commentsWithReplies });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = rateLimit(`comment-c:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many comments" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const author: string = (body.author || "Anonymous").slice(0, 60);
  const avatarUrl: string =
    body.avatarUrl ||
    `https://api.dicebear.com/7.x/initials/svg?seed=${encodeURIComponent(author)}`;
  const text: string = (body.text || "").trim().slice(0, 1000);
  const parentId: string | null = body.parentId ? String(body.parentId).slice(0, 60) : null;
  const timestamp: number | null =
    typeof body.timestamp === "number" && body.timestamp >= 0
      ? Math.floor(body.timestamp)
      : null;

  if (!text) {
    return NextResponse.json({ error: "text required" }, { status: 400 });
  }

  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // If parentId is set, verify the parent exists + belongs to this video.
  if (parentId) {
    const parent = await db.comment.findUnique({ where: { id: parentId } });
    if (!parent || parent.videoId !== id) {
      return NextResponse.json({ error: "parent comment not found" }, { status: 404 });
    }
    // Replies can't have timestamps (only top-level comments can be pinned).
  }

  const comment = await db.comment.create({
    data: {
      videoId: id,
      author,
      avatarUrl,
      text,
      parentId: parentId || undefined,
      timestamp: parentId ? undefined : (timestamp ?? undefined),
    },
  });
  return NextResponse.json({ comment });
}
