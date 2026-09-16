import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserState, parseList } from "@/lib/user-state";

/**
 * GET /api/videos/[id]
 * Returns the video plus its channel, plus the caller's like/subscription
 * status (driven by `?bid=<browserId>`).
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
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
  if (bid) {
    const st = await getUserState(bid);
    liked = parseList(st.likedVideoIds).includes(id);
    disliked = parseList((st as any).dislikedVideoIds ?? "").includes(id);
    subscribed = parseList(st.subscribedChannelIds).includes(video.channelId);
  }

  return NextResponse.json({ video, liked, disliked, subscribed });
}
