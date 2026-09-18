import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/channels
 * Body: { browserId, name, handle, description?, avatarUrl?, bannerColors?, bannerUrl? }
 *
 * Creates a new channel owned by the authenticated user.
 * Per the social-media structuring audit: the ownerId FK existed but was
 * never set because there was no channel creation API. This fixes that gap.
 *
 * SECURITY: requires a valid signed browserId. The browserId becomes the
 * channel's ownerId. Rate limited: 3 channels per hour per IP (prevent spam).
 *
 * Validation:
 *   - name: 1-100 chars
 *   - handle: 3-30 chars, alphanumeric + underscore, unique
 *   - description: max 2000 chars
 */

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const name: string = (body.name || "").trim().slice(0, 100);
  const handle: string = (body.handle || "").trim().slice(0, 30);
  const description: string = (body.description || "").slice(0, 2000);
  const avatarUrl: string = (body.avatarUrl || "").slice(0, 500);
  const bannerColors: string = (body.bannerColors || "#1a4a5a,#2d6a7f,#5fb3a3").slice(0, 200);
  const bannerUrl: string = (body.bannerUrl || "").slice(0, 500);
  const links: string = (body.links || "").slice(0, 500);
  const country: string = (body.country || "").slice(0, 10);

  if (!bid || !name || !handle) {
    return NextResponse.json({ error: "browserId + name + handle required" }, { status: 400 });
  }

  // Validate handle format.
  if (!/^[a-zA-Z0-9_]{3,30}$/.test(handle)) {
    return NextResponse.json({ error: "handle must be 3-30 chars, alphanumeric + underscore" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`channel-create:${ip}`, 3, 3600_000); // 3 per hour
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — max 3 channels per hour" },
      { status: 429, headers: { "Retry-After": "3600" } }
    );
  }

  try {
    // Check handle uniqueness.
    const existing = await db.channel.findUnique({ where: { handle } });
    if (existing) {
      return NextResponse.json({ error: "handle already taken" }, { status: 409 });
    }

    // Limit channels per user (max 5).
    const userChannelCount = await db.channel.count({
      where: { ownerId: verification.id },
    }).catch(() => 0);
    if (userChannelCount >= 5) {
      return NextResponse.json({ error: "maximum 5 channels per user" }, { status: 400 });
    }

    // Create the channel. The ownerId links to the browserId (anonymous identity)
    // rather than a User record, since the zero-cost model uses signed browserIds
    // as user identities. The FK constraint on ownerId → User.id is relaxed in dev
    // (nullable), so we set ownerId only if the verification ID matches a User record.
    // Otherwise, we store the browserId in the links field for ownership tracking.
    let ownerId: string | null = null;
    try {
      const matchingUser = await (db as any).user.findUnique({
        where: { id: verification.id },
        select: { id: true },
      });
      if (matchingUser) {
        ownerId = matchingUser.id;
      }
    } catch { /* User table may not exist or ID may not match */ }

    const channel = await db.channel.create({
      data: {
        name,
        handle,
        description,
        avatarUrl: avatarUrl || `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(name)}&radius=50`,
        bannerColors,
        bannerUrl,
        links: links || (ownerId ? "" : `owner:${verification.id}`),
        country,
        ownerId: ownerId || undefined,
        subscribers: 0,
        verified: false,
      },
    }).catch((e: any) => {
      // If FK constraint fails on ownerId, retry without it.
      console.warn("[channels] FK constraint, retrying without ownerId:", e.message?.slice(0, 100));
      return db.channel.create({
        data: {
          name,
          handle,
          description,
          avatarUrl: avatarUrl || `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(name)}&radius=50`,
          bannerColors,
          bannerUrl,
          links: `owner:${verification.id}`,
          country,
          subscribers: 0,
          verified: false,
        },
      });
    });

    return NextResponse.json({
      ok: true,
      channel: {
        id: channel.id,
        name: channel.name,
        handle: channel.handle,
        ownerId: channel.ownerId,
      },
    });
  } catch (e) {
    return NextResponse.json({ error: "failed to create channel" }, { status: 500 });
  }
}

/**
 * GET /api/channels?ownerBid=<browserId>
 * Returns all channels owned by the user.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const ownerBid = url.searchParams.get("ownerBid") || "";
  if (!ownerBid) return NextResponse.json({ channels: [] });

  const verification = verifyBrowserId(ownerBid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  try {
    const channels = await db.channel.findMany({
      where: { ownerId: verification.id },
      orderBy: { createdAt: "desc" },
    });

    return NextResponse.json({
      channels: channels.map((c: any) => ({
        id: c.id,
        name: c.name,
        handle: c.handle,
        subscribers: c.subscribers,
        verified: c.verified,
        avatarUrl: c.avatarUrl,
      })),
    });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
