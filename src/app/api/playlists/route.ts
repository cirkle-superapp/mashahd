import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserState } from "@/lib/user-state";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * Playlists API — user-created video playlists.
 *
 * GET  /api/playlists?bid=<browserId>
 *   Returns all playlists owned by the caller, with item counts + cover URLs.
 *
 * POST /api/playlists
 *   Body: { browserId, title, description?, visibility? }
 *   Creates a new empty playlist. Returns the created playlist.
 *
 * Rate limited: 20 reads/min, 5 creates/min per IP.
 */
export async function GET(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`playlists-r:${ip}`, 20, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many requests" }, { status: 429 });
  }

  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  if (!bid) {
    return NextResponse.json({ error: "bid required" }, { status: 400 });
  }

  const state = await db.userState.findUnique({
    where: { browserId: bid },
    include: {
      playlists: {
        orderBy: { updatedAt: "desc" },
      },
    },
  });

  if (!state) {
    return NextResponse.json({ playlists: [] });
  }

  // Fetch item counts per playlist in one query (the turso wrapper doesn't
  // support Prisma's `_count` aggregation).
  const playlists = state.playlists || [];
  const counts = await db.playlistItem.findMany({
    where: { playlistId: { in: playlists.map((p: any) => p.id) } },
    select: { playlistId: true } as never,
  });
  const countMap: Record<string, number> = {};
  for (const c of counts) {
    countMap[c.playlistId] = (countMap[c.playlistId] || 0) + 1;
  }

  return NextResponse.json({
    playlists: playlists.map((p: any) => ({
      id: p.id,
      title: p.title,
      description: p.description,
      visibility: p.visibility,
      coverUrl: p.coverUrl,
      itemCount: countMap[p.id] || 0,
      createdAt: p.createdAt,
      updatedAt: p.updatedAt,
    })),
  });
}

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`playlists-c:${ip}`, 5, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many playlists created" }, { status: 429 });
  }

  const body = await req.json();
  const { browserId, title, description, visibility } = body || {};
  if (!browserId || !title || typeof title !== "string" || title.trim().length === 0) {
    return NextResponse.json({ error: "browserId + title required" }, { status: 400 });
  }
  if (title.length > 100) {
    return NextResponse.json({ error: "title too long (max 100)" }, { status: 400 });
  }

  // Upsert the user state (creates if missing).
  const state = await getUserState(browserId);

  const vis = ["public", "private", "unlisted"].includes(visibility)
    ? visibility
    : "public";

  const playlist = await db.playlist.create({
    data: {
      userStateId: state.id,
      title: title.trim(),
      description: (description || "").slice(0, 500),
      visibility: vis,
    },
  });

  return NextResponse.json({ playlist });
}
