import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserState, parseList, joinList } from "@/lib/user-state";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/channels/[id]/subscribe
 * Body: { browserId, action }
 *   action: "subscribe" | "unsubscribe"
 * Toggles subscription state and updates the channel's subscriber count.
 *
 * SECURITY (deep audit pass 2): verifies browserId HMAC signature + rate
 * limits per browserId (20/min) and per IP (60/min) to prevent inflation.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const browserId: string = body.browserId || "";
  const action: "subscribe" | "unsubscribe" =
    body.action === "unsubscribe" ? "unsubscribe" : "subscribe";

  if (!browserId) {
    return NextResponse.json({ error: "browserId required" }, { status: 400 });
  }

  // ── Verify browserId signature ──
  const verification = verifyBrowserId(browserId);
  if (!verification.valid) {
    return NextResponse.json(
      { error: "invalid browserId signature", reissue: true },
      { status: 403 }
    );
  }

  // ── Rate limit ──
  const ip = getClientIP(req);
  const ipRl = await rateLimit(`sub-ip:${ip}`, 60, 60_000);
  if (ipRl.limited) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  const bidRl = await rateLimit(`sub-bid:${verification.id}`, 20, 60_000);
  if (bidRl.limited) {
    return NextResponse.json(
      { error: "rate limited per browser" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const channel = await db.channel.findUnique({ where: { id } });
  if (!channel) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const st = await getUserState(browserId);
  const subs = parseList(st.subscribedChannelIds);

  if (action === "subscribe" && !subs.includes(id)) {
    subs.push(id);
    await db.channel.update({
      where: { id },
      data: { subscribers: { increment: 1 } },
    });
  } else if (action === "unsubscribe" && subs.includes(id)) {
    const idx = subs.indexOf(id);
    subs.splice(idx, 1);
    await db.channel.update({
      where: { id },
      data: { subscribers: { decrement: 1 } },
    });
  }

  await db.userState.update({
    where: { browserId },
    data: { subscribedChannelIds: joinList(subs) },
  });

  return NextResponse.json({ ok: true, subscribed: action === "subscribe" && subs.includes(id) });
}
