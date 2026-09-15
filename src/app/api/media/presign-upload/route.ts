import { NextRequest, NextResponse } from "next/server";
import { createHmac, createHash } from "node:crypto";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/media/presign-upload
 *
 * Returns a presigned URL for direct browser → Filebase (S3-compatible) upload.
 * Per v6 spec §21: the browser uploads directly to the storage backend,
 * NOT through Vercel. This avoids Vercel's body limit + serverless timeout.
 *
 * Works with ANY S3-compatible provider: Filebase, MinIO, Backblaze B2.
 * The provider is selected by STORAGE_PROVIDER env var:
 *   - filebase → https://s3.filebase.io (no payment card)
 *
 * Uses manual AWS Signature V4 — no AWS SDK needed (keeps bundle lean).
 *
 * Body: { videoId, filename, contentType, fileSize }
 * Response: { uploadUrl, method, headers, key, expiresIn }
 */

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const PRESIGN_EXPIRY = 3600; // 1 hour

interface S3Config {
  endpoint: string;
  accessKeyId: string;
  secretAccessKey: string;
  bucket: string;
  region: string;
}

function getS3Config(): S3Config | null {
  const provider = process.env.STORAGE_PROVIDER || "local";

  if (provider === "filebase") {
    const accessKeyId = process.env.FILEBASE_ACCESS_KEY_ID;
    const secretAccessKey = process.env.FILEBASE_SECRET_ACCESS_KEY;
    const bucket = process.env.FILEBASE_BUCKET || "mashahd";
    if (!accessKeyId || !secretAccessKey) return null;
    return { endpoint: "https://s3.filebase.io", accessKeyId, secretAccessKey, bucket, region: "auto" };
  }

  // Generic S3 (MinIO, Backblaze, etc.)
  if (provider === "s3") {
    const endpoint = process.env.S3_ENDPOINT;
    const accessKeyId = process.env.S3_ACCESS_KEY_ID;
    const secretAccessKey = process.env.S3_SECRET_ACCESS_KEY;
    const bucket = process.env.S3_BUCKET || "mashahd";
    const region = process.env.S3_REGION || "us-east-1";
    if (!endpoint || !accessKeyId || !secretAccessKey) return null;
    return { endpoint, accessKeyId, secretAccessKey, bucket, region };
  }

  return null; // local filesystem — no presigned URL needed
}

/**
 * Generate an AWS Signature V4 presigned PUT URL for any S3-compatible provider.
 * Pure crypto — no AWS SDK needed.
 */
function presignS3Url(opts: {
  config: S3Config;
  key: string;
  contentType: string;
  expiresIn: number;
}): string {
  const { config, key, contentType, expiresIn } = opts;
  const host = new URL(config.endpoint).host;

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = now.toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
  const credentialScope = `${dateStamp}/${config.region}/s3/aws4_request`;

  const canonicalUri = `/${config.bucket}/${key}`;
  const canonicalQueryString = [
    `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Credential=${encodeURIComponent(config.accessKeyId + "/" + credentialScope)}`,
    `X-Amz-Date=${amzDate}`,
    `X-Amz-Expires=${expiresIn}`,
    `X-Amz-SignedHeaders=host`,
  ].join("&");

  const canonicalHeaders = `host:${host}\n`;
  const signedHeaders = "host";
  const payloadHash = "UNSIGNED-PAYLOAD";

  const canonicalRequest = [
    "PUT",
    canonicalUri,
    canonicalQueryString,
    canonicalHeaders,
    signedHeaders,
    payloadHash,
  ].join("\n");

  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  const kDate = createHmac("sha256", `AWS4${config.secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update(config.region).digest();
  const kService = createHmac("sha256", kRegion).update("s3").digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  return `${config.endpoint}${canonicalUri}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`presign:${ip}`, 3, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many upload requests" }, { status: 429 });
  }

  const config = getS3Config();
  if (!config) {
    return NextResponse.json({
      error: "Cloud storage not configured. Set STORAGE_PROVIDER=filebase and FILEBASE_* env vars.",
      hint: "Filebase is recommended — 5GB free, no payment card required.",
    }, { status: 501 });
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

  const uploadUrl = presignS3Url({
    config,
    key,
    contentType: contentType || "video/mp4",
    expiresIn: PRESIGN_EXPIRY,
  });

  await db.mediaProcessingJob.updateMany({
    where: { videoId, status: "UPLOADING" },
    data: { status: "UPLOADING" },
  });

  return NextResponse.json({
    uploadUrl,
    method: "PUT",
    headers: { "Content-Type": contentType || "video/mp4" },
    key,
    provider: process.env.STORAGE_PROVIDER,
    expiresIn: PRESIGN_EXPIRY,
  });
}
