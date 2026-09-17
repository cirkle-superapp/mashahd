import { NextRequest, NextResponse } from "next/server";
import { promises as fs } from "node:fs";
import path from "node:path";
import { createHash } from "node:crypto";
import { db } from "@/lib/db";
import { getStorage, mediaPath } from "@/lib/storage";
import { probe, transcode, validateAssets, cleanTemp } from "@/lib/media-worker";
import { computeSwarmId } from "@/lib/swarm";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

// ── Upload security constants (Phase 3, Phase 25) ──
const MAX_FILE_SIZE = 2 * 1024 * 1024 * 1024; // 2 GB
const MAX_DURATION_SEC = 2 * 60 * 60; // 2 hours
const MAX_RESOLUTION_HEIGHT = 4320; // 8K cap
const ALLOWED_CODECS = ["h264", "h265", "hevc", "vp9", "av1", "mpeg4", "vp8"];
const ALLOWED_AUDIO_CODECS = ["aac", "mp3", "opus", "vorbis", "flac", "none"];
const ALLOWED_CONTAINERS = ["mp4", "webm", "mkv", "mov", "avi"];

/**
 * Check magic bytes (first 12 bytes) to verify the file is actually a video
 * container — not just a file with a .mp4 extension.
 */
function checkMagicBytes(buf: Buffer): { valid: boolean; container: string } {
  if (buf.length < 12) return { valid: false, container: "unknown" };
  // MP4/MOV: bytes 4-8 = "ftyp"
  if (buf[4] === 0x66 && buf[5] === 0x74 && buf[6] === 0x79 && buf[7] === 0x70) {
    return { valid: true, container: "mp4" };
  }
  // WebM/Matroska: starts with 0x1A 0x45 0xDF 0xA3
  if (buf[0] === 0x1a && buf[1] === 0x45 && buf[2] === 0xdf && buf[3] === 0xa3) {
    return { valid: true, container: "webm" };
  }
  // AVI: starts with "RIFF" + "AVI "
  if (buf[0] === 0x52 && buf[1] === 0x49 && buf[2] === 0x46 && buf[3] === 0x46 &&
      buf[8] === 0x41 && buf[9] === 0x56 && buf[10] === 0x49) {
    return { valid: true, container: "avi" };
  }
  return { valid: false, container: "unknown" };
}

/**
 * Sanitize a filename — strip path separators, null bytes, and dangerous chars.
 * Returns a safe basename (no directory traversal possible).
 */
function sanitizeFilename(name: string): string {
  const basename = path.basename(name || "source.mp4");
  return basename.replace(/[^a-zA-Z0-9._-]/g, "_").slice(0, 200) || "source.mp4";
}

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
  const rl = await rateLimit(`upload:${ip}`, 3, 60_000);
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

  // File size limit.
  if (file.size > MAX_FILE_SIZE) {
    return NextResponse.json(
      { error: `File too large (max ${MAX_FILE_SIZE / 1024 / 1024 / 1024}GB)` },
      { status: 413 }
    );
  }

  const buf = Buffer.from(await file.arrayBuffer());

  // ── Magic-byte validation (Phase 25: file upload security) ──
  // Don't trust the browser-supplied MIME type — check the actual bytes.
  const magicCheck = checkMagicBytes(buf);
  if (!magicCheck.valid) {
    return NextResponse.json(
      { error: "File is not a recognized video container (MP4/WebM/MKV/AVI)" },
      { status: 400 }
    );
  }
  if (!ALLOWED_CONTAINERS.includes(magicCheck.container)) {
    return NextResponse.json(
      { error: `Container type ${magicCheck.container} not allowed` },
      { status: 400 }
    );
  }

  const sourceHash = createHash("sha256").update(buf).digest("hex");

  // Sanitize the original filename to prevent path traversal.
  const safeName = sanitizeFilename(file.name);

  const storage = getStorage();
  const sourceRel = mediaPath(id, "source", safeName);
  await storage.write(sourceRel, buf);

  const tmpPath = path.join(process.cwd(), "storage", "tmp", `${id}-source`);
  await fs.mkdir(path.dirname(tmpPath), { recursive: true });
  await fs.writeFile(tmpPath, buf);
  const probeResult = await probe(tmpPath);

  // ── ffprobe-based validation (Phase 3, Phase 25) ──
  if (!ALLOWED_CODECS.includes(probeResult.codec)) {
    await cleanTemp(path.dirname(tmpPath));
    return NextResponse.json(
      { error: `Video codec ${probeResult.codec} not allowed. Allowed: ${ALLOWED_CODECS.join(", ")}` },
      { status: 400 }
    );
  }
  if (!ALLOWED_AUDIO_CODECS.includes(probeResult.audioCodec)) {
    await cleanTemp(path.dirname(tmpPath));
    return NextResponse.json(
      { error: `Audio codec ${probeResult.audioCodec} not allowed` },
      { status: 400 }
    );
  }
  if (probeResult.duration > MAX_DURATION_SEC) {
    await cleanTemp(path.dirname(tmpPath));
    return NextResponse.json(
      { error: `Video too long (max ${MAX_DURATION_SEC / 60} minutes)` },
      { status: 400 }
    );
  }
  if (probeResult.height > MAX_RESOLUTION_HEIGHT) {
    await cleanTemp(path.dirname(tmpPath));
    return NextResponse.json(
      { error: `Resolution too high (max ${MAX_RESOLUTION_HEIGHT}p)` },
      { status: 400 }
    );
  }

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
  // ── Atomic publish (Phase 3, Phase 18) ──
  // Transcode to a temp directory, validate, then rename to the final path.
  // This prevents viewers from fetching partially-written segments.
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

  // ── Atomic publish: rename temp dir → final dir ──
  // On POSIX filesystems, rename is atomic — viewers will either see the
  // old state or the complete new state, never a partial write.
  await fs.mkdir(path.dirname(finalOutDir), { recursive: true });
  // If a previous version exists (shouldn't, but be safe), remove it first.
  try { await fs.rm(finalOutDir, { recursive: true, force: true }); } catch {}
  await fs.rename(tmpOutDir, finalOutDir);

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
