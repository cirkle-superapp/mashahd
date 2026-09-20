import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/videos/[id]/renditions
 *
 * Per spec §35 (multi-resolution choice): returns the list of available
 * playback resolutions for a video. Used by the player's quality selector.
 *
 * Sources of rendition data (in priority order):
 *   1. VideoRendition rows in the DB — populated by the transcoding worker
 *      when it produces 144p/360p/480p/720p/1080p HLS variants.
 *   2. Fallback: a single "Source" rendition derived from the video's
 *      videoUrl (used when no transcoding has run — e.g. direct MP4 upload
 *      or a demo video). The player shows "Source" as the only option.
 *
 * The response shape is stable so the player can render the selector the
 * same way regardless of whether real renditions exist.
 *
 * Rate limited: 30 req/min per IP (read-heavy but cheap).
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> },
) {
  const { id } = await params;
  if (!id) {
    return NextResponse.json({ error: "id required" }, { status: 400 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`renditions:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  try {
    // Fetch the video to get its source URL + duration.
    const video = await db.video.findUnique({
      where: { id },
      select: { id: true, videoUrl: true, durationSec: true },
    }).catch(() => null);

    if (!video) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // Fetch any VideoRendition rows (created by the transcoding worker).
    const renditions = await db.videoRendition.findMany({
      where: { videoId: id },
      orderBy: { height: "asc" },
    }).catch(() => []);

    // Detect whether the source URL is an HLS master playlist.
    const isHls = /\.m3u8(\?|$)/i.test(video.videoUrl) || video.videoUrl.includes("manifest/master");

    if (renditions.length > 0) {
      // Real renditions exist (transcoding has run).
      return NextResponse.json({
        source: "db",
        isHls,
        renditions: (renditions as any[]).map((r) => ({
          id: r.id,
          resolution: r.resolution, // "1080p", "720p", etc.
          height: r.height,
          width: r.width,
          bitrate: r.bitrate, // kbps
          codec: r.codec,
          manifestPath: r.manifestPath,
        })),
        // The "Auto" option lets hls.js pick the best rendition based on
        // bandwidth + the user's preferredQuality hint (if any).
        autoAvailable: isHls,
      });
    }

    // No DB renditions — synthesize a single "Source" rendition from the
    // video URL. This lets the player show the selector UI even before
    // transcoding has run. For HLS sources, hls.js will expose the real
    // levels from the master playlist at runtime (these aren't known
    // server-side without fetching the manifest).
    return NextResponse.json({
      source: "fallback",
      isHls,
      renditions: isHls
        ? // For HLS sources, the player will discover levels at runtime
          // via hls.js. We return an empty array + a flag so the player
          // knows to populate the selector from hlsRef.current.levels.
          []
        : [
            {
              id: "source",
              resolution: "Source",
              height: 0, // unknown
              width: 0,
              bitrate: 0,
              codec: "auto",
              manifestPath: video.videoUrl,
            },
          ],
      autoAvailable: isHls,
      note: isHls
        ? "HLS source — levels discovered at runtime via hls.js"
        : "Direct MP4 source — no renditions to switch between",
    });
  } catch (e: any) {
    console.error("[renditions] error:", e?.message?.slice(0, 200));
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
