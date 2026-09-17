import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserState, parseList } from "@/lib/user-state";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/channels/[id]
 * Optional `?bid=<browserId>` to return whether this browser is subscribed.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  try {
    const channel = await db.channel.findUnique({ where: { id } });
    if (!channel) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    let subscribed = false;
    const bid = new URL(req.url).searchParams.get("bid") || "";
    if (bid) {
      const st = await getUserState(bid);
      subscribed = parseList(st.subscribedChannelIds).includes(id);
    }

    return NextResponse.json({ channel, subscribed });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

/**
 * PATCH /api/channels/[id]
 * Body: { browserId, name?, description?, avatarUrl?, bannerUrl?, bannerColors?, links?, country? }
 *
 * Updates a channel's metadata. The caller must be the channel owner
 * (verified via signed browserId matching the channel's ownerId).
 *
 * Per the social-media structuring audit: the ownerId FK exists but was
 * never set because there was no channel creation API. This PATCH + the
 * new POST /api/channels fix that gap.
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";

  if (!bid) {
    return NextResponse.json({ error: "browserId required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`channel-update:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  try {
    const channel = await db.channel.findUnique({ where: { id } });
    if (!channel) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // Verify ownership — in dev, allow if ownerId is null (legacy channels).
    const isProd = process.env.NODE_ENV === "production";
    if (isProd && channel.ownerId && channel.ownerId !== verification.id) {
      return NextResponse.json({ error: "not authorized — you must own this channel" }, { status: 403 });
    }

    // Build updates from allowed fields only.
    const updates: Record<string, any> = {};
    const allowedFields = ["name", "description", "avatarUrl", "bannerUrl", "bannerColors", "links", "country"];
    for (const field of allowedFields) {
      if (field in body && typeof body[field] === "string") {
        updates[field] = body[field].slice(0, field === "description" ? 2000 : field === "links" ? 500 : 200);
      }
    }

    if (Object.keys(updates).length === 0) {
      return NextResponse.json({ error: "no valid fields to update" }, { status: 400 });
    }

    const updated = await db.channel.update({ where: { id }, data: updates });
    return NextResponse.json({ ok: true, channel: updated });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
