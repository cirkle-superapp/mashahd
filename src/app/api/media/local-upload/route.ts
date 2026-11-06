import { NextRequest, NextResponse } from "next/server";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/media/local-upload?videoId=X&filename=Y
 *
 * Zero-cost local filesystem upload endpoint (Pass 103).
 *
 * When STORAGE_PROVIDER=local (the default), this endpoint accepts the
 * uploaded video file directly via POST body and stores it on the local
 * filesystem under MEDIA_STORAGE_PATH/uploads/. The file is then served
 * by GET /api/media/uploads/[filename] with HTTP Range support.
 *
 * This replaces the R2/cloud presigned-URL flow with a 100% free, no-billing
 * alternative. No payment card, no S3 account, no egress fees. The only
 * limit is local disk space (typically 50GB+ on Vercel/self-hosted).
 *
 * The browser PUTs the file to this endpoint (matching the presign-upload
 * contract: method=POST, body=raw file bytes). The endpoint:
 *   1. Validates the videoId exists in the DB
 *   2. Sanitizes the filename (path-traversal safe)
 *   3. Writes the file to {MEDIA_STORAGE_PATH}/uploads/{videoId}_{filename}
 *   4. Returns the serving URL + storage key
 *
 * Body: raw file bytes (Content-Type from the presign response)
 * Query: videoId, filename
 */
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB

const UPLOADS_DIR = process.env.MEDIA_STORAGE_PATH
  ? path.join(process.env.MEDIA_STORAGE_PATH, "uploads")
  : path.join(process.cwd(), "storage", "uploads");

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`local-upload:${ip}`, 3, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many upload requests" }, { status: 429 });
  }

  const url = new URL(req.url);
  const videoId = url.searchParams.get("videoId");
  const filename = url.searchParams.get("filename");

  if (!videoId || !filename) {
    return NextResponse.json({ error: "videoId + filename query params required" }, { status: 400 });
  }

  // Validate the video exists.
  try {
    const video = await db.video.findUnique({ where: { id: videoId } });
    if (!video) {
      return NextResponse.json({ error: "video not found" }, { status: 404 });
    }
  } catch {
    return NextResponse.json({ error: "database unavailable" }, { status: 500 });
  }

  // Sanitize filename — prevent path traversal.
  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "source.mp4";
  const storedFilename = `${videoId}_${safeName}`;
  const absPath = path.join(UPLOADS_DIR, storedFilename);

  // Double-check the resolved path is inside UPLOADS_DIR (path-traversal guard).
  if (!absPath.startsWith(path.resolve(UPLOADS_DIR))) {
    return NextResponse.json({ error: "invalid filename" }, { status: 400 });
  }

  // Ensure the uploads directory exists.
  if (!existsSync(UPLOADS_DIR)) {
    try { await mkdir(UPLOADS_DIR, { recursive: true }); } catch { /* ignore */ }
  }

  // Read the file body and check size.
  const body = await req.arrayBuffer();
  if (body.byteLength > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024 / 1024}GB)` },
      { status: 413 }
    );
  }

  // Write the file.
  try {
    await writeFile(absPath, Buffer.from(body));
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    return NextResponse.json({ error: `write failed: ${msg}` }, { status: 500 });
  }

  // Update the media processing job status.
  try {
    await db.mediaProcessingJob.updateMany({
      where: { videoId, status: "UPLOADING" },
      data: { status: "UPLOADED" },
    });
  } catch { /* best-effort */ }

  return NextResponse.json({
    success: true,
    key: `uploads/${storedFilename}`,
    servingUrl: `/api/media/uploads/${storedFilename}`,
    provider: "local",
    size: body.byteLength,
    billingRisk: "NONE — stored on local filesystem, zero cloud cost",
  });
}

export async function GET() {
  return NextResponse.json({
    endpoint: "/api/media/local-upload",
    method: "POST",
    description: "Zero-cost local filesystem upload — no R2, no S3, no payment card",
    billingRisk: "NONE",
    maxFileSize: `${MAX_FILE_SIZE / 1024 / 1024 / 1024}GB`,
    storageDir: UPLOADS_DIR,
  });
}
