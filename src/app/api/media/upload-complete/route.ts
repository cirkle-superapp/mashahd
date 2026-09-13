import { NextRequest, NextResponse } from "next/server";
import { createHash } from "node:crypto";
import { promises as fs } from "node:fs";
import path from "node:path";
import { db } from "@/lib/db";
import { getStorage, mediaPath } from "@/lib/storage";
import { probe, transcode, validateAssets, cleanTemp } from "@/lib/media-worker";
import { computeSwarmId } from "@/lib/swarm";
import { hashContent, computeContentId } from "@/lib/media-object";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";
import { canStartJob, jobStarted, jobEnded } from "@/lib/resource-governor";

/**
 * POST /api/media/upload-complete
 *
 * Called by the browser AFTER a direct-to-R2 upload completes.
 * Per v6 spec §22: triggers the media processing pipeline:
 *   download from R2 → ffprobe → validate → transcode → CMAF → publish to R2
 *
 * Body: { videoId, key, sourceHash }
 *   key = the R2 object key where the browser uploaded the file
 *   sourceHash = SHA-256 hash of the file (computed client-side)
 *
 * This endpoint runs on the self-hosted worker (not Vercel) because it
 * invokes FFmpeg. On Vercel, it returns 501 — use server-mediated upload.
 */

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`upload-complete:${ip}`, 3, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "Too many upload completions" }, { status: 429 });
  }

  const body = await req.json().catch(() => ({}));
  const { videoId, key, sourceHash } = body;

  if (!videoId || !key) {
    return NextResponse.json({ error: "videoId + key required" }, { status: 400 });
  }

  const video = await db.video.findUnique({ where: { id: videoId } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  // Check if the media worker can run here (FFmpeg available + writable FS).
  const resources = await canStartJob();
  if (!resources.canStartJob) {
    return NextResponse.json({
      error: "Media worker unavailable on this host",
      reasons: resources.reasons,
      hint: "This endpoint must run on the self-hosted media node, not Vercel.",
    }, { status: 501 });
  }

  // Download the source from storage (R2 or local).
  const storage = getStorage();
  const sourceBuf = await storage.read(key);
  const computedHash = hashContent(sourceBuf);

  // Verify integrity if the client provided a hash.
  if (sourceHash && sourceHash !== computedHash) {
    return NextResponse.json({
      error: "Source hash mismatch — file may have been corrupted during upload",
      expected: sourceHash,
      actual: computedHash,
    }, { status: 422 });
  }

  const contentId = computeContentId(computedHash);

  // Write source to temp for ffprobe.
  const tmpPath = path.join(process.cwd(), "storage", "tmp", `${videoId}-source`);
  await fs.mkdir(path.dirname(tmpPath), { recursive: true });
  await fs.writeFile(tmpPath, sourceBuf);

  const probeResult = await probe(tmpPath);

  // Store the source metadata.
  await db.videoSource.create({
    data: {
      videoId,
      sourceHash: computedHash,
      originalName: key.split("/").pop() || "source.mp4",
      storagePath: key,
      fileSize: probeResult.fileSize,
      duration: probeResult.duration,
      width: probeResult.width,
      height: probeResult.height,
      codec: probeResult.codec,
      audioCodec: probeResult.audioCodec,
      frameRate: probeResult.frameRate,
      bitrate: probeResult.bitrate,
    },
  });

  await db.video.update({
    where: { id: videoId },
    data: { durationSec: Math.round(probeResult.duration) },
  });

  // Update job status → QUEUED.
  await db.mediaProcessingJob.updateMany({
    where: { videoId, status: "UPLOADING" },
    data: { status: "QUEUED" },
  });

  // Run the pipeline asynchronously.
  jobStarted();
  runPipeline(videoId, tmpPath, contentId).catch(async (err) => {
    console.error(`[upload-complete] pipeline failed for ${videoId}:`, err);
    await db.mediaProcessingJob.updateMany({
      where: { videoId },
      data: { status: "FAILED", error: String(err).slice(0, 500), errorClass: "transient" },
    });
    await cleanTemp(path.dirname(tmpPath));
    jobEnded();
  });

  return NextResponse.json({
    videoId,
    status: "QUEUED",
    source: {
      duration: probeResult.duration,
      width: probeResult.width,
      height: probeResult.height,
      codec: probeResult.codec,
      contentId,
      hash: computedHash,
    },
  });
}

async function runPipeline(videoId: string, sourcePath: string, contentId: string) {
  const storage = getStorage();
  const tmpOutDir = path.join(process.cwd(), "storage", "tmp", `${videoId}-pipeline`);
  const finalOutDir = path.join(process.cwd(), "storage", "videos", videoId, "v1");

  await db.mediaProcessingJob.updateMany({
    where: { videoId },
    data: { status: "PROCESSING", startedAt: new Date() },
  });

  const { renditions, masterManifest } = await transcode(
    sourcePath,
    tmpOutDir,
    "cpu-safe",
    async (pct) => {
      await db.mediaProcessingJob.updateMany({
        where: { videoId },
        data: { progress: pct },
      });
    }
  );

  await db.mediaProcessingJob.updateMany({
    where: { videoId },
    data: { status: "PACKAGING", progress: 100 },
  });

  await db.mediaProcessingJob.updateMany({
    where: { videoId },
    data: { status: "VALIDATING" },
  });
  const valid = await validateAssets(tmpOutDir, renditions);
  if (!valid) throw new Error("asset validation failed");

  // Atomic publish: rename temp → final.
  await fs.mkdir(path.dirname(finalOutDir), { recursive: true });
  try { await fs.rm(finalOutDir, { recursive: true, force: true }); } catch {}
  await fs.rename(tmpOutDir, finalOutDir);

  // Publish renditions + manifests to Turso.
  const manifestVersion = "v1";
  for (const r of renditions) {
    const rendition = await db.videoRendition.create({
      data: {
        videoId,
        resolution: r.id,
        height: r.height,
        width: r.width,
        bitrate: r.bitrate,
        codec: "h264",
        manifestPath: path.join("videos", videoId, manifestVersion, r.id, "index.m3u8"),
      },
    });
    const swarmId = computeSwarmId(videoId, rendition.id, manifestVersion);
    await db.swarm.create({
      data: { swarmId, videoId, renditionId: rendition.id, manifestVersion },
    });
  }

  const masterHash = hashContent(await fs.readFile(masterManifest));
  await db.videoManifest.create({
    data: {
      videoId,
      version: manifestVersion,
      hash: masterHash,
      manifestPath: path.join("videos", videoId, manifestVersion, "master.m3u8"),
    },
  });

  await db.mediaProcessingJob.updateMany({
    where: { videoId },
    data: { status: "READY", completedAt: new Date() },
  });

  await db.video.update({
    where: { id: videoId },
    data: {
      videoUrl: `/api/media/videos/${videoId}/manifest/master.m3u8`,
      thumbnailUrl: `/api/media/videos/${videoId}/manifest/poster.jpg`,
    },
  });

  await cleanTemp(path.dirname(sourcePath));
  jobEnded();
  console.log(`[upload-complete] Pipeline complete for ${videoId}`);
}
