import { S3Client, PutObjectCommand } from "@aws-sdk/client-s3";
import { getSignedUrl } from "@aws-sdk/s3-request-presigner";
import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/media/presign-upload
 *
 * Returns a presigned URL for direct browser → R2 upload.
 * Per v6 spec §21: the browser uploads directly to R2, NOT through Vercel.
 * This avoids Vercel's body limit + serverless function timeout.
 *
 * Flow:
 *   Browser → POST /api/media/presign-upload (gets presigned URL)
 *   Browser → PUT directly to R2 (uploads the file)
 *   Browser → POST /api/media/upload-complete (triggers pipeline)
 *
 * Body: { videoId, filename, contentType, fileSize }
 * Response: { uploadUrl, method, headers, expiresIn }
 */

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "mashahd-media";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const PRESIGN_EXPIRY = 60 * 60; // 1 hour

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`presign:${ip}`, 3, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many upload requests" }, { status: 429 });
  }

  if (!R2_ACCOUNT_ID || !R2_ACCESS_KEY_ID || !R2_SECRET_ACCESS_KEY) {
    return NextResponse.json(
      { error: "R2 storage not configured — use server-mediated upload instead" },
      { status: 501 }
    );
  }

  const body = await req.json().catch(() => ({}));
  const { videoId, filename, contentType, fileSize } = body;

  if (!videoId || !filename) {
    return NextResponse.json({ error: "videoId + filename required" }, { status: 400 });
  }

  if (fileSize && fileSize > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024 / 1024}GB)` },
      { status: 413 }
    );
  }

  const video = await db.video.findUnique({ where: { id: videoId } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const safeName = String(filename).replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "source.mp4";
  const key = `videos/${videoId}/source/${safeName}`;

  const s3 = new S3Client({
    region: "auto",
    endpoint: `https://${R2_ACCOUNT_ID}.r2.cloudflarestorage.com`,
    credentials: {
      accessKeyId: R2_ACCESS_KEY_ID,
      secretAccessKey: R2_SECRET_ACCESS_KEY,
    },
    forcePathStyle: true,
  });

  try {
    const command = new PutObjectCommand({
      Bucket: R2_BUCKET,
      Key: key,
      ContentType: contentType || "video/mp4",
    });

    const uploadUrl = await getSignedUrl(s3, command, { expiresIn: PRESIGN_EXPIRY });

    await db.mediaProcessingJob.updateMany({
      where: { videoId, status: "UPLOADING" },
      data: { status: "UPLOADING" },
    });

    return NextResponse.json({
      uploadUrl,
      method: "PUT",
      headers: { "Content-Type": contentType || "video/mp4" },
      key,
      expiresIn: PRESIGN_EXPIRY,
    });
  } catch (e) {
    console.error("[presign-upload] Failed:", e);
    return NextResponse.json({ error: "Failed to generate presigned URL" }, { status: 500 });
  }
}
