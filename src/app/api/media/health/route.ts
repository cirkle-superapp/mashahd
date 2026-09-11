import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { detectFFmpeg } from "@/lib/media-worker";
import { getStorage } from "@/lib/storage";

/**
 * GET /api/media/health/live
 * Liveness probe — the process is up.
 *
 * GET /api/media/health/ready
 * Readiness probe — verifies DB, storage, and FFmpeg are available.
 */
export async function GET() {
  try {
    // DB check
    await db.$queryRaw`SELECT 1`;

    // Storage check — ensure the media root is writable.
    const storage = getStorage();
    await storage.mkdir(".health");

    // FFmpeg check
    const { ffmpeg, ffprobe } = detectFFmpeg();

    return NextResponse.json({
      status: "ready",
      checks: {
        database: "ok",
        storage: "ok",
        ffmpeg: ffmpeg,
        ffprobe: ffprobe,
      },
      timestamp: new Date().toISOString(),
    });
  } catch (err) {
    return NextResponse.json(
      {
        status: "not_ready",
        error: String(err),
        timestamp: new Date().toISOString(),
      },
      { status: 503 }
    );
  }
}
