import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";
import { verifyBrowserId } from "@/lib/browser-id-security";

/**
 * Live Stream detail/update/end API (Pass 47).
 *
 *   GET    /api/live-streams/[id]                — public stream metadata
 *   PATCH  /api/live-streams/[id]?key=<key>      — update viewerCount (broadcaster)
 *   DELETE /api/live-streams/[id]?key=<key>       — end the stream (broadcaster)
 *
 * The PATCH/DELETE require the secret streamKey (returned by POST). This
 * prevents a hostile viewer from ending or manipulating someone else's
 * stream. The key is checked in O(1) per request — no DB lookup needed for
 * the auth check itself (the row lookup uses the id, then we compare the
 * stored key with timingSafeEqual).
 *
 * Rate limited: PATCH 60/min (broadcaster polls viewer count every few
 * seconds), DELETE 10/min (sanity).
 */

import { timingSafeEqual } from "node:crypto";

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  if (ba.length !== bb.length) return false;
  return timingSafeEqual(ba, bb);
}

/** GET — public stream metadata. No auth required. */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) return NextResponse.json({ error: "id required" }, { status: 400 });

  try {
    const stream = await db.liveStream.findUnique({ where: { id } }).catch(() => null);
    if (!stream) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    return NextResponse.json({
      stream: {
        id: stream.id,
        title: stream.title,
        description: stream.description,
        category: stream.category,
        privacy: stream.privacy,
        status: stream.status,
        streamerName: stream.streamerName,
        streamerId: stream.streamerId,
        channelId: stream.channelId,
        viewerCount: stream.viewerCount,
        peakViewerCount: stream.peakViewerCount,
        watchPartyCode: stream.watchPartyCode,
        startedAt: stream.startedAt,
        endedAt: stream.endedAt,
        thumbnailUrl: stream.thumbnailUrl,
      },
    });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

/**
 * PATCH — update viewerCount and/or status. Broadcaster-only (requires
 * the streamKey). Body: { viewerCount?, status? }
 */
export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const streamKey = url.searchParams.get("key") || "";

  if (!id || !streamKey) {
    return NextResponse.json({ error: "id + key required" }, { status: 400 });
  }

  // Rate limit: 60 patches per minute (broadcaster polls every 3-5s).
  const ip = getClientIP(req);
  const rl = await rateLimit(`live-patch:${ip}`, 60, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — max 60 updates per minute" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  try {
    const stream = await db.liveStream.findUnique({ where: { id } }).catch(() => null);
    if (!stream) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!safeEqual(stream.streamKey, streamKey)) {
      return NextResponse.json({ error: "invalid stream key" }, { status: 403 });
    }

    const body = await req.json().catch(() => ({}));
    const data: any = { updatedAt: new Date() };

    if (typeof body.viewerCount === "number") {
      const vc = Math.max(0, Math.min(1_000_000, Math.floor(body.viewerCount)));
      data.viewerCount = vc;
      // Track peak — never decreases during a stream.
      if (vc > stream.peakViewerCount) {
        data.peakViewerCount = vc;
      }
    }

    // Allow status transitions: preparing → live, live → ended.
    // Do NOT allow ended → live (must start a new stream).
    if (typeof body.status === "string") {
      const next = body.status;
      const valid: Record<string, string[]> = {
        preparing: ["live"],
        live: ["ended"],
      };
      const allowed = valid[stream.status] || [];
      if (!allowed.includes(next)) {
        return NextResponse.json(
          { error: `invalid status transition: ${stream.status} → ${next}` },
          { status: 400 },
        );
      }
      data.status = next;
      if (next === "live" && !stream.startedAt) {
        data.startedAt = new Date().toISOString();
      }
      if (next === "ended") {
        data.endedAt = new Date().toISOString();
        data.viewerCount = 0;
      }
    }

    if (typeof body.thumbnailUrl === "string") {
      data.thumbnailUrl = body.thumbnailUrl.slice(0, 500);
    }

    // Allow updating the watchPartyCode — the POST generates a provisional
    // code, but the actual code is assigned by the watch-party WS server
    // when the broadcaster creates the room. The broadcaster PATCHes the
    // real code back so viewers can join via the "Live now" shelf.
    if (typeof body.watchPartyCode === "string" && body.watchPartyCode.length <= 12) {
      data.watchPartyCode = body.watchPartyCode.toUpperCase().slice(0, 12);
    }

    const updated = await db.liveStream.update({ where: { id }, data }).catch((e: any) => {
      console.error("[live-streams] update failed:", e?.message?.slice(0, 200));
      return null;
    });

    if (!updated) {
      return NextResponse.json({ error: "update failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      stream: {
        id: updated.id,
        status: updated.status,
        viewerCount: updated.viewerCount,
        peakViewerCount: updated.peakViewerCount,
        startedAt: updated.startedAt,
        endedAt: updated.endedAt,
      },
    });
  } catch (e: any) {
    console.error("[live-streams] PATCH error:", e?.message?.slice(0, 200));
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

/**
 * DELETE — end the stream. Broadcaster-only (requires the streamKey).
 * Sets status=ended and endedAt=now. Does NOT delete the row (preserves
 * audit history + analytics).
 */
export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  const url = new URL(req.url);
  const streamKey = url.searchParams.get("key") || "";

  if (!id || !streamKey) {
    return NextResponse.json({ error: "id + key required" }, { status: 400 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`live-end:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  try {
    const stream = await db.liveStream.findUnique({ where: { id } }).catch(() => null);
    if (!stream) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }
    if (!safeEqual(stream.streamKey, streamKey)) {
      return NextResponse.json({ error: "invalid stream key" }, { status: 403 });
    }
    if (stream.status === "ended") {
      return NextResponse.json({ ok: true, alreadyEnded: true, stream: { id, status: "ended" } });
    }

    const updated = await db.liveStream.update({
      where: { id },
      data: {
        status: "ended",
        endedAt: new Date().toISOString(),
        viewerCount: 0,
        updatedAt: new Date(),
      },
    }).catch((e: any) => {
      console.error("[live-streams] end failed:", e?.message?.slice(0, 200));
      return null;
    });

    if (!updated) {
      return NextResponse.json({ error: "end failed" }, { status: 500 });
    }

    return NextResponse.json({
      ok: true,
      stream: {
        id: updated.id,
        status: updated.status,
        peakViewerCount: updated.peakViewerCount,
        startedAt: updated.startedAt,
        endedAt: updated.endedAt,
      },
    });
  } catch (e: any) {
    console.error("[live-streams] DELETE error:", e?.message?.slice(0, 200));
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}

// Helper exported for tests/other routes to validate a stream key.
export function _verifyStreamKey(storedKey: string, providedKey: string): boolean {
  return safeEqual(storedKey, providedKey);
}

// Re-export for any consumer that wants the browserId verifier.
export { verifyBrowserId };
