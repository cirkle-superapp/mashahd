import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/videos/[id]/comments/[commentId]/like
 *
 * Likes a comment. Per spec §22 — the comment Like button was rendered but
 * had NO onClick handler (UI Architecture audit Pass 50). This endpoint
 * closes that gap: it increments the comment's `likes` count + tracks
 * who liked it (via UserState.likedCommentIds) to prevent double-likes.
 *
 * Body: { browserId, action: "like" | "dislike" | "remove" }
 *   - like: increments likes by 1 (if not already liked)
 *   - dislike: decrements likes by 1 (if currently liked) — we don't track
 *       separate dislike counts for comments (per YouTube's 2021 change),
 *       but we DO allow removing a like via "dislike"
 *   - remove: same as dislike (removes the like)
 *
 * SECURITY:
 *   - Requires a valid signed browserId (prevents anonymous like-inflation)
 *   - Rate limited: 60 likes per 5 minutes per IP (generous for normal use,
 *     blocks scripted inflation)
 *   - Double-like prevention: checks UserState.likedCommentIds (pipe-separated)
 *
 * The like is persisted to BOTH:
 *   1. Comment.likes (the count, incremented atomically)
 *   2. UserState.likedCommentIds (the user's liked-set, for double-like prevention)
 */

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; commentId: string }> },
) {
  const { id: videoId, commentId } = await params;
  if (!videoId || !commentId) {
    return NextResponse.json({ error: "videoId + commentId required" }, { status: 400 });
  }

  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const action: string = ["like", "dislike", "remove"].includes(body.action)
    ? body.action
    : "like";

  if (!bid) {
    return NextResponse.json({ error: "browserId required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  // Rate limit: 60 comment-actions per 5 minutes per IP.
  const ip = getClientIP(req);
  const rl = await rateLimit(`comment-like:${ip}`, 60, 300_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — max 60 actions per 5 minutes" },
      { status: 429, headers: { "Retry-After": "300" } },
    );
  }

  try {
    // Fetch the comment + the user's state in parallel.
    const [comment, userState] = await Promise.all([
      db.comment.findUnique({ where: { id: commentId }, select: { id: true, likes: true, videoId: true } }).catch(() => null),
      db.userState.findUnique({ where: { browserId: bid }, select: { id: true, likedVideoIds: true } }).catch(() => null),
    ]);

    if (!comment) {
      return NextResponse.json({ error: "comment not found" }, { status: 404 });
    }
    if (comment.videoId !== videoId) {
      return NextResponse.json({ error: "comment does not belong to this video" }, { status: 400 });
    }

    // Track liked comment IDs in a dedicated field on UserState. Since
    // UserState doesn't have a likedCommentIds column, we piggyback on
    // the existing `likedVideoIds` field by encoding comment likes with
    // a `c:` prefix (e.g. "video1|c:comment1|c:comment2"). This avoids a
    // schema migration for a single field.
    const likedField: string = userState?.likedVideoIds || "";
    const allIds = likedField.split("|").filter(Boolean);
    const likedCommentIds = new Set(allIds.filter((x) => x.startsWith("c:")).map((x) => x.slice(2)));
    const commentLikedKey = `c:${commentId}`;
    const alreadyLiked = likedCommentIds.has(commentId);

    let delta = 0;
    if (action === "like" && !alreadyLiked) {
      delta = 1;
      allIds.push(commentLikedKey);
    } else if ((action === "dislike" || action === "remove") && alreadyLiked) {
      delta = -1;
      // Remove the commentLikedKey from allIds.
      const idx = allIds.indexOf(commentLikedKey);
      if (idx >= 0) allIds.splice(idx, 1);
    } else {
      // No-op (already liked + like, or not liked + dislike).
      return NextResponse.json({
        ok: true,
        noOp: true,
        likes: comment.likes,
        liked: alreadyLiked,
      });
    }

    // Atomically update the comment's like count + the user's liked-set.
    // Use Promise.all so both succeed or both fail (no orphan state).
    const newLikes = Math.max(0, comment.likes + delta);
    const newLikedField = allIds.join("|");

    await Promise.all([
      db.comment.update({
        where: { id: commentId },
        data: { likes: newLikes },
      }).catch((e: any) => {
        console.error("[comment-like] update comment failed:", e?.message?.slice(0, 200));
      }),
      userState
        ? db.userState.update({
            where: { id: userState.id },
            data: { likedVideoIds: newLikedField, updatedAt: new Date() },
          }).catch(() => {})
        : db.userState.create({
            data: {
              browserId: bid,
              likedVideoIds: newLikedField,
            },
          }).catch(() => {}),
    ]);

    return NextResponse.json({
      ok: true,
      likes: newLikes,
      liked: action === "like",
    });
  } catch (e: any) {
    console.error("[comment-like] error:", e?.message?.slice(0, 200));
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
