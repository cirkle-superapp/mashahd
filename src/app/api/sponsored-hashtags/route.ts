import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/sponsored-hashtags
 *
 * Pulled from CIRKLE Mashahd — sponsored hashtag discovery.
 * Returns active sponsored hashtags for the home feed.
 * Per spec §15: "Never make paid placements look identical to organic results."
 * Sponsored hashtags are clearly labeled as "Sponsored".
 */

export async function GET(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`sponsored:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  try {
    const now = new Date();
    const hashtags = await (db as any).sponsoredHashtag.findMany({
      where: {
        active: true,
        startsAt: { lte: now },
        OR: [
          { endsAt: null },
          { endsAt: { gte: now } },
        ],
      },
      orderBy: { budget: "desc" },
      take: 10,
    });

    return NextResponse.json({
      hashtags: hashtags.map((h: any) => ({
        id: h.id,
        hashtag: h.hashtag,
        advertiser: h.advertiser,
        city: h.city,
        sponsored: true, // §15: always label as sponsored
      })),
    });
  } catch {
    return NextResponse.json({ hashtags: [] });
  }
}

/**
 * POST /api/sponsored-hashtags
 * Body: { hashtag, advertiser?, city?, budget? }
 * Creates a sponsored hashtag (admin-only in production).
 */
export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`sponsored-create:${ip}`, 5, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await req.json().catch(() => ({}));
  const hashtag: string = (body.hashtag || "").trim().slice(0, 100);
  const advertiser: string = (body.advertiser || "").slice(0, 200);
  const city: string = (body.city || "").slice(0, 10);
  const budget: number = Math.max(0, Math.floor(Number(body.budget) || 0));

  if (!hashtag) {
    return NextResponse.json({ error: "hashtag required" }, { status: 400 });
  }

  try {
    const existing = await (db as any).sponsoredHashtag.findUnique({ where: { hashtag } });
    if (existing) {
      return NextResponse.json({ error: "hashtag already exists" }, { status: 409 });
    }

    const ht = await (db as any).sponsoredHashtag.create({
      data: { hashtag, advertiser, city, budget, active: true },
    });

    return NextResponse.json({
      ok: true,
      hashtag: { id: ht.id, hashtag: ht.hashtag, advertiser: ht.advertiser, sponsored: true },
    });
  } catch {
    return NextResponse.json({ error: "failed to create" }, { status: 500 });
  }
}
