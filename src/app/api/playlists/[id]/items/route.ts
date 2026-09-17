import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";
import { parseList } from "@/lib/user-state";

/**
 * GET /api/playlists/[id]/items?bid=<browserId>&filter=<filter>
 * Returns all items in a playlist, with optional filtering (§29).
 *   filter: all (default) | watched | unwatched | unavailable
 *   sort: position (default) | newest | oldest
 *
 * Per spec §29: "Add missing: watched/unwatched filtering, remove watched,
 * remove unavailable."
 *
 * POST /api/playlists/[id]/items
 *   Body: { browserId, videoId }
 *   Adds a video to the playlist. If the video is already in the playlist,
 *   returns 409 (idempotent — no duplicate). The position is appended to the
 *   end. If this is the first item, the playlist's coverUrl is auto-set to
 *   the video's thumbnail.
 *
 * DELETE /api/playlists/[id]/items?itemId=<itemId>&browserId=<bid>
 *   Removes an item from the playlist (owner only). Positions are compacted
 *   after removal so ordering stays consistent.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  const filter = url.searchParams.get("filter") || "all";
  const sort = url.searchParams.get("sort") || "position";

  const playlist = await db.playlist.findUnique({ where: { id } });
  if (!playlist) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let items = await db.playlistItem.findMany({
    where: { playlistId: id },
    orderBy: sort === "newest" ? { addedAt: "desc" } : sort === "oldest" ? { addedAt: "asc" } : { position: "asc" },
  });

  // Fetch video data for each item.
  const videoIds = items.map((i: any) => i.videoId);
  const videos = videoIds.length > 0
    ? await db.video.findMany({
        where: { id: { in: videoIds } },
        include: { channel: true },
      })
    : [];
  const videoMap = new Map(videos.map((v: any) => [v.id, v]));

  // Get the user's watched video IDs for the watched/unwatched filter.
  let watchedIds = new Set<string>();
  if (bid && (filter === "watched" || filter === "unwatched")) {
    const state = await db.userState.findUnique({ where: { browserId: bid } });
    if (state) {
      watchedIds = new Set(parseList(state.watchedVideoIds));
    }
  }

  // Apply filter (§29).
  let filteredItems = items.map((item: any) => {
    const video = videoMap.get(item.videoId);
    return {
      id: item.id,
      videoId: item.videoId,
      position: item.position,
      addedAt: item.addedAt?.toISOString(),
      video,
      isWatched: watchedIds.has(item.videoId),
      isAvailable: !!video,
    };
  });

  if (filter === "watched") {
    filteredItems = filteredItems.filter((i: any) => i.isWatched);
  } else if (filter === "unwatched") {
    filteredItems = filteredItems.filter((i: any) => !i.isWatched);
  } else if (filter === "unavailable") {
    filteredItems = filteredItems.filter((i: any) => !i.isAvailable);
  }

  return NextResponse.json({
    items: filteredItems,
    total: items.length,
    filtered: filteredItems.length,
    filter,
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`playlist-add:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many adds" }, { status: 429 });
  }

  const body = await req.json();
  const { browserId, videoId } = body || {};
  if (!browserId || !videoId) {
    return NextResponse.json({ error: "browserId + videoId required" }, { status: 400 });
  }

  const state = await db.userState.findUnique({ where: { browserId } });
  if (!state) {
    return NextResponse.json({ error: "state not found" }, { status: 404 });
  }

  const playlist = await db.playlist.findUnique({ where: { id } });
  if (!playlist || playlist.userStateId !== state.id) {
    return NextResponse.json({ error: "not found or not owner" }, { status: 404 });
  }

  // Verify the video exists.
  const video = await db.video.findUnique({ where: { id: videoId } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  // Idempotent — if already in playlist, return existing.
  const existing = await db.playlistItem.findUnique({
    where: { playlistId_videoId: { playlistId: id, videoId } },
  });
  if (existing) {
    return NextResponse.json({ item: existing, alreadyExists: true });
  }

  // Append at end.
  const count = await db.playlistItem.count({ where: { playlistId: id } });
  const item = await db.playlistItem.create({
    data: { playlistId: id, videoId, position: count },
  });

  // Auto-set cover to the first video's thumbnail if none set.
  if (!playlist.coverUrl && video.thumbnailUrl) {
    await db.playlist.update({
      where: { id },
      data: { coverUrl: video.thumbnailUrl, updatedAt: new Date() },
    });
  } else {
    await db.playlist.update({ where: { id }, data: { updatedAt: new Date() } });
  }

  return NextResponse.json({ item });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`playlist-rm:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many removes" }, { status: 429 });
  }

  const url = new URL(req.url);
  const itemId = url.searchParams.get("itemId") || "";
  const browserId = url.searchParams.get("browserId") || "";
  if (!itemId || !browserId) {
    return NextResponse.json({ error: "itemId + browserId required" }, { status: 400 });
  }

  const state = await db.userState.findUnique({ where: { browserId } });
  if (!state) {
    return NextResponse.json({ error: "state not found" }, { status: 404 });
  }

  const playlist = await db.playlist.findUnique({ where: { id } });
  if (!playlist || playlist.userStateId !== state.id) {
    return NextResponse.json({ error: "not found or not owner" }, { status: 404 });
  }

  const item = await db.playlistItem.findUnique({ where: { id: itemId } });
  if (!item || item.playlistId !== id) {
    return NextResponse.json({ error: "item not found" }, { status: 404 });
  }

  const removedPos = item.position;
  await db.playlistItem.delete({ where: { id: itemId } });

  // Compact positions for items after the removed one.
  await db.playlistItem.updateMany({
    where: { playlistId: id, position: { gt: removedPos } },
    data: { position: { decrement: 1 } },
  });

  // If the playlist is now empty, clear the cover.
  const remaining = await db.playlistItem.count({ where: { playlistId: id } });
  if (remaining === 0) {
    await db.playlist.update({ where: { id }, data: { coverUrl: "", updatedAt: new Date() } });
  } else {
    await db.playlist.update({ where: { id }, data: { updatedAt: new Date() } });
  }

  return NextResponse.json({ ok: true, remaining });
}
