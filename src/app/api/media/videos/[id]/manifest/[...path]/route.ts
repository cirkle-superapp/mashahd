import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { getStorage } from "@/lib/storage";

/**
 * GET /api/media/videos/[id]/manifest/[...path]
 * Serves the HLS manifest files (master.m3u8, rendition index.m3u8) with
 * correct MIME types and short cache headers (manifests are mutable).
 *
 * Segments (.m4s, init.mp4) are served with immutable cache headers by this
 * same route (segments are immutable — immutable cache).
 *
 * CORS: uses ALLOWED_ORIGINS env var (comma-separated) instead of wildcard.
 * Falls back to the request origin for same-origin, or * for development.
 */
function getCorsOrigin(req: NextRequest): string {
  const allowed = process.env.ALLOWED_ORIGINS;
  if (!allowed) return "*";
  const origins = allowed.split(",").map((s) => s.trim());
  const requestOrigin = req.headers.get("origin");
  if (requestOrigin && origins.includes(requestOrigin)) {
    return requestOrigin;
  }
  return origins[0] || "*";
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string; path: string[] }> }
) {
  const { id, path: parts } = await params;
  const file = parts.join("/");
  const rel = path.join("videos", id, "v1", file);

  const storage = getStorage();
  if (!(await storage.exists(rel))) {
    return new NextResponse("Not Found", { status: 404 });
  }

  const stat = await storage.stat(rel);
  const ext = path.extname(file);
  const mime =
    ext === ".m3u8"
      ? "application/vnd.apple.mpegurl"
      : ext === ".mp4"
      ? "video/mp4"
      : ext === ".m4s"
      ? "video/iso.segment"
      : ext === ".ts"
      ? "video/mp2t"
      : ext === ".jpg" || ext === ".jpeg"
      ? "image/jpeg"
      : ext === ".png"
      ? "image/png"
      : ext === ".webp"
      ? "image/webp"
      : "application/octet-stream";

  const isSegment = ext === ".m4s" || ext === ".mp4" || ext === ".ts";
  const isPoster = ext === ".jpg" || ext === ".jpeg" || ext === ".png" || ext === ".webp";
  // Segments and poster images are immutable — cache forever.
  // Manifests are mutable — never cache.
  const cacheControl = isSegment || isPoster
    ? "public, max-age=31536000, immutable"
    : "no-cache";
  const corsOrigin = getCorsOrigin(req);

  const range = req.headers.get("range");
  const data = await storage.read(rel);
  if (range && isSegment) {
    const [startStr, endStr] = range.replace("bytes=", "").split("-");
    const start = parseInt(startStr, 10);
    const end = endStr ? parseInt(endStr, 10) : data.length - 1;
    const chunk = data.subarray(start, end + 1);
    return new NextResponse(chunk, {
      status: 206,
      headers: {
        "Content-Type": mime,
        "Content-Range": `bytes ${start}-${end}/${data.length}`,
        "Content-Length": String(chunk.length),
        "Accept-Ranges": "bytes",
        "Cache-Control": cacheControl,
        "Access-Control-Allow-Origin": corsOrigin,
      },
    });
  }

  return new NextResponse(data, {
    status: 200,
    headers: {
      "Content-Type": mime,
      "Content-Length": String(stat.size),
      "Accept-Ranges": "bytes",
      "Cache-Control": cacheControl,
      "Access-Control-Allow-Origin": corsOrigin,
    },
  });
}
