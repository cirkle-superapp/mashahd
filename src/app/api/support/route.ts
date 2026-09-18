import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";
import { createNotification } from "@/lib/notify";

/**
 * POST /api/support
 * Body: { browserId, channelId, amount, message? }
 *
 * Per spec §51: creator-economy direct-support (tip) flow. Previously the
 * support-creator dialog simulated this with setTimeout + localStorage. This
 * route replaces the mock with a real side-effect: a `tip_received`
 * Notification is created for the channel owner's inbox, so the creator is
 * actually notified when someone tips them.
 *
 * The tip is NOT charged — there's no payment provider (zero-cost principle,
 * per the project's "0% fees" narrative). The amount + message are recorded
 * in the notification payload so the creator's bell + future revenue page can
 * surface them. The creator's aggregate tip count can be derived by querying
 * notifications of type `tip_received` for their userId.
 *
 * SECURITY:
 *  - Verifies the browserId HMAC signature (prevents fabrication).
 *  - Rate limited: 5/min per IP (tips are low-volume but high-noise if abused).
 *  - Channel must exist; message capped at 140 chars; amount must be a
 *    positive integer in [1, 10_000].
 *
 * Returns:
 *   200 { ok: true, notified: boolean }
 *     - notified: false if the channel has no owning User (still success,
 *       but no one to notify — tips are fire-and-forget).
 *   400 { error: "..." } — invalid amount/message/missing fields.
 *   403 { error: "invalid browserId" }.
 *   404 { error: "channel not found" }.
 *   429 { error: "rate limited" }.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({} as Record<string, unknown>));
  const browserIdRaw = typeof body.browserId === "string" ? body.browserId : "";
  const channelId = typeof body.channelId === "string" ? body.channelId : "";
  const amountRaw = body.amount;
  const messageRaw = typeof body.message === "string" ? body.message : "";

  // ── Rate limit (5/min per IP) ──
  const ip = getClientIP(req);
  const rl = await rateLimit(`support:${ip}`, 5, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // ── Verify browserId signature ──
  if (!browserIdRaw) {
    return NextResponse.json({ error: "browserId required" }, { status: 400 });
  }
  const bid = verifyBrowserId(browserIdRaw);
  if (!bid.valid) {
    return NextResponse.json(
      { error: "invalid browserId — fetch a new one from /api/user-state" },
      { status: 403 }
    );
  }

  // ── Validate channel ──
  if (!channelId) {
    return NextResponse.json({ error: "channelId required" }, { status: 400 });
  }
  const channel = await db.channel.findUnique({
    where: { id: channelId },
    select: { id: true, name: true, avatarUrl: true, ownerId: true },
  });
  if (!channel) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  // ── Validate amount (positive integer in [1, 10_000]) ──
  if (
    typeof amountRaw !== "number" ||
    !Number.isFinite(amountRaw) ||
    amountRaw < 1
  ) {
    return NextResponse.json(
      { error: "amount must be a positive number" },
      { status: 400 }
    );
  }
  const amount = Math.floor(amountRaw);
  if (amount > 10_000) {
    return NextResponse.json({ error: "amount too large" }, { status: 400 });
  }

  // ── Sanitize message (max 140 chars) ──
  const message = messageRaw.slice(0, 140).trim();

  // ── Create the tip_received notification for the channel owner ──
  // If the channel has no owning User (legacy seeded demo channel), there's
  // no one to notify — the tip is still recorded as "ok" (fire-and-forget
  // semantics). The `notified` flag tells the client whether the bell was rung.
  let notified = false;
  if (channel.ownerId) {
    await createNotification(channel.ownerId, "tip_received", {
      title: `You received a $${amount} tip`,
      body: message
        ? message
        : "Someone sent you a tip — 100% of it goes to you.",
      actorAvatarUrl: channel.avatarUrl,
      actorName: "A Mashahd supporter",
      linkUrl: `/?v=channel&id=${channel.id}`,
    });
    notified = true;
  }

  return NextResponse.json({ ok: true, notified });
}
