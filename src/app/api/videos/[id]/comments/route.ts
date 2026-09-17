import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/videos/[id]/comments?sort=<sort>
 *
 * Returns all comments for a video. Top-level comments come with their
 * replies (max 2 levels of threading).
 *
 * Per spec §22 — comment sort options:
 *   - top (default): highest likes first
 *   - newest: newest first
 *   - creator_replies: comments with creator replies first
 *   - questions: comments marked as questions first
 *   - unanswered: questions with no replies first
 *   - most_discussed: comments with the most replies first
 *
 * POST /api/videos/[id]/comments
 * Body: { author, avatarUrl, text, timestamp?, parentId?, isQuestion? }
 *   - timestamp: optional number — pins the comment to a video moment.
 *   - parentId: optional string — posts as a reply to that comment.
 *   - isQuestion: optional boolean — marks as a question (§22).
 */

const VALID_SORTS = ["top", "newest", "creator_replies", "questions", "unanswered", "most_discussed"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const sort = VALID_SORTS.includes(url.searchParams.get("sort") || "top")
    ? (url.searchParams.get("sort") as string)
    : "top";

  // Fetch top-level comments (parentId is null).
  const topLevel = await db.comment.findMany({
    where: { videoId: id, parentId: null },
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

  // Fetch CommentMeta for the top-level comments (for question/creator reply flags).
  let metaMap: Record<string, any> = {};
  let replyMetaMap: Record<string, boolean> = {};
  if (topLevel.length > 0) {
    try {
      const metas = await (db as any).commentMeta.findMany({
        where: { commentId: { in: parentIds } },
      });
      for (const m of metas) {
        metaMap[m.commentId] = m;
      }
      // Also fetch metas for replies (to detect isCreatorReply on replies).
      if (replies.length > 0) {
        const replyIds = replies.map((r: any) => (r as any).id);
        const replyMetas = await (db as any).commentMeta.findMany({
          where: { commentId: { in: replyIds }, isCreatorReply: true },
        });
        for (const rm of replyMetas) {
          replyMetaMap[rm.commentId] = true;
        }
      }
    } catch { /* CommentMeta table may not exist in some environments */ }
  }

  // Fetch the video to get the channelId (for creator_replies sort — a reply
  // from the channel owner counts as a "creator reply").
  const video = await db.video.findUnique({
    where: { id },
    select: { channelId: true },
  });
  // Fetch the channel owner to compare avatars (simplified creator detection).
  let creatorAvatarUrl: string | null = null;
  if (video) {
    const channel = await db.channel.findUnique({
      where: { id: video.channelId },
      select: { avatarUrl: true },
    });
    creatorAvatarUrl = channel?.avatarUrl || null;
  }

  // Attach replies + meta to each top-level comment.
  let commentsWithReplies = topLevel.map((c: any) => {
    const meta = metaMap[c.id] || {};
    const commentReplies = repliesByParent[c.id] || [];
    // Check if any reply is from the creator (by avatar match).
    const hasCreatorReply = creatorAvatarUrl
      ? commentReplies.some((r: any) => r.avatarUrl === creatorAvatarUrl)
      : false;
    // Check if any reply is marked as isCreatorReply in CommentMeta.
    const metaHasCreatorReply = commentReplies.some((r: any) => replyMetaMap[(r as any).id]);
    return {
      ...c,
      replies: commentReplies,
      isQuestion: meta.isQuestion || false,
      hasCreatorReply: hasCreatorReply || metaHasCreatorReply,
      replyCount: commentReplies.length,
      pinned: !!meta.pinnedBy,
    };
  });

  // Apply sort (§22).
  switch (sort) {
    case "newest":
      commentsWithReplies.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
      break;
    case "top":
      // Pinned first, then by likes.
      commentsWithReplies.sort((a, b) => {
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.likes - a.likes;
      });
      break;
    case "creator_replies":
      // Comments with creator replies first, then by likes.
      commentsWithReplies.sort((a, b) => {
        if (a.hasCreatorReply && !b.hasCreatorReply) return -1;
        if (!a.hasCreatorReply && b.hasCreatorReply) return 1;
        return b.likes - a.likes;
      });
      break;
    case "questions":
      // Questions first, then by likes.
      commentsWithReplies.sort((a, b) => {
        if (a.isQuestion && !b.isQuestion) return -1;
        if (!a.isQuestion && b.isQuestion) return 1;
        return b.likes - a.likes;
      });
      break;
    case "unanswered":
      // Questions with no replies first, then all questions, then rest.
      commentsWithReplies.sort((a, b) => {
        const aUnanswered = a.isQuestion && a.replyCount === 0;
        const bUnanswered = b.isQuestion && b.replyCount === 0;
        if (aUnanswered && !bUnanswered) return -1;
        if (!aUnanswered && bUnanswered) return 1;
        if (a.isQuestion && !b.isQuestion) return -1;
        if (!a.isQuestion && b.isQuestion) return 1;
        return b.likes - a.likes;
      });
      break;
    case "most_discussed":
      // Most replies first.
      commentsWithReplies.sort((a, b) => b.replyCount - a.replyCount);
      break;
  }

  return NextResponse.json({ comments: commentsWithReplies, sort });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`comment-c:${ip}`, 10, 60_000);
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
  const isQuestion: boolean = !!body.isQuestion;

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

  // If isQuestion is true, create a CommentMeta entry (§22).
  if (isQuestion && !parentId) {
    try {
      await (db as any).commentMeta.create({
        data: {
          commentId: comment.id,
          isQuestion: true,
        },
      });
    } catch { /* CommentMeta table may not exist */ }
  }

  return NextResponse.json({ comment });
}
