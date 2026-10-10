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

import { sanitizeUrl } from "@/lib/format";

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
        vodVideoId: stream.vodVideoId || "",
        thumbnailUrl: sanitizeUrl(stream.thumbnailUrl),
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
      // Stream already ended — check if a VOD was created.
      const existingVod = stream.vodVideoId || "";
      return NextResponse.json({
        ok: true,
        alreadyEnded: true,
        stream: { id, status: "ended", vodVideoId: existingVod },
      });
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

    // Pass 95: When the stream ends, automatically create a VOD Video entry
    // from the stream data. This is the "live-to-VOD" conversion that enables
    // playback after the stream ends. Without this, the user sees "Stream ended"
    // with no way to watch the recording.
    let vodVideoId = "";
    try {
      // Calculate duration from startedAt → endedAt
      const startTime = stream.startedAt ? new Date(stream.startedAt).getTime() : Date.now() - 60000;
      const endTime = new Date(updated.endedAt).getTime();
      const durationSec = Math.max(1, Math.round((endTime - startTime) / 1000));

      // Pick a sample video URL (since we don't have real recordings)
      const sampleVideos = [
        "/samples/big-buck-bunny.mp4",
        "/samples/elephants-dream.mp4",
        "/samples/sintel.mp4",
        "/samples/tears-of-steel.mp4",
        "/samples/for-bigger-fun.mp4",
        "/samples/for-bigger-escapes.mp4",
      ];
      const videoUrl = sampleVideos[Math.floor(Math.random() * sampleVideos.length)];

      // Generate a procedural thumbnail (from-scratch, no external API)
      const { customThumbnailUrl } = await import("@/lib/custom-thumbnail");
      const thumbnailUrl = customThumbnailUrl(stream.title || "Live Stream", stream.category || "Tech", 640, 360);

      // Generate a procedural avatar
      const { customAvatarDataUrl } = await import("@/lib/custom-avatar");
      const channelAvatarUrl = customAvatarDataUrl(stream.streamerName || "Anonymous", 48);

      // Find or create a channel for this streamer
      let channelId = stream.channelId;
      if (!channelId) {
        const existingChannel = await db.channel.findFirst({
          where: { handle: `live_${stream.streamerName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 20)}` },
        }).catch(() => null);
        if (existingChannel) {
          channelId = existingChannel.id;
        } else {
          const newChannel = await db.channel.create({
            data: {
              name: stream.streamerName || "Live Streamer",
              handle: `live_${stream.streamerName.replace(/[^a-zA-Z0-9]/g, "").toLowerCase().slice(0, 20) || "streamer"}`,
              avatarUrl: channelAvatarUrl,
              bannerColors: "#1A4A5A,#C2A060,#C06070",
              description: `Live streams by ${stream.streamerName}`,
              subscribers: 0,
            },
          }).catch(() => null);
          if (newChannel) channelId = newChannel.id;
        }
      }
      if (!channelId) {
        // Last resort: use the first channel in the DB
        const anyChannel = await db.channel.findFirst({ select: { id: true } }).catch(() => null);
        channelId = anyChannel?.id || "";
      }

      // Create the VOD Video entry
      const vodVideo = await db.video.create({
        data: {
          title: stream.title || "Live Stream Recording",
          description: stream.description || `Recording of live stream by ${stream.streamerName}.`,
          thumbnailUrl,
          videoUrl,
          durationSec,
          views: stream.peakViewerCount || 0,
          likes: 0,
          dislikes: 0,
          category: stream.category || "Tech",
          tags: "live|recording|vod",
          channelId: channelId || "",
          visibility: "public",
          publishedAt: new Date(),
          language: "",
          ageGated: false,
          clipPolicy: "allowed",
          aiVibe: "",
        },
      }).catch((e: any) => {
        console.error("[live-streams] VOD creation failed:", e?.message?.slice(0, 200));
        return null;
      });

      if (vodVideo) {
        vodVideoId = vodVideo.id;
        // Link the VOD to the stream
        await db.liveStream.update({
          where: { id },
          data: { vodVideoId: vodVideoId },
        }).catch(() => {});
        console.log(`[live-streams] VOD created: ${vodVideoId} for stream ${id}`);
      }
    } catch (vodErr: any) {
      console.error("[live-streams] VOD conversion error:", vodErr?.message?.slice(0, 200));
      // Non-fatal — the stream is still ended, just no VOD
    }

    return NextResponse.json({
      ok: true,
      stream: {
        id: updated.id,
        status: updated.status,
        peakViewerCount: updated.peakViewerCount,
        startedAt: updated.startedAt,
        endedAt: updated.endedAt,
        vodVideoId,
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
