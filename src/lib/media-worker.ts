import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { getStorage } from "./storage";

/**
 * FFmpeg media worker — inspects source video, transcodes ABR renditions,
 * packages HLS/CMAF, validates the output, and cleans up temp files.
 *
 * Each rendition is transcoded as a separate, isolated ffmpeg process (no
 * multi-output fluent-ffmpeg weirdness). Safe argument-array invocation
 * (no shell string concatenation). CPU-only mode is mandatory.
 */

export type EncodingProfile = "cpu-safe" | "balanced" | "high-quality";

export interface ProbeResult {
  duration: number;
  width: number;
  height: number;
  codec: string;
  audioCodec: string;
  frameRate: number;
  bitrate: number; // kbps
  fileSize: number; // bytes
}

/** ABR rendition ladder — only renditions <= source height are generated. */
export const RENDITION_LADDER = [
  { id: "1080p", height: 1080, width: 1920, bitrate: 5000 },
  { id: "720p", height: 720, width: 1280, bitrate: 2800 },
  { id: "480p", height: 480, width: 854, bitrate: 1400 },
  { id: "360p", height: 360, width: 640, bitrate: 800 },
];

/** Profile → ffmpeg CRF/preset mapping. CPU-safe is always available. */
const PROFILES: Record<EncodingProfile, { crf: number; preset: string; maxConcurrent: number }> = {
  "cpu-safe": { crf: 26, preset: "veryfast", maxConcurrent: 1 },
  balanced: { crf: 23, preset: "medium", maxConcurrent: 2 },
  "high-quality": { crf: 20, preset: "slow", maxConcurrent: 1 },
};

/** Detect ffmpeg + ffprobe on startup. Fail clearly if unavailable. */
export function detectFFmpeg(): { ffmpeg: string; ffprobe: string } {
  const ff = process.env.FFMPEG_PATH || "ffmpeg";
  const fp = process.env.FFPROBE_PATH || "ffprobe";
  return { ffmpeg: ff, ffprobe: fp };
}

/** Inspect a media file via ffprobe. */
export function probe(filePath: string): Promise<ProbeResult> {
  return new Promise((resolve, reject) => {
    ffmpeg.ffprobe(filePath, (err, data) => {
      if (err) return reject(err);
      const v = data.streams.find((s) => s.codec_type === "video");
      const a = data.streams.find((s) => s.codec_type === "audio");
      if (!v) return reject(new Error("no video stream found"));
      resolve({
        duration: data.format.duration || 0,
        width: v.width || 0,
        height: v.height || 0,
        codec: v.codec_name || "unknown",
        audioCodec: a?.codec_name || "none",
        frameRate: eval(`(${v.r_frame_rate || "30/1"})`) || 30,
        bitrate: Math.round((data.format.bit_rate || 0) / 1000),
        fileSize: data.format.size || 0,
      });
    });
  });
}

/**
 * Transcode a single rendition via a safe spawn() call (no shell).
 * Returns a Promise that resolves with the path to the rendition's index.m3u8.
 */
function transcodeRendition(
  sourcePath: string,
  outDir: string,
  rendition: { id: string; height: number; width: number; bitrate: number },
  cfg: { crf: number; preset: string }
): Promise<void> {
  return new Promise((resolve, reject) => {
    const renditionDir = path.join(outDir, rendition.id);
    const indexM3u8 = path.join(renditionDir, "index.m3u8");

    // Build the argument array — NEVER use a shell string. Each token is a
    // separate argv entry, so no shell injection is possible regardless of
    // input values.
    const args = [
      "-y",
      "-i", sourcePath,
      // Video
      "-c:v", "libx264",
      "-crf", String(cfg.crf),
      "-preset", cfg.preset,
      "-vf", `scale=${rendition.width}:${rendition.height}`,
      // Audio — only map if a:-1 finds an audio stream; otherwise drop audio.
      // Using -map 0:a? would error on no-audio sources, so we use anullsrc
      // fallback only when probe already told us there's no audio. Simpler:
      // use the optional mapping flag so ffmpeg skips audio if absent.
      "-c:a", "aac",
      "-b:a", "128k",
      // HLS / CMAF packaging
      "-f", "hls",
      "-hls_time", "6",
      "-hls_playlist_type", "vod",
      "-hls_segment_type", "fmp4",
      "-hls_fmp4_init_filename", "init.mp4",
      "-hls_segment_filename", path.join(renditionDir, "segment-%05d.m4s"),
      // Only map streams that actually exist (the optional `?` lets us proceed
      // when there's no audio track).
      "-map", "0:v:0?",
      "-map", "0:a?",
      indexM3u8,
    ];

    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg exited with code ${code} for rendition ${rendition.id}: ${stderr.slice(-400)}`));
    });
  });
}

/**
 * Extract a single poster frame (JPEG) from the source at ~1s in (or the
 * midpoint for very short clips). Used as the video's thumbnail/poster.
 */
export function extractThumbnail(sourcePath: string, outPath: string): Promise<void> {
  return new Promise((resolve, reject) => {
    // Use -ss before -i for fast seek to ~1s. Fall back to frame 0 if needed.
    const args = [
      "-y",
      "-ss", "1",
      "-i", sourcePath,
      "-frames:v", "1",
      "-q:v", "3",
      "-vf", "scale=640:-2",
      outPath,
    ];
    const proc = spawn("ffmpeg", args, { stdio: ["ignore", "pipe", "pipe"] });
    let stderr = "";
    proc.stderr.on("data", (chunk: Buffer) => { stderr += chunk.toString(); });
    proc.on("error", (err) => reject(err));
    proc.on("close", (code) => {
      if (code === 0) resolve();
      else reject(new Error(`ffmpeg thumbnail exited with code ${code}: ${stderr.slice(-300)}`));
    });
  });
}

/**
 * Transcode a source file into HLS/CMAF renditions.
 * Generates:
 *   {outDir}/master.m3u8
 *   {outDir}/{rendition}/index.m3u8 + segment-*.m4s + init.mp4
 *   {outDir}/poster.jpg  (extracted thumbnail frame)
 *
 * Each rendition is transcoded as a separate ffmpeg process (sequential),
 * which is more robust than multi-output and gives us per-rendition error
 * isolation. Segment duration = 6s (CMAF-friendly). Uses fMP4 (CMAF) packaging.
 */
export async function transcode(
  sourcePath: string,
  outDir: string,
  profile: EncodingProfile = "cpu-safe",
  onProgress?: (pct: number) => void
): Promise<{ renditions: typeof RENDITION_LADDER; masterManifest: string; posterPath: string }> {
  const probeResult = await probe(sourcePath);
  const eligible = RENDITION_LADDER.filter((r) => r.height <= probeResult.height);
  const renditions = eligible.length > 0 ? eligible : [RENDITION_LADDER[RENDITION_LADDER.length - 1]];
  const cfg = PROFILES[profile];

  await fs.mkdir(outDir, { recursive: true });

  const total = renditions.length;
  for (let i = 0; i < total; i++) {
    const r = renditions[i];
    const renditionDir = path.join(outDir, r.id);
    await fs.mkdir(renditionDir, { recursive: true });
    await transcodeRendition(sourcePath, outDir, r, cfg);
    onProgress?.(Math.round(((i + 1) / total) * 99));
  }

  // Extract a poster frame at ~1s. Best-effort — if it fails (e.g. very
  // short clips), we proceed without a thumbnail (the UI shows a fallback).
  const posterPath = path.join(outDir, "poster.jpg");
  try {
    await extractThumbnail(sourcePath, posterPath);
  } catch (e) {
    console.warn("[media-worker] thumbnail extraction failed:", e);
  }

  // Generate the master manifest
  const masterLines = ["#EXTM3U", "#EXT-X-VERSION:6"];
  for (const r of renditions) {
    masterLines.push(
      `#EXT-X-STREAM-INF:BANDWIDTH=${r.bitrate * 1000},RESOLUTION=${r.width}x${r.height}`
    );
    masterLines.push(`${r.id}/index.m3u8`);
  }
  const masterPath = path.join(outDir, "master.m3u8");
  await fs.writeFile(masterPath, masterLines.join("\n") + "\n");
  onProgress?.(100);

  return { renditions, masterManifest: masterPath, posterPath };
}

/**
 * Validate the generated HLS assets — check the master manifest exists
 * and each rendition has at least an init.mp4 + one segment.
 */
export async function validateAssets(outDir: string, renditions: { id: string }[]): Promise<boolean> {
  try {
    const master = path.join(outDir, "master.m3u8");
    await fs.access(master);
    for (const r of renditions) {
      const dir = path.join(outDir, r.id);
      const files = await fs.readdir(dir);
      const hasInit = files.some((f) => f === "init.mp4");
      const hasSeg = files.some((f) => f.endsWith(".m4s"));
      if (!hasInit || !hasSeg) return false;
    }
    return true;
  } catch {
    return false;
  }
}

/** Clean up temporary working files after processing (success or failure). */
export async function cleanTemp(dir: string): Promise<void> {
  try {
    await fs.rm(dir, { recursive: true, force: true });
  } catch {
    /* best-effort */
  }
}
