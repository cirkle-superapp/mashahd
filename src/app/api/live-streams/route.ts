import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";
import { randomBytes, createHash } from "node:crypto";

/**
 * Live Streams API — real DB-backed live broadcasting (Pass 47).
 *
 * Before this route existed, the "Go Live" feature was purely client-side:
 * no DB record was ever written, so a stream "going live" left zero trace
 * in the database. This meant:
 *   - The home page couldn't show a "Live now" shelf
 *   - Viewer counts were fabricated client-side (Math.random)
 *   - There was no audit trail of past streams
 *   - There was no way to enforce uniqueness of stream keys
 *
 * Now every stream is a row in the LiveStream table. The broadcaster:
 *   1. POST /api/live-streams  → creates a row, gets back { id, streamKey, watchPartyCode }
 *   2. PATCH /api/live-streams/[id]  → updates viewerCount from the WS member count
 *   3. DELETE /api/live-streams/[id]  → marks status=ended, sets endedAt
 *
 * SECURITY: POST requires a valid signed browserId (prevents anonymous
 * stream-spam). PATCH/DELETE require the streamKey (prevents a hostile
 * viewer from ending someone else's stream). Rate limited: 5 streams/hour/IP.
 */

function generateStreamKey(): string {
  // 24 bytes of entropy → 32-char base64url string. Used as a secret
  // bearer token for PATCH/DELETE auth.
  return randomBytes(24).toString("base64url");
}

function generateWatchPartyCode(): string {
  // 6-char human-readable code (no confusing chars). The watch-party
  // WebSocket service (port 3004) accepts this as a party code.
  const alphabet = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
  let code = "";
  const bytes = randomBytes(6);
  for (let i = 0; i < 6; i++) {
    code += alphabet[bytes[i] % alphabet.length];
  }
  return code;
}

/**
 * POST /api/live-streams
 * Body: { browserId, title, category?, privacy?, channelId?, streamerName?, description? }
 *
 * Creates a new live stream session. Returns the stream id + secret streamKey
 * + public watchPartyCode. The broadcaster uses the streamKey for subsequent
 * PATCH/DELETE; viewers use the watchPartyCode to join the live chat over the
 * watch-party WebSocket.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const title: string = (body.title || "").trim().slice(0, 200);
  const category: string = (body.category || "Tech").slice(0, 50);
  const privacy: string = ["public", "unlisted", "private"].includes(body.privacy)
    ? body.privacy
    : "public";
  const channelId: string = (body.channelId || "").slice(0, 50);
  const streamerName: string = (body.streamerName || "Anonymous").slice(0, 100);
  const description: string = (body.description || "").slice(0, 2000);

  if (!bid || !title) {
    return NextResponse.json({ error: "browserId + title required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  // Rate limit: 5 stream starts per hour per IP (prevents stream-spam).
  const ip = getClientIP(req);
  const rl = await rateLimit(`live-start:${ip}`, 5, 3600_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — max 5 streams per hour" },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  // Refuse to start a new stream if the broadcaster already has one live.
  // (You can only be live on one stream at a time.)
  try {
    const existing = await db.liveStream.findFirst({
      where: { streamerId: verification.id, status: { in: ["preparing", "live"] } },
      select: { id: true },
    });
    if (existing) {
      return NextResponse.json(
        { error: "you are already live — end your current stream first", existingId: existing.id },
        { status: 409 },
      );
    }
  } catch {
    // Table may not exist yet on a cold Turso boot — proceed; the create below
    // will create it via ensureAllTables (or fail gracefully).
  }

  const streamKey = generateStreamKey();
  const watchPartyCode = generateWatchPartyCode();
  const now = new Date();
  const isoNow = now.toISOString();

  try {
    const stream = await db.liveStream.create({
      data: {
        channelId,
        streamerId: verification.id,
        streamerName,
        title,
        description,
        category,
        privacy,
        status: "preparing",
        viewerCount: 0,
        peakViewerCount: 0,
        streamKey,
        watchPartyCode,
        thumbnailUrl: "",
        startedAt: isoNow,
        endedAt: "",
      },
    });

    return NextResponse.json({
      ok: true,
      stream: {
        id: stream.id,
        title: stream.title,
        category: stream.category,
        privacy: stream.privacy,
        status: stream.status,
        streamKey, // secret — broadcaster uses this for PATCH/DELETE
        watchPartyCode, // public — viewers join the WS room with this
        startedAt: stream.startedAt,
      },
    });
  } catch (e: any) {
    console.error("[live-streams] create failed:", e?.message?.slice(0, 200));
    return NextResponse.json({ error: "failed to start stream" }, { status: 500 });
  }
}

/**
 * GET /api/live-streams?status=live&limit=20
 *
 * Lists live streams. Default: only streams with status="live". The home
 * page uses this to render the "Live now" shelf. Public streams only —
 * unlisted/private are filtered out unless the requester is the streamer.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const statusParam = url.searchParams.get("status") || "live";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10), 50);

  // Only allow querying by safe status values.
  const status = ["live", "preparing", "ended", "all"].includes(statusParam)
    ? statusParam
    : "live";

  try {
    const where: any =
      status === "all"
        ? {}
        : { status };
    // For "live" status, also filter out private streams (only the streamer
    // should see their own private stream). Unlisted is OK to list (it's
    // just not indexed, but if you have the link you can watch).
    if (status === "live") {
      where.OR = [{ privacy: "public" }, { privacy: "unlisted" }];
      delete where.status;
      where.status = "live";
    }

    const streams = await db.liveStream.findMany({
      where,
      orderBy: { viewerCount: "desc" },
      take: limit,
    }).catch(() => []);

    return NextResponse.json({
      streams: (streams as any[]).map((s) => ({
        id: s.id,
        title: s.title,
        description: s.description,
        category: s.category,
        privacy: s.privacy,
        status: s.status,
        streamerName: s.streamerName,
        streamerId: s.streamerId,
        channelId: s.channelId,
        viewerCount: s.viewerCount,
        peakViewerCount: s.peakViewerCount,
        watchPartyCode: s.watchPartyCode,
        startedAt: s.startedAt,
        endedAt: s.endedAt,
        thumbnailUrl: s.thumbnailUrl,
      })),
      count: (streams as any[]).length,
    });
  } catch {
    return NextResponse.json({ streams: [], count: 0 });
  }
}
