import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/videos/[id]/comments/[commentId]/moderate
 *
 * Creator-only moderation actions on a comment. The Pass 50 UI audit found
 * that creators have no way to Pin or Delete comments on their own videos.
 * This endpoint closes that gap.
 *
 * Body: { browserId, action: "pin" | "unpin" | "delete" }
 *
 * SECURITY:
 *   - Requires a valid signed browserId
 *   - The browserId's id must match the video's channel owner (creator-only)
 *   - Rate limited: 30 moderation actions per 5 minutes per IP
 *
 * Actions:
 *   - pin: sets CommentMeta.pinnedBy = <bid> + pinnedAt = now. Creates the
 *     CommentMeta row if it doesn't exist (upsert). Pinned comments float
 *     to the top of the comment list (the GET /comments route orders by
 *     pinnedAt desc, then likes desc).
 *   - unpin: clears pinnedBy + pinnedAt. The comment returns to its
 *     natural sort position.
 *   - delete: deletes the comment row. Cascade-deletes its replies (via
 *     the existing Comment.parentId relation). Also deletes the
 *     CommentMeta row if it exists.
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
  const action: string = ["pin", "unpin", "delete"].includes(body.action)
    ? body.action
    : "pin";

  if (!bid) {
    return NextResponse.json({ error: "browserId required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  // Rate limit: 30 moderation actions per 5 minutes per IP.
  const ip = getClientIP(req);
  const rl = await rateLimit(`comment-moderate:${ip}`, 30, 300_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — max 30 actions per 5 minutes" },
      { status: 429, headers: { "Retry-After": "300" } },
    );
  }

  try {
    // Fetch the comment + the video's channel in parallel.
    const [comment, video] = await Promise.all([
      db.comment.findUnique({
        where: { id: commentId },
        select: { id: true, videoId: true, parentId: true },
      }).catch(() => null),
      db.video.findUnique({
        where: { id: videoId },
        select: { id: true, channelId: true },
      }).catch(() => null),
    ]);

    if (!comment) {
      return NextResponse.json({ error: "comment not found" }, { status: 404 });
    }
    if (!video) {
      return NextResponse.json({ error: "video not found" }, { status: 404 });
    }
    if (comment.videoId !== videoId) {
      return NextResponse.json({ error: "comment does not belong to this video" }, { status: 400 });
    }

    // ── Verify the user is the channel owner (creator-only) ──
    // Look up the channel + check ownership via ownerId OR the links field
    // (anonymous ownership pattern: links contains "owner:<bid-id>").
    const channel = await db.channel.findUnique({
      where: { id: video.channelId },
      select: { id: true, ownerId: true, links: true },
    }).catch(() => null);

    if (!channel) {
      return NextResponse.json({ error: "channel not found" }, { status: 404 });
    }

    const ownsViaOwner = channel.ownerId === verification.id;
    const ownsViaLinks = channel.links?.includes(`owner:${verification.id}`);
    if (!ownsViaOwner && !ownsViaLinks) {
      return NextResponse.json(
        { error: "only the channel owner can moderate comments" },
        { status: 403 },
      );
    }

    // ── Perform the action ──
    if (action === "delete") {
      // Delete the comment. Cascade-deletes replies (parentId relation).
      // Also delete the CommentMeta row if it exists.
      await Promise.all([
        db.comment.delete({ where: { id: commentId } }).catch((e: any) => {
          console.warn("[moderate] delete comment failed:", e?.message?.slice(0, 200));
        }),
        db.commentMeta.deleteMany({ where: { commentId } }).catch(() => {}),
      ]);
      return NextResponse.json({ ok: true, action: "delete", commentId });
    }

    // pin / unpin: create or update the CommentMeta row.
    // (The Turso wrapper doesn't support `upsert` — we use find + create/update.)
    if (action === "pin") {
      try {
        // Check if a CommentMeta row already exists for this comment.
        const existing = await db.commentMeta.findUnique({ where: { commentId } }).catch(() => null);
        if (existing) {
          // Update the existing row.
          await db.commentMeta.update({
            where: { commentId },
            data: {
              pinnedBy: verification.id,
              pinnedAt: new Date(),
            },
          }).catch((e: any) => {
            console.warn("[moderate] pin update failed:", e?.message?.slice(0, 200));
          });
        } else {
          // Create a new CommentMeta row.
          await db.commentMeta.create({
            data: {
              commentId,
              isQuestion: false,
              isCreatorReply: false,
              pinnedBy: verification.id,
              pinnedAt: new Date(),
            },
          }).catch((e: any) => {
            console.warn("[moderate] pin create failed:", e?.message?.slice(0, 200));
          });
        }
      } catch (e: any) {
        console.error("[moderate] pin error:", e?.message?.slice(0, 200));
      }
      return NextResponse.json({ ok: true, action: "pin", commentId, pinnedBy: verification.id });
    }

    if (action === "unpin") {
      // Clear pinnedBy + pinnedAt (if the CommentMeta row exists).
      await db.commentMeta.updateMany({
        where: { commentId },
        data: {
          pinnedBy: null,
          pinnedAt: null,
        },
      }).catch((e: any) => {
        console.warn("[moderate] unpin failed:", e?.message?.slice(0, 200));
      });
      return NextResponse.json({ ok: true, action: "unpin", commentId });
    }

    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  } catch (e: any) {
    console.error("[moderate] error:", e?.message?.slice(0, 200));
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
