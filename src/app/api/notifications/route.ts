import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/notifications?bid=<browserId>&cursor=<isoDate>&limit=<n>
 *
 * Returns notifications for the bell icon (replaces the SAMPLE_NOTIFS mock
 * flagged by the social-media structuring audit). Cursor-paginated by
 * createdAt descending.
 *
 * SECURITY: requires a valid signed browserId (the recipientId).
 * Rate limited: 30/min per IP.
 *
 * Query params:
 *   - bid: the signed browserId (recipientId)
 *   - cursor: ISO date — return notifications older than this (for pagination)
 *   - limit: max results (default 20, max 50)
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  const cursor = url.searchParams.get("cursor");
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 1),
    50
  );

  if (!bid) {
    return NextResponse.json({ notifications: [], unreadCount: 0 });
  }

  // Verify browserId signature.
  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json(
      { error: "invalid browserId", reissue: true },
      { status: 403 }
    );
  }

  // Rate limit.
  const ip = getClientIP(req);
  const rl = await rateLimit(`notif:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // Fetch notifications (cursor pagination, newest first).
  const notifs = await db.notification.findMany({
    where: {
      recipientId: verification.id,
      ...(cursor ? { createdAt: { lt: new Date(cursor) } } : {}),
    },
    orderBy: { createdAt: "desc" },
    take: limit + 1, // +1 to detect hasMore
  });

  const hasMore = notifs.length > limit;
  const items = notifs.slice(0, limit).map((n) => {
    let payload: any = {};
    try {
      payload = JSON.parse(n.payload);
    } catch { /* corrupted payload — empty */ }
    return {
      id: n.id,
      type: n.type,
      read: n.read,
      createdAt: n.createdAt.toISOString(),
      ...payload,
    };
  });

  // Unread count.
  const unreadCount = await db.notification.count({
    where: { recipientId: verification.id, read: false },
  });

  return NextResponse.json({
    notifications: items,
    unreadCount,
    hasMore,
    nextCursor: hasMore && items.length > 0
      ? items[items.length - 1].createdAt
      : null,
  });
}

/**
 * POST /api/notifications
 * Body: { browserId, action, notificationId? }
 *   action: "markRead" | "markAllRead" | "markUnread"
 *
 * Marks notifications as read/unread. Used when the user opens the bell
 * dropdown or clicks a notification.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const browserId: string = body.browserId || "";
  const action: string = body.action || "";
  const notificationId: string = body.notificationId || "";

  if (!browserId || !action) {
    return NextResponse.json(
      { error: "browserId+action required" },
      { status: 400 }
    );
  }

  // Verify browserId signature.
  const verification = verifyBrowserId(browserId);
  if (!verification.valid) {
    return NextResponse.json(
      { error: "invalid browserId", reissue: true },
      { status: 403 }
    );
  }

  if (action === "markAllRead") {
    await db.notification.updateMany({
      where: { recipientId: verification.id, read: false },
      data: { read: true },
    });
    return NextResponse.json({ ok: true, markedAll: true });
  }

  if (!notificationId) {
    return NextResponse.json(
      { error: "notificationId required for this action" },
      { status: 400 }
    );
  }

  // Verify ownership before updating (prevent IDOR).
  const notif = await db.notification.findUnique({
    where: { id: notificationId },
  });
  if (!notif || notif.recipientId !== verification.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (action === "markRead") {
    await db.notification.update({
      where: { id: notificationId },
      data: { read: true },
    });
  } else if (action === "markUnread") {
    await db.notification.update({
      where: { id: notificationId },
      data: { read: false },
    });
  } else {
    return NextResponse.json({ error: "unknown action" }, { status: 400 });
  }

  return NextResponse.json({ ok: true });
}
