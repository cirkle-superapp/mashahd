import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
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
