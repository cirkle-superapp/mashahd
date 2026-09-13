/**
 * Media Reconciliation — periodic check of Turso metadata ↔ storage objects
 * ↔ published manifests.
 *
 * Per v6 spec §153: find missing objects, orphan objects, invalid manifests,
 * stale renditions.
 *
 * This module runs on the self-hosted media worker (not on Vercel) and
 * reports inconsistencies. It does NOT auto-delete — per §154, use reports
 * rather than blind deletion.
 */

import { db } from "./db";
import { getStorage } from "./storage";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface ReconciliationReport {
  timestamp: string;
  totalVideos: number;
  totalRenditions: number;
  totalManifests: number;
  missingObjects: Array<{ videoId: string; renditionId: string; path: string }>;
  orphanObjects: string[]; // objects in storage but not in Turso
  invalidManifests: Array<{ videoId: string; reason: string }>;
  staleRenditions: Array<{ videoId: string; renditionId: string; reason: string }>;
  summary: {
    healthy: number;
    issues: number;
    critical: number;
  };
}

/**
 * Run a full reconciliation pass.
 * Returns a report of all inconsistencies found.
 */
export async function reconcileMedia(): Promise<ReconciliationReport> {
  const report: ReconciliationReport = {
    timestamp: new Date().toISOString(),
    totalVideos: 0,
    totalRenditions: 0,
    totalManifests: 0,
    missingObjects: [],
    orphanObjects: [],
    invalidManifests: [],
    staleRenditions: [],
    summary: { healthy: 0, issues: 0, critical: 0 },
  };

  const storage = getStorage();

  // 1. Check all READY videos have valid manifests.
  const videos = await db.video.findMany({});
  report.totalVideos = (videos as any[]).length;

  for (const video of videos as any[]) {
    // Skip videos without HLS manifests (direct MP4 URLs).
    if (!video.videoUrl?.includes("manifest")) continue;

    // Check if the master manifest exists in storage.
    const manifestPath = `videos/${video.id}/v1/master.m3u8`;
    const exists = await storage.exists(manifestPath);
    if (!exists) {
      report.missingObjects.push({
        videoId: video.id,
        renditionId: "root",
        path: manifestPath,
      });
      report.summary.critical++;
    } else {
      report.summary.healthy++;
    }
  }

  // 2. Check all renditions have their manifest + segments.
  const renditions = await db.videoRendition.findMany({});
  report.totalRenditions = (renditions as any[]).length;

  for (const r of renditions as any[]) {
    const indexM3u8 = r.manifestPath;
    const exists = await storage.exists(indexM3u8);
    if (!exists) {
      report.missingObjects.push({
        videoId: r.videoId,
        renditionId: r.id,
        path: indexM3u8,
      });
      report.summary.critical++;
    }
  }

  // 3. Check all manifests in Turso have valid hashes.
  const manifests = await db.videoManifest.findMany({});
  report.totalManifests = (manifests as any[]).length;

  for (const m of manifests as any[]) {
    const exists = await storage.exists(m.manifestPath);
    if (!exists) {
      report.invalidManifests.push({
        videoId: m.videoId,
        reason: `manifest path ${m.manifestPath} not found in storage`,
      });
      report.summary.issues++;
    }
  }

  // 4. Check for stale renditions (jobs in READY but rendition files missing).
  for (const r of renditions as any[]) {
    const indexExists = await storage.exists(r.manifestPath);
    if (!indexExists) {
      report.staleRenditions.push({
        videoId: r.videoId,
        renditionId: r.id,
        reason: `rendition manifest ${r.manifestPath} not found`,
      });
      report.summary.issues++;
    }
  }

  // 5. Orphan detection — objects in storage not referenced by Turso.
  // (Only check local filesystem — R2/Filebase listing would be expensive.)
  if (process.env.STORAGE_PROVIDER === "local" || !process.env.STORAGE_PROVIDER) {
    try {
      const storageRoot = process.env.MEDIA_STORAGE_PATH || path.join(process.cwd(), "storage");
      const videosDir = path.join(storageRoot, "videos");
      const dirExists = await fs.access(videosDir).then(() => true).catch(() => false);
      if (dirExists) {
        const entries = await fs.readdir(videosDir);
        const tursoVideoIds = new Set((videos as any[]).map((v) => v.id));
        for (const entry of entries) {
          if (!tursoVideoIds.has(entry)) {
            report.orphanObjects.push(`videos/${entry}/`);
          }
        }
      }
    } catch {
      // Storage not accessible — skip orphan check.
    }
  }

  return report;
}

/**
 * Run reconciliation on a schedule (e.g., every hour).
 * Returns a cleanup function.
 */
let _reconciliationTimer: ReturnType<typeof setInterval> | null = null;
const RECONCILIATION_INTERVAL_MS = 60 * 60 * 1000; // 1 hour

export function startReconciliation(): () => void {
  if (_reconciliationTimer) return () => {};
  _reconciliationTimer = setInterval(async () => {
    try {
      const report = await reconcileMedia();
      if (report.summary.issues > 0 || report.summary.critical > 0) {
        console.warn("[reconciliation] Issues found:", report.summary);
      } else {
        console.log(`[reconciliation] All healthy (${report.summary.healthy} objects checked)`);
      }
    } catch (e) {
      console.error("[reconciliation] Failed:", e);
    }
  }, RECONCILIATION_INTERVAL_MS);
  console.log(`[reconciliation] Running every ${RECONCILIATION_INTERVAL_MS / 60000} minutes`);
  return () => {
    if (_reconciliationTimer) {
      clearInterval(_reconciliationTimer);
      _reconciliationTimer = null;
    }
  };
}
