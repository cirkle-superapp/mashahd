import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserState, parseList } from "@/lib/user-state";

/**
 * GET /api/user-state?bid=<browserId>
 * Returns the caller's liked video ids, subscribed channel ids, and watch
 * history (video ids, most recent first). The client uses these to populate
 * the "Liked", "Subscriptions", and "History" views.
 *
 * POST /api/user-state
 * Body: { browserId, action: "watch", videoId }
 * Adds a video to the watch history (most recent first, deduped, capped).
 */
export async function GET(req: NextRequest) {
  const bid = new URL(req.url).searchParams.get("bid") || "";
  if (!bid) {
    return NextResponse.json({
      likedVideoIds: [],
      subscribedChannelIds: [],
      watchedVideoIds: [],
    });
  }
  const st = await getUserState(bid);
  return NextResponse.json({
    likedVideoIds: parseList(st.likedVideoIds),
    subscribedChannelIds: parseList(st.subscribedChannelIds),
    watchedVideoIds: parseList(st.watchedVideoIds),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const browserId: string = body.browserId || "";
  const videoId: string = body.videoId || "";
  if (!browserId || !videoId) {
    return NextResponse.json({ error: "browserId+videoId required" }, { status: 400 });
  }
  const st = await getUserState(browserId);
  const watched = parseList(st.watchedVideoIds);
  // move to front, dedupe, cap at 50
  const idx = watched.indexOf(videoId);
  if (idx >= 0) watched.splice(idx, 1);
  watched.unshift(videoId);
  const capped = watched.slice(0, 50);
  await db.userState.update({
    where: { browserId },
    data: { watchedVideoIds: capped.join("|") },
  });
  return NextResponse.json({ ok: true, watchedVideoIds: capped });
}
