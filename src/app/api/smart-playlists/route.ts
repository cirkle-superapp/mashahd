import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { getUserState, parseList } from "@/lib/user-state";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/smart-playlists?bid=<browserId>
 * Returns all smart playlists for the user.
 *
 * POST /api/smart-playlists
 * Body: { browserId, name, description?, rules }
 * Creates a smart playlist (§30).
 *   rules: {
 *     categories: string[],     // filter by category
 *     creators: string[],      // filter by channelId
 *     maxDuration?: number,    // seconds
 *     minDuration?: number,    // seconds
 *     unwatchedOnly?: boolean, // exclude watched
 *     savedOnly?: boolean,     // only favorited/saved
 *     dateRange?: "7d" | "30d" | "90d" | "all"
 *   }
 *
 * GET /api/smart-playlists/[id]/resolve?bid=<browserId>
 * Resolves the smart playlist rules → returns matching videos (dynamic).
 *
 * Per spec §30: "Allow rules such as: 'All unwatched videos under 20 minutes
 * from followed creators.' Rules must update dynamically."
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  if (!bid) return NextResponse.json({ playlists: [] });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const playlists = await db.smartPlaylist.findMany({
    where: { userId: verification.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    playlists: playlists.map((p) => ({
      id: p.id,
      name: p.name,
      description: p.description,
      rules: JSON.parse(p.rules || "{}"),
      createdAt: p.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const name: string = (body.name || "").slice(0, 100);
  const description: string = (body.description || "").slice(0, 500);
  const rules = body.rules || {};

  if (!bid || !name) {
    return NextResponse.json({ error: "browserId+name required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`smart-pl:${ip}`, 20, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // Validate + sanitize rules.
  const cleanRules = {
    categories: Array.isArray(rules.categories) ? rules.categories.slice(0, 20).map(String) : [],
    creators: Array.isArray(rules.creators) ? rules.creators.slice(0, 50).map(String) : [],
    maxDuration: typeof rules.maxDuration === "number" ? Math.min(Math.max(rules.maxDuration, 0), 86400) : undefined,
    minDuration: typeof rules.minDuration === "number" ? Math.min(Math.max(rules.minDuration, 0), 86400) : undefined,
    unwatchedOnly: !!rules.unwatchedOnly,
    savedOnly: !!rules.savedOnly,
    dateRange: ["7d", "30d", "90d", "all"].includes(rules.dateRange) ? rules.dateRange : "all",
  };

  const playlist = await db.smartPlaylist.create({
    data: {
      userId: verification.id,
      name,
      description,
      rules: JSON.stringify(cleanRules),
    },
  });

  return NextResponse.json({
    ok: true,
    playlist: {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      rules: cleanRules,
    },
  });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const playlistId: string = body.playlistId || "";

  if (!bid || !playlistId) {
    return NextResponse.json({ error: "browserId+playlistId required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const playlist = await db.smartPlaylist.findUnique({ where: { id: playlistId } });
  if (!playlist || playlist.userId !== verification.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.smartPlaylist.delete({ where: { id: playlistId } });

  return NextResponse.json({ ok: true });
}

/**
 * Resolve smart playlist rules → matching videos.
 * Called by GET /api/smart-playlists/[id]/resolve?bid=...
 * (This is a helper exported for the dynamic route.)
 */
export async function resolveSmartPlaylist(userId: string, rules: any): Promise<any[]> {
  const st = await getUserState(userId);
  const watched = new Set(parseList(st.watchedVideoIds));
  const saved = new Set(parseList(st.favoriteVideoIds));
  const subs = parseList(st.subscribedChannelIds);

  // Build the where clause.
  const where: any = {};
  if (rules.categories?.length > 0) {
    where.category = { in: rules.categories };
  }
  if (rules.creators?.length > 0) {
    where.channelId = { in: rules.creators };
  }

  // Date range filter.
  if (rules.dateRange && rules.dateRange !== "all") {
    const days = parseInt(rules.dateRange);
    const since = new Date(Date.now() - days * 86400000);
    where.createdAt = { gte: since };
  }

  // Fetch candidates.
  let videos = await db.video.findMany({
    where,
    include: { channel: true },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  // Duration filters.
  if (rules.minDuration !== undefined) {
    videos = videos.filter((v) => v.durationSec >= rules.minDuration);
  }
  if (rules.maxDuration !== undefined) {
    videos = videos.filter((v) => v.durationSec <= rules.maxDuration);
  }

  // Unwatched only.
  if (rules.unwatchedOnly) {
    videos = videos.filter((v) => !watched.has(v.id));
  }

  // Saved only.
  if (rules.savedOnly) {
    videos = videos.filter((v) => saved.has(v.id));
  }

  // If creators list includes "following", also include subscribed channels.
  if (rules.creators?.includes("following")) {
    const followingVideos = await db.video.findMany({
      where: { channelId: { in: subs }, ...where },
      include: { channel: true },
      take: 100,
      orderBy: { createdAt: "desc" },
    });
    // Merge + dedupe.
    const existingIds = new Set(videos.map((v) => v.id));
    for (const v of followingVideos) {
      if (!existingIds.has(v.id)) videos.push(v);
    }
  }

  return videos;
}
