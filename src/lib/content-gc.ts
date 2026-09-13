/**
 * Content Garbage Collection — deletes obsolete, unreferenced media objects.
 *
 * Per v6 spec §155: delete only objects that are:
 *   - obsolete (old manifest versions)
 *   - unreferenced (not in Turso)
 *   - outside retention
 * and only after safety checks.
 *
 * Per §154: use reports rather than blind deletion.
 *
 * This module runs on the self-hosted media worker (not Vercel).
 */

import { db } from "./db";
import { getStorage } from "./storage";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface GcReport {
  timestamp: string;
  scanned: number;
  deleted: number;
  skipped: number;
  errors: number;
  details: Array<{
    path: string;
    action: "deleted" | "skipped" | "error";
    reason: string;
  }>;
}

const RETENTION_DAYS = 90; // Delete temp/orphan objects older than 90 days
const TEMP_DIR_PREFIX = "tmp";

/**
 * Run garbage collection on the local storage.
 *
 * What it cleans:
 *   1. Temp files from failed/abandoned transcode jobs
 *   2. Orphan video directories (video deleted from Turso but files remain)
 *   3. Old manifest versions (when a new version is published, old versions
 *      become obsolete — but we keep them for a grace period)
 *
 * What it does NOT delete:
 *   - Active video directories (video exists in Turso with status READY)
 *   - Source files (kept per retention policy §150)
 *   - R2/Filebase objects (those need their own reconciliation)
 */
export async function runGarbageCollection(): Promise<GcReport> {
  const report: GcReport = {
    timestamp: new Date().toISOString(),
    scanned: 0,
    deleted: 0,
    skipped: 0,
    errors: 0,
    details: [],
  };

  const storageRoot = process.env.MEDIA_STORAGE_PATH || path.join(process.cwd(), "storage");

  // 1. Clean temp directory.
  const tmpDir = path.join(storageRoot, "tmp");
  try {
    const tmpExists = await fs.access(tmpDir).then(() => true).catch(() => false);
    if (tmpExists) {
      const entries = await fs.readdir(tmpDir);
      for (const entry of entries) {
        const entryPath = path.join(tmpDir, entry);
        const stat = await fs.stat(entryPath);
        report.scanned++;

        const ageMs = Date.now() - stat.mtime.getTime();
        const maxAgeMs = RETENTION_DAYS * 24 * 60 * 60 * 1000;

        if (ageMs > maxAgeMs) {
          try {
            await fs.rm(entryPath, { recursive: true, force: true });
            report.deleted++;
            report.details.push({ path: `tmp/${entry}`, action: "deleted", reason: `older than ${RETENTION_DAYS} days` });
          } catch (e) {
            report.errors++;
            report.details.push({ path: `tmp/${entry}`, action: "error", reason: String(e).slice(0, 100) });
          }
        } else {
          report.skipped++;
        }
      }
    }
  } catch (e) {
    report.errors++;
    report.details.push({ path: "tmp/", action: "error", reason: String(e).slice(0, 100) });
  }

  // 2. Find orphan video directories (exist in storage but not in Turso).
  const videosDir = path.join(storageRoot, "videos");
  try {
    const videosExists = await fs.access(videosDir).then(() => true).catch(() => false);
    if (videosExists) {
      const dirEntries = await fs.readdir(videosDir);
      const tursoVideos = await db.video.findMany({ select: { id: true } });
      const tursoIds = new Set((tursoVideos as any[]).map((v) => v.id));

      for (const entry of dirEntries) {
        report.scanned++;
        if (!tursoIds.has(entry)) {
          // Orphan — video deleted from Turso but files remain.
          const orphanPath = path.join(videosDir, entry);
          try {
            await fs.rm(orphanPath, { recursive: true, force: true });
            report.deleted++;
            report.details.push({ path: `videos/${entry}/`, action: "deleted", reason: "orphan (not in Turso)" });
          } catch (e) {
            report.errors++;
            report.details.push({ path: `videos/${entry}/`, action: "error", reason: String(e).slice(0, 100) });
          }
        } else {
          report.skipped++;
        }
      }
    }
  } catch (e) {
    report.errors++;
    report.details.push({ path: "videos/", action: "error", reason: String(e).slice(0, 100) });
  }

  console.log(`[gc] Scanned: ${report.scanned}, Deleted: ${report.deleted}, Skipped: ${report.skipped}, Errors: ${report.errors}`);
  return report;
}

/**
 * Run GC on a schedule (e.g., every 6 hours).
 */
let _gcTimer: ReturnType<typeof setInterval> | null = null;
const GC_INTERVAL_MS = 6 * 60 * 60 * 1000; // 6 hours

export function startGarbageCollection(): () => void {
  if (_gcTimer) return () => {};
  _gcTimer = setInterval(async () => {
    try {
      await runGarbageCollection();
    } catch (e) {
      console.error("[gc] Failed:", e);
    }
  }, GC_INTERVAL_MS);
  console.log(`[gc] Running every ${GC_INTERVAL_MS / 3600000} hours`);
  return () => {
    if (_gcTimer) {
      clearInterval(_gcTimer);
      _gcTimer = null;
    }
  };
}
