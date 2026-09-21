import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserState, parseList } from "@/lib/user-state";
import { verifyBrowserId } from "@/lib/browser-id-security";

/**
 * GET /api/videos/[id]
 * Returns the video plus its channel, plus the caller's like/subscription
 * status (driven by `?bid=<browserId>`).
 *
 * Pass 56: also returns `isCreator` — true if the caller's browserId owns
 * the video's channel. This powers the comment moderation UI (Pin/Delete
 * buttons visible only to the channel owner).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const { id } = await params;
    const video = await db.video.findUnique({
      where: { id },
      include: { channel: true },
    });
    if (!video) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // Fetch caller state to compute like/subscribe flags. We don't require a
    // browserId for read; absence just means "not liked".
    const bid = new URL(_req.url).searchParams.get("bid") || "";
    let liked = false;
    let disliked = false;
    let subscribed = false;
    let isCreator = false;
    if (bid) {
      const st = await getUserState(bid);
      liked = parseList(st.likedVideoIds).includes(id);
      disliked = parseList((st as any).dislikedVideoIds ?? "").includes(id);
      subscribed = parseList(st.subscribedChannelIds).includes(video.channelId);

      // Check if the caller owns the video's channel. The channel ownership
      // is tracked via: (1) channel.ownerId === bid.id (for registered users)
      // OR (2) channel.links contains "owner:<bid.id>" (for anonymous users).
      // Both require the bid to be a valid signed browserId.
      const verification = verifyBrowserId(bid);
      if (verification.valid) {
        const channel = video.channel as any;
        const ownsViaOwner = channel.ownerId === verification.id;
        const ownsViaLinks = channel.links?.includes(`owner:${verification.id}`);
        isCreator = !!ownsViaOwner || !!ownsViaLinks;
      }
    }

    return NextResponse.json({ video, liked, disliked, subscribed, isCreator });
  } catch {
    // DB or other unexpected errors → return a clean JSON 500 instead of
    // Next.js's default HTML 500 page (which would crash client fetchers
    // that expect JSON).
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
