import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserState, parseList, joinList } from "@/lib/user-state";

/**
 * GET /api/user-state?bid=<browserId>
 * Returns the caller's liked / subscribed / watched / favorite / watch-later
 * video id lists.
 *
 * POST /api/user-state
 * Body: { browserId, action, videoId }
 *   action: "watch" | "favorite" | "unfavorite" | "watchLater" | "removeLater"
 * Toggles the appropriate list. "watch" moves the video to front of history.
 */
export async function GET(req: NextRequest) {
  const bid = new URL(req.url).searchParams.get("bid") || "";
  if (!bid) {
    return NextResponse.json({
      likedVideoIds: [],
      subscribedChannelIds: [],
      watchedVideoIds: [],
      favoriteVideoIds: [],
      watchLaterIds: [],
    });
  }
  const st = await getUserState(bid);
  return NextResponse.json({
    likedVideoIds: parseList(st.likedVideoIds),
    subscribedChannelIds: parseList(st.subscribedChannelIds),
    watchedVideoIds: parseList(st.watchedVideoIds),
    favoriteVideoIds: parseList(st.favoriteVideoIds),
    watchLaterIds: parseList(st.watchLaterIds),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const browserId: string = body.browserId || "";
  const videoId: string = body.videoId || "";
  const action: string = body.action || "";
  if (!browserId || !videoId || !action) {
    return NextResponse.json({ error: "browserId+videoId+action required" }, { status: 400 });
  }
  const st = await getUserState(browserId);

  if (action === "watch") {
    const watched = parseList(st.watchedVideoIds);
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

  if (action === "favorite" || action === "unfavorite") {
    const favs = parseList(st.favoriteVideoIds);
    if (action === "favorite" && !favs.includes(videoId)) {
      favs.push(videoId);
    } else if (action === "unfavorite" && favs.includes(videoId)) {
      const i = favs.indexOf(videoId);
      favs.splice(i, 1);
    }
    await db.userState.update({
      where: { browserId },
      data: { favoriteVideoIds: joinList(favs) },
    });
    return NextResponse.json({ ok: true, favoriteVideoIds: favs });
  }

  if (action === "watchLater" || action === "removeLater") {
    const later = parseList(st.watchLaterIds);
    if (action === "watchLater" && !later.includes(videoId)) {
      later.push(videoId);
    } else if (action === "removeLater" && later.includes(videoId)) {
      const i = later.indexOf(videoId);
      later.splice(i, 1);
    }
    await db.userState.update({
      where: { browserId },
      data: { watchLaterIds: joinList(later) },
    });
    return NextResponse.json({ ok: true, watchLaterIds: later });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
