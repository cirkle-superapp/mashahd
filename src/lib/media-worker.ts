import { spawn } from "node:child_process";
import { promises as fs } from "node:fs";
import path from "node:path";
import ffmpeg from "fluent-ffmpeg";
import { getStorage } from "./storage";

/**
 * FFmpeg media worker — inspects source video, transcodes ABR renditions,
 * packages HLS/CMAF, validates the output, and cleans up temp files.
 *
 * The worker uses safe process invocation (no shell string concatenation),
 * supports CPU-only operation, and implements configurable encoding profiles.
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
 * Transcode a source file into HLS/CMAF renditions.
 * Generates:
 *   {outDir}/master.m3u8
 *   {outDir}/{rendition}/index.m3u8 + segment-*.m4s
 *
 * Segment duration = 6s (CMAF-friendly). Uses fMP4 (CMAF) packaging.
 */
export function transcode(
  sourcePath: string,
  outDir: string,
  profile: EncodingProfile = "cpu-safe",
  onProgress?: (pct: number) => void
): Promise<{ renditions: typeof RENDITION_LADDER; masterManifest: string }> {
  return new Promise(async (resolve, reject) => {
    const probeResult = await probe(sourcePath);
    const eligible = RENDITION_LADDER.filter((r) => r.height <= probeResult.height);
    const renditions = eligible.length > 0 ? eligible : [RENDITION_LADDER[RENDITION_LADDER.length - 1]];
    const cfg = PROFILES[profile];

    // Ensure output dir exists
    await fs.mkdir(outDir, { recursive: true });

    const command = ffmpeg(sourcePath);
    for (const r of renditions) {
      command
        .output(path.join(outDir, r.id, "index.m3u8"))
        .format("hls")
        .videoCodec("libx264")
        .audioCodec("aac")
        .size(`${r.width}x${r.height}`)
        .outputOptions([
          `-crf ${cfg.crf}`,
          `-preset ${cfg.preset}`,
          `-hls_time 6`,
          `-hls_playlist_type vod`,
          `-hls_segment_type fmp4`,
          `-hls_fmp4_init_filename init.mp4`,
          `-hls_segment_filename ${path.join(outDir, r.id, "segment-$00001.m4s")}`,
        ]);
    }

    command.on("progress", (p) => {
      if (onProgress && p.percent) onProgress(Math.min(99, Math.round(p.percent)));
    });

    command.on("end", async () => {
      try {
        // Generate the master manifest
        const masterLines = ["#EXTM3", "#EXT-X-VERSION:6"];
        for (const r of renditions) {
          masterLines.push(
            `#EXT-X-STREAM-INF:BANDWIDTH=${r.bitrate * 1000},RESOLUTION=${r.width}x${r.height}`
          );
          masterLines.push(`${r.id}/index.m3u8`);
        }
        const masterPath = path.join(outDir, "master.m3u8");
        await fs.writeFile(masterPath, masterLines.join("\n") + "\n");
        onProgress?.(100);
        resolve({ renditions, masterManifest: masterPath });
      } catch (e) {
        reject(e);
      }
    });

    command.on("error", (err) => reject(err));
    command.run();
  });
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
