import { NextRequest, NextResponse } from "next/server";
import { createHmac, createHash } from "node:crypto";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/media/presign-upload
 *
 * Returns a presigned URL for direct browser → R2 upload.
 * Per v6 spec §21: the browser uploads directly to R2, NOT through Vercel.
 *
 * This implementation uses a manual AWS Signature V4 presigned URL — no
 * AWS SDK needed (keeps the bundle lean for Vercel).
 *
 * Body: { videoId, filename, contentType, fileSize }
 * Response: { uploadUrl, method, headers, expiresIn }
 */

const R2_ACCOUNT_ID = process.env.R2_ACCOUNT_ID || "";
const R2_ACCESS_KEY_ID = process.env.R2_ACCESS_KEY_ID || "";
const R2_SECRET_ACCESS_KEY = process.env.R2_SECRET_ACCESS_KEY || "";
const R2_BUCKET = process.env.R2_BUCKET || "mashahd-media";

const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const PRESIGN_EXPIRY = 3600; // 1 hour

/**
 * Generate an AWS Signature V4 presigned URL for R2 (S3-compatible).
 * No external SDK needed — pure crypto.
 */
function presignR2Url(opts: {
  bucket: string;
  key: string;
  accessKeyId: string;
  secretAccessKey: string;
  accountId: string;
  contentType: string;
  expiresIn: number;
}): string {
  const { bucket, key, accessKeyId, secretAccessKey, accountId, contentType, expiresIn } = opts;
  const host = `${accountId}.r2.cloudflarestorage.com`;
  const endpoint = `https://${host}/${bucket}/${key}`;

  const now = new Date();
  const dateStamp = now.toISOString().slice(0, 10).replace(/-/g, "");
  const amzDate = now.toISOString().slice(0, 19).replace(/[-:]/g, "") + "Z";
  const credentialScope = `${dateStamp}/auto/s3/aws4_request`;

  // Canonical request
  const canonicalUri = `/${bucket}/${key}`;
  const canonicalQueryString = [
    `X-Amz-Algorithm=AWS4-HMAC-SHA256`,
    `X-Amz-Credential=${encodeURIComponent(accessKeyId + "/" + credentialScope)}`,
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

  // String to sign
  const stringToSign = [
    "AWS4-HMAC-SHA256",
    amzDate,
    credentialScope,
    createHash("sha256").update(canonicalRequest).digest("hex"),
  ].join("\n");

  // Signing key
  const kDate = createHmac("sha256", `AWS4${secretAccessKey}`).update(dateStamp).digest();
  const kRegion = createHmac("sha256", kDate).update("auto").digest();
  const kService = createHmac("sha256", kRegion).update("s3").digest();
  const kSigning = createHmac("sha256", kService).update("aws4_request").digest();
  const signature = createHmac("sha256", kSigning).update(stringToSign).digest("hex");

  // Build the final presigned URL
  return `${endpoint}?${canonicalQueryString}&X-Amz-Signature=${signature}`;
}

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

  // Generate presigned URL using pure crypto (no AWS SDK).
  const uploadUrl = presignR2Url({
    bucket: R2_BUCKET,
    key,
    accessKeyId: R2_ACCESS_KEY_ID,
    secretAccessKey: R2_SECRET_ACCESS_KEY,
    accountId: R2_ACCOUNT_ID,
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
    expiresIn: PRESIGN_EXPIRY,
  });
}
