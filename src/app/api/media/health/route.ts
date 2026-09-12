import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { detectFFmpeg } from "@/lib/media-worker";
import { getStorage } from "@/lib/storage";

/**
 * GET /api/media/health
 * Readiness probe — verifies DB, storage, and FFmpeg are available.
 *
 * On serverless platforms (Vercel), the filesystem is read-only and FFmpeg
 * may not be installed. The health check gracefully degrades: it reports
 * the status of each subsystem independently so the caller can see what's
 * available, rather than failing hard on the first missing piece. The DB
 * is the only hard requirement — if the DB is up, the core app works
 * (browse, watch, AI features, auth, playlists). Media upload/transcoding
 * only works where storage is writable + FFmpeg is present (self-hosted).
 */
export async function GET() {
  const checks: Record<string, string> = {};
  let allOk = true;

  // DB check — the only hard requirement.
  try {
    await db.$queryRaw`SELECT 1`;
    checks.database = "ok";
  } catch (err) {
    checks.database = "error";
    checks.databaseError = String(err).slice(0, 200);
    allOk = false;
  }

  // Storage check — best-effort. On serverless this may be read-only.
  try {
    const storage = getStorage();
    await storage.mkdir(".health");
    checks.storage = "ok";
  } catch (err) {
    checks.storage = "read_only_or_unavailable";
    // Don't fail the whole health check — storage is only needed for uploads.
  }

  // FFmpeg check — best-effort. On serverless this isn't installed.
  try {
    const { ffmpeg, ffprobe } = detectFFmpeg();
    checks.ffmpeg = ffmpeg;
    checks.ffprobe = ffprobe;
  } catch {
    checks.ffmpeg = "not_found";
    checks.ffprobe = "not_found";
  }

  // The app is "ready" if the DB is up. Storage + FFmpeg are optional
  // (only needed for the media upload/transcode pipeline).
  return NextResponse.json(
    {
      status: allOk ? "ready" : "degraded",
      checks,
      timestamp: new Date().toISOString(),
    },
    { status: allOk ? 200 : 503 }
  );
}
