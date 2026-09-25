import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/live-tv-channels?category=News&country=US&limit=50
 * Returns all live TV channels, optionally filtered by category/country.
 *
 * POST /api/live-tv-channels
 * Body: { browserId, name, slug, streamUrl, category, country, language, logoUrl?, description? }
 * Creates a new live TV channel. Requires signed browserId.
 * Rate limited: 5 channels per hour per IP.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category") || "";
  const country = url.searchParams.get("country") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "50", 10), 100);

  const where: any = {};
  if (category && category !== "All") where.category = category;
  if (country) where.country = country;

  try {
    const channels = await db.liveTVChannel.findMany({
      where,
      orderBy: { viewers: "desc" },
      take: limit,
    }).catch(() => []);

    return NextResponse.json({
      channels: (channels as any[]).map((c) => ({
        id: c.id, name: c.name, slug: c.slug, logoUrl: c.logoUrl,
        description: c.description, category: c.category, country: c.country,
        language: c.language, streamUrl: c.streamUrl, streamType: c.streamType,
        isLive: !!c.isLive, isVerified: !!c.isVerified,
        nowPlaying: c.nowPlaying, nextProgram: c.nextProgram,
        viewers: c.viewers, ownerId: c.ownerId,
      })),
      count: (channels as any[]).length,
    });
  } catch {
    return NextResponse.json({ channels: [], count: 0 });
  }
}

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`live-tv-create:${ip}`, 5, 3600_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited — max 5 channels per hour" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const name: string = (body.name || "").trim().slice(0, 100);
  const slug: string = (body.slug || "").trim().toLowerCase().slice(0, 50);
  const streamUrl: string = (body.streamUrl || "").slice(0, 500);
  const category: string = (body.category || "General").slice(0, 50);
  const country: string = (body.country || "").slice(0, 10);
  const language: string = (body.language || "").slice(0, 10);
  const logoUrl: string = (body.logoUrl || "").slice(0, 500);
  const description: string = (body.description || "").slice(0, 2000);

  if (!bid || !name || !slug || !streamUrl) {
    return NextResponse.json({ error: "browserId + name + slug + streamUrl required" }, { status: 400 });
  }
  if (!/^[a-z0-9-]{3,50}$/.test(slug)) {
    return NextResponse.json({ error: "slug must be 3-50 chars, lowercase alphanumeric + hyphens" }, { status: 400 });
  }
  if (!streamUrl.match(/^https?:\/\/.+\.(m3u8|mpd|mp4)/i)) {
    return NextResponse.json({ error: "streamUrl must be a valid HLS/DASH/MP4 URL" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  try {
    const existing = await db.liveTVChannel.findUnique({ where: { slug } }).catch(() => null);
    if (existing) {
      return NextResponse.json({ error: "slug already taken" }, { status: 409 });
    }

    const channel = await db.liveTVChannel.create({
      data: { name, slug, streamUrl, category, country, language, logoUrl, description, ownerId: verification.id, isLive: true },
    }).catch((e: any) => {
      console.error("[live-tv] create failed:", e?.message?.slice(0, 200));
      return null;
    });

    if (!channel) {
      return NextResponse.json({ error: "failed to create channel" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      channel: { id: (channel as any).id, name: (channel as any).name, slug: (channel as any).slug },
    });
  } catch (e: any) {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
