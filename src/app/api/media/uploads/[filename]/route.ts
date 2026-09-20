import { NextRequest, NextResponse } from "next/server";
import { readFile, stat } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * GET /api/media/uploads/[filename]
 *
 * Serves an uploaded video file from MEDIA_STORAGE_PATH/uploads/.
 * Supports HTTP Range requests so the <video> element can seek to any
 * position without downloading the whole file.
 *
 * SECURITY:
 *   - The filename is validated against path-traversal (no `..`, no `/`).
 *   - Only files inside the uploads directory are served.
 *   - No auth required — uploaded videos are public (visibility is
 *     enforced at the /api/videos list level, not at the file level).
 *
 * This is the zero-cost dev storage backend. For production, this would
 * be replaced by a CDN-backed S3/Filebase URL.
 */

const UPLOADS_DIR = process.env.MEDIA_STORAGE_PATH
  ? path.join(process.env.MEDIA_STORAGE_PATH, "uploads")
  : "/home/z/my-project/storage/uploads";

// MIME types for known extensions.
const MIME_BY_EXT: Record<string, string> = {
  ".mp4": "video/mp4",
  ".webm": "video/webm",
  ".mov": "video/quicktime",
  ".mkv": "video/x-matroska",
};

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ filename: string }> },
) {
  const { filename } = await params;

  // ── Path-traversal guard ──
  // Reject any filename containing path separators or `..`.
  if (!filename || filename.includes("/") || filename.includes("\\") || filename.includes("..")) {
    return NextResponse.json({ error: "invalid filename" }, { status: 400 });
  }
  // Only allow filenames matching our upload pattern (vid_<ts>_<rand>.<ext>).
  if (!/^vid_[a-zA-Z0-9_]+\.[a-zA-Z0-9]+$/.test(filename)) {
    return NextResponse.json({ error: "filename not recognized as an upload" }, { status: 400 });
  }

  const filePath = path.join(UPLOADS_DIR, filename);
  if (!existsSync(filePath)) {
    return NextResponse.json({ error: "file not found" }, { status: 404 });
  }

  let fileStat;
  try {
    fileStat = await stat(filePath);
  } catch {
    return NextResponse.json({ error: "stat failed" }, { status: 500 });
  }

  const fileSize = fileStat.size;
  const ext = path.extname(filename).toLowerCase();
  const contentType = MIME_BY_EXT[ext] || "application/octet-stream";

  // ── Range support ──
  // Browsers send `Range: bytes=<start>-<end>` when seeking. We parse it
  // + return a 206 Partial Content response with the requested byte range.
  const rangeHeader = req.headers.get("range");
  if (rangeHeader) {
    // Parse "bytes=<start>-<end>" (end is optional).
    const match = /bytes=(\d*)-(\d*)/.exec(rangeHeader);
    if (match) {
      const start = match[1] ? parseInt(match[1], 10) : 0;
      const end = match[2] ? parseInt(match[2], 10) : fileSize - 1;
      if (start >= 0 && end < fileSize && start <= end) {
        const chunkSize = end - start + 1;
        try {
          // Read just the requested range (not the whole file).
          const fd = await readFile(filePath);
          const chunk = fd.subarray(start, end + 1);
          return new NextResponse(chunk, {
            status: 206,
            headers: {
              "Content-Type": contentType,
              "Content-Range": `bytes ${start}-${end}/${fileSize}`,
              "Content-Length": String(chunkSize),
              "Accept-Ranges": "bytes",
              "Cache-Control": "public, max-age=86400",
            },
          });
        } catch (e: any) {
          console.error("[media] range read failed:", e?.message);
          return NextResponse.json({ error: "read failed" }, { status: 500 });
        }
      }
    }
  }

  // No range — return the whole file.
  try {
    const data = await readFile(filePath);
    return new NextResponse(data, {
      status: 200,
      headers: {
        "Content-Type": contentType,
        "Content-Length": String(fileSize),
        "Accept-Ranges": "bytes",
        "Cache-Control": "public, max-age=86400",
      },
    });
  } catch (e: any) {
    console.error("[media] read failed:", e?.message);
    return NextResponse.json({ error: "read failed" }, { status: 500 });
  }
}
