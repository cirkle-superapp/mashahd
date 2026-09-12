import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getStorage, mediaPath } from "@/lib/storage";
import { probe, transcode, validateAssets, cleanTemp } from "@/lib/media-worker";
import { computeSwarmId } from "@/lib/swarm";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/media/videos/[id]/upload
 * Receives the source video file (multipart/form-data), stores it, probes
 * it, then runs the async transcode → HLS/CMAF packaging pipeline.
 *
 * Rate limited: 3 uploads per minute per IP.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  // Rate limit
  const ip = getClientIP(req);
  const rl = rateLimit(`upload:${ip}`, 3, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "Too many uploads. Please wait a minute." },
      { status: 429 }
    );
  }

  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const formData = await req.formData();
  const file = formData.get("file") as File | null;
  if (!file) {
    return NextResponse.json({ error: "file required" }, { status: 400 });
  }

  if (!file.type.startsWith("video/")) {
    return NextResponse.json({ error: "file must be a video" }, { status: 400 });
  }

  const buf = Buffer.from(await file.arrayBuffer());
  const sourceHash = createHash("sha256").update(buf).digest("hex");

  const storage = getStorage();
  const sourceRel = mediaPath(id, "source", file.name || "source.mp4");
  await storage.write(sourceRel, buf);

  const tmpPath = path.join(process.cwd(), "storage", "tmp", `${id}-source`);
  await fs.mkdir(path.dirname(tmpPath), { recursive: true });
  await fs.writeFile(tmpPath, buf);
  const probeResult = await probe(tmpPath);

  await db.videoSource.create({
    data: {
      videoId: id,
      sourceHash,
      originalName: file.name,
      storagePath: sourceRel,
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
    where: { id },
    data: { durationSec: Math.round(probeResult.duration) },
  });

  await db.mediaProcessingJob.updateMany({
    where: { videoId: id, status: "UPLOADING" },
    data: { status: "QUEUED" },
  });

  runPipeline(id, tmpPath).catch(async (err) => {
    console.error(`[media pipeline] video ${id} failed:`, err);
    await db.mediaProcessingJob.updateMany({
      where: { videoId: id },
      data: { status: "FAILED", error: String(err).slice(0, 500) },
    });
    await cleanTemp(path.dirname(tmpPath));
  });

  return NextResponse.json({
    videoId: id,
    status: "QUEUED",
    source: {
      duration: probeResult.duration,
      width: probeResult.width,
      height: probeResult.height,
      codec: probeResult.codec,
    },
  });
}

async function runPipeline(videoId: string, sourcePath: string) {
  const storage = getStorage();
  const outDir = path.join(process.cwd(), "storage", "videos", videoId, "v1");

  await db.mediaProcessingJob.updateMany({
    where: { videoId },
    data: { status: "PROCESSING", startedAt: new Date() },
  });

  const { renditions, masterManifest } = await transcode(
    sourcePath,
    outDir,
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
  const valid = await validateAssets(outDir, renditions);
  if (!valid) throw new Error("asset validation failed");

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

  const masterHash = createHash("sha256")
    .update(await fs.readFile(masterManifest))
    .digest("hex");
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
}
