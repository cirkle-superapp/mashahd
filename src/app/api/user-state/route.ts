import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserState, parseList, joinList } from "@/lib/user-state";
import { issueBrowserId, verifyBrowserId } from "@/lib/browser-id-security";

/**
 * GET /api/user-state?bid=<browserId>
 * Returns the caller's liked / subscribed / watched / favorite / watch-later
 * video id lists.
 *
 * POST /api/user-state
 * Body: { browserId, action, videoId }
 *   action: "watch" | "favorite" | "unfavorite" | "watchLater" | "removeLater"
 * Toggles the appropriate list. "watch" moves the video to front of history.
 *
 * SECURITY (deep audit pass 2): if no browserId (or legacy unsigned bid),
 * issues a new cryptographically-signed browserId and returns it. The client
 * stores + sends this signed bid on all subsequent state-changing requests.
 */
export async function GET(req: NextRequest) {
  const bid = new URL(req.url).searchParams.get("bid") || "";
  if (!bid) {
    // First visit — issue a signed browserId.
    const newBid = issueBrowserId();
    return NextResponse.json({
      browserId: newBid,
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
  let browserId: string = body.browserId || "";

  // ── Issue signed browserId if none provided ──
  // The client calls POST with no body on first load to get a signed bid.
  if (!browserId) {
    const newBid = issueBrowserId();
    // Migrate legacy state if present.
    const legacyBid = typeof body.legacyBrowserId === "string" ? body.legacyBrowserId : "";
    let migrated: Record<string, string[]> = {};
    if (legacyBid) {
      try {
        const legacySt = await getUserState(legacyBid);
        migrated = {
          likedVideoIds: parseList(legacySt.likedVideoIds),
          subscribedChannelIds: parseList(legacySt.subscribedChannelIds),
          watchedVideoIds: parseList(legacySt.watchedVideoIds),
          favoriteVideoIds: parseList(legacySt.favoriteVideoIds),
          watchLaterIds: parseList(legacySt.watchLaterIds),
        };
      } catch { /* legacy state not found — start fresh */ }
    }
    return NextResponse.json({
      browserId: newBid,
      issued: true,
      migrated: Object.keys(migrated).length > 0,
      ...Object.fromEntries(
        Object.entries(migrated).map(([k, v]) => [k, v])
      ),
    });
  }

  // ── Verify signature on state-changing requests ──
  const verification = verifyBrowserId(browserId);
  if (!verification.valid) {
    return NextResponse.json(
      { error: "invalid browserId signature", reissue: true },
      { status: 403 }
    );
  }
  // If legacy bid, re-issue a signed one (caller will store + retry).
  if (verification.legacy) {
    const newBid = issueBrowserId();
    // Process the action with the legacy bid anyway (backward compat).
    browserId = verification.id;
    return NextResponse.json({
      ok: await processAction(browserId, body.videoId || "", body.action || ""),
      browserId: newBid,
      reissued: true,
    });
  }

  const videoId: string = body.videoId || "";
  const action: string = body.action || "";
  if (!videoId || !action) {
    return NextResponse.json({ error: "videoId+action required" }, { status: 400 });
  }

  const result = await processAction(browserId, videoId, action);
  return NextResponse.json({ ok: result });
}

async function processAction(browserId: string, videoId: string, action: string): Promise<boolean> {
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
    return true;
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
    return true;
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
    return true;
  }

  return false;
}
