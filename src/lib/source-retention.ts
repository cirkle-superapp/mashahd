/**
 * Source Retention Policy — decides when to delete uploaded source files.
 *
 * Per v6 spec §150: "Delete uploaded source only when policy allows and
 * published outputs are verified."
 *
 * Policy:
 *   - Keep source files for RETENTION_DAYS after upload (default 30 days)
 *   - After retention period, delete IF published outputs are verified READY
 *   - Never delete source if any rendition job is still PROCESSING/QUEUED
 *   - Never delete source if the video has no published manifest (safety check)
 */

import { db } from "./db";
import { getStorage } from "./storage";
import { promises as fs } from "node:fs";
import path from "node:path";

const DEFAULT_RETENTION_DAYS = 30;

export interface RetentionDecision {
  videoId: string;
  action: "KEEP" | "DELETE";
  reason: string;
}

/**
 * Check if a video's source file can be safely deleted.
 */
export async function checkSourceRetention(
  videoId: string,
  retentionDays: number = DEFAULT_RETENTION_DAYS
): Promise<RetentionDecision> {
  try {
    // 1. Check if the video has published renditions (safety: must have READY output).
    const jobs = await db.mediaProcessingJob.findMany({
      where: { videoId },
    });
    const hasReadyJob = (jobs as any[]).some((j) => j.status === "READY");
    const hasActiveJob = (jobs as any[]).some((j) =>
      ["QUEUED", "CLAIMED", "PROCESSING", "PACKAGING", "VALIDATING"].includes(j.status)
    );

    if (hasActiveJob) {
      return { videoId, action: "KEEP", reason: "active processing job in progress" };
    }

    if (!hasReadyJob) {
      return { videoId, action: "KEEP", reason: "no verified READY output — source is the only copy" };
    }

    // 2. Check if the video has a published manifest.
    const manifests = await db.videoManifest.findMany({ where: { videoId } });
    if ((manifests as any[]).length === 0) {
      return { videoId, action: "KEEP", reason: "no published manifest — source needed for re-processing" };
    }

    // 3. Check age of the source file.
    const sources = await db.videoSource.findMany({ where: { videoId } });
    if ((sources as any[]).length === 0) {
      return { videoId, action: "KEEP", reason: "no source record found" };
    }

    const source = (sources as any[])[0];
    const video = await db.video.findUnique({ where: { id: videoId } });
    if (!video) {
      return { videoId, action: "DELETE", reason: "video record deleted — source is orphan" };
    }

    const ageMs = Date.now() - new Date(video.createdAt).getTime();
    const retentionMs = retentionDays * 24 * 60 * 60 * 1000;

    if (ageMs < retentionMs) {
      return { videoId, action: "KEEP", reason: `source age ${Math.floor(ageMs / 86400000)}d < retention ${retentionDays}d` };
    }

    // 4. All checks passed — source can be deleted.
    return {
      videoId,
      action: "DELETE",
      reason: `source age ${Math.floor(ageMs / 86400000)}d >= retention ${retentionDays}d, READY output verified`,
    };
  } catch (e) {
    return { videoId, action: "KEEP", reason: `error checking retention: ${String(e).slice(0, 100)}` };
  }
}

/**
 * Delete a video's source file from storage.
 * Per §150: only call after checkSourceRetention returns DELETE.
 */
export async function deleteSourceFile(videoId: string): Promise<boolean> {
  try {
    const sources = await db.videoSource.findMany({ where: { videoId } });
    const storage = getStorage();

    for (const source of sources as any[]) {
      if (source.storagePath) {
        await storage.delete(source.storagePath);
        console.log(`[retention] Deleted source: ${source.storagePath}`);
      }
    }

    // Mark the source as deleted in the DB (keep the record for audit).
    await db.videoSource.updateMany({
      where: { videoId },
      data: { storagePath: `deleted:${new Date().toISOString()}` },
    });

    return true;
  } catch (e) {
    console.error(`[retention] Failed to delete source for ${videoId}:`, e);
    return false;
  }
}

/**
 * Run source retention check for all videos.
 * Returns a report of what was deleted vs kept.
 */
export async function runSourceRetention(
  retentionDays: number = DEFAULT_RETENTION_DAYS
): Promise<{ checked: number; deleted: number; kept: number }> {
  const videos = await db.video.findMany({ select: { id: true } });
  let checked = 0, deleted = 0, kept = 0;

  for (const v of videos as any[]) {
    const decision = await checkSourceRetention(v.id, retentionDays);
    checked++;
    if (decision.action === "DELETE") {
      const ok = await deleteSourceFile(v.id);
      if (ok) deleted++;
      else kept++;
    } else {
      kept++;
    }
  }

  console.log(`[retention] Checked: ${checked}, Deleted: ${deleted}, Kept: ${kept}`);
  return { checked, deleted, kept };
}
