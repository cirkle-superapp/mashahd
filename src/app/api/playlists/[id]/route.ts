import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET  /api/playlists/[id]
 *   Returns a single playlist with its videos (in order).
 *   Public/unlisted playlists are viewable by anyone; private only by owner.
 *
 * PATCH /api/playlists/[id]
 *   Body: { browserId, title?, description?, visibility? }
 *   Updates playlist metadata (owner only).
 *
 * DELETE /api/playlists/[id]
 *   Body: { browserId }  — owner only.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";

  const playlist = await db.playlist.findUnique({ where: { id } });
  if (!playlist) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Private playlists are only viewable by the owner.
  let isOwner = false;
  if (bid) {
    const state = await db.userState.findUnique({ where: { browserId: bid } });
    isOwner = !!state && state.id === playlist.userStateId;
  }
  if (playlist.visibility === "private" && !isOwner) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Fetch items in order, then their videos+channels separately (the turso
  // wrapper doesn't support nested includes).
  const items = await db.playlistItem.findMany({
    where: { playlistId: id },
    orderBy: { position: "asc" },
  });

  const videoIds = items.map((i: any) => i.videoId);
  const videos = videoIds.length > 0
    ? await db.video.findMany({ where: { id: { in: videoIds } } })
    : [];
  const videoMap: Record<string, any> = {};
  for (const v of videos) videoMap[v.id] = v;

  const channelIds = [...new Set(videos.map((v: any) => v.channelId))];
  const channels = channelIds.length > 0
    ? await db.channel.findMany({ where: { id: { in: channelIds } } })
    : [];
  const channelMap: Record<string, any> = {};
  for (const c of channels) channelMap[c.id] = c;

  return NextResponse.json({
    playlist: {
      id: playlist.id,
      title: playlist.title,
      description: playlist.description,
      visibility: playlist.visibility,
      coverUrl: playlist.coverUrl,
      createdAt: playlist.createdAt,
      updatedAt: playlist.updatedAt,
      isOwner,
    },
    videos: items.map((item: any) => {
      const v = videoMap[item.videoId];
      if (!v) return null;
      return {
        itemId: item.id,
        position: item.position,
        addedAt: item.addedAt,
        video: { ...v, channel: channelMap[v.channelId] || null },
      };
    }).filter(Boolean),
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = rateLimit(`playlists-u:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many updates" }, { status: 429 });
  }

  const body = await req.json();
  const { browserId, title, description, visibility } = body || {};
  if (!browserId) {
    return NextResponse.json({ error: "browserId required" }, { status: 400 });
  }

  const state = await db.userState.findUnique({ where: { browserId } });
  if (!state) {
    return NextResponse.json({ error: "state not found" }, { status: 404 });
  }

  const existing = await db.playlist.findUnique({ where: { id } });
  if (!existing || existing.userStateId !== state.id) {
    return NextResponse.json({ error: "not found or not owner" }, { status: 404 });
  }

  const data: Record<string, unknown> = {};
  if (typeof title === "string" && title.trim().length > 0) data.title = title.trim().slice(0, 100);
  if (typeof description === "string") data.description = description.slice(0, 500);
  if (["public", "private", "unlisted"].includes(visibility)) data.visibility = visibility;

  const updated = await db.playlist.update({ where: { id }, data });
  return NextResponse.json({ playlist: updated });
}

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = rateLimit(`playlists-d:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many deletes" }, { status: 429 });
  }

  const body = await req.json();
  const { browserId } = body || {};
  if (!browserId) {
    return NextResponse.json({ error: "browserId required" }, { status: 400 });
  }

  const state = await db.userState.findUnique({ where: { browserId } });
  if (!state) {
    return NextResponse.json({ error: "state not found" }, { status: 404 });
  }

  const existing = await db.playlist.findUnique({ where: { id } });
  if (!existing || existing.userStateId !== state.id) {
    return NextResponse.json({ error: "not found or not owner" }, { status: 404 });
  }

  await db.playlist.delete({ where: { id } });
  return NextResponse.json({ ok: true });
}
