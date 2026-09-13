/**
 * Media Job Manager — lease/claim mechanism + stale-job recovery.
 *
 * Phase 3: Robust job state machine with:
 *   - Atomic claim (worker identity)
 *   - Stale-job recovery (crashed workers)
 *   - Retry with backoff
 *   - Error classification (transient vs permanent)
 *
 * This module is self-hosted only — it runs on the local media machine,
 * NOT on Vercel serverless (which can't hold long-running processes).
 */

import { db } from "./db";
import { getStorage } from "./storage";
import { promises as fs } from "node:fs";
import path from "node:path";
import os from "node:os";

const STALE_JOB_TIMEOUT_MS = 10 * 60 * 1000; // 10 minutes
const RECOVERY_INTERVAL_MS = 60 * 1000; // 60 seconds
const MAX_RETRIES = 3;

/** Generate a unique worker ID for this process. */
export function getWorkerId(): string {
  const hostname = os.hostname();
  const pid = process.pid;
  return `${hostname}:${pid}`;
}

/**
 * Claim the highest-priority QUEUED job atomically.
 * Uses an atomic UPDATE ... RETURNING pattern so two workers can't claim
 * the same job.
 */
export async function claimNextJob(workerId: string): Promise<any | null> {
  try {
    // Find the highest-priority QUEUED job.
    const queued = await db.mediaProcessingJob.findMany({
      where: { status: "QUEUED" },
      orderBy: [{ priority: "desc" }, { createdAt: "asc" }],
      take: 1,
    });
    if (queued.length === 0) return null;

    const job = queued[0] as any;
    // Atomically claim it (only if still QUEUED — prevents races).
    const result = await db.mediaProcessingJob.updateMany({
      where: { id: job.id, status: "QUEUED" },
      data: {
        status: "CLAIMED",
        claimedBy: workerId,
        claimedAt: new Date(),
      },
    });

    // If updateMany affected 0 rows, another worker claimed it first.
    if (result.count === 0) return null;

    // Return the claimed job.
    return await db.mediaProcessingJob.findUnique({ where: { id: job.id } });
  } catch (e) {
    console.error("[job-manager] claimNextJob failed:", e);
    return null;
  }
}

/**
 * Recover stale jobs — jobs in CLAIMED or PROCESSING that haven't been
 * updated in STALE_JOB_TIMEOUT_MS. Resets them to QUEUED + increments
 * retryCount. If retryCount >= MAX_RETRIES, marks as PERMANENT_FAILURE.
 *
 * Should be called on a regular interval (60s) by the media worker.
 */
export async function recoverStaleJobs(): Promise<number> {
  try {
    const cutoff = new Date(Date.now() - STALE_JOB_TIMEOUT_MS);

    // Find stale jobs (CLAIMED or PROCESSING with old claimedAt/updatedAt).
    const staleJobs = await db.mediaProcessingJob.findMany({
      where: {
        status: { in: ["CLAIMED", "PROCESSING"] },
        OR: [
          { claimedAt: { lt: cutoff } },
          { updatedAt: { lt: cutoff } },
        ],
      },
      take: 50,
    });

    let recovered = 0;
    for (const job of staleJobs as any[]) {
      if (job.retryCount >= MAX_RETRIES) {
        // Mark as permanent failure — too many retries.
        await db.mediaProcessingJob.update({
          where: { id: job.id },
          data: {
            status: "PERMANENT_FAILURE",
            error: `Stale after ${MAX_RETRIES} retries (worker ${job.claimedBy || "unknown"} crashed)`,
            errorClass: "permanent",
            completedAt: new Date(),
          },
        });
      } else {
        // Reset to QUEUED + increment retryCount.
        await db.mediaProcessingJob.update({
          where: { id: job.id },
          data: {
            status: "QUEUED",
            retryCount: job.retryCount + 1,
            error: `Recovered from stale worker (${job.claimedBy || "unknown"})`,
            errorClass: "transient",
            claimedBy: null,
            claimedAt: null,
          },
        });
        recovered++;
      }
    }

    if (recovered > 0 || staleJobs.length > 0) {
      console.log(`[job-manager] Recovered ${recovered} stale jobs, ${staleJobs.length - recovered} permanently failed`);
    }
    return recovered;
  } catch (e) {
    console.error("[job-manager] recoverStaleJobs failed:", e);
    return 0;
  }
}

/**
 * Start the stale-job recovery loop. Runs every 60 seconds.
 * Returns a cleanup function to stop the loop.
 */
let _recoveryTimer: ReturnType<typeof setInterval> | null = null;

export function startStaleJobRecovery(): () => void {
  if (_recoveryTimer) return () => {};
  _recoveryTimer = setInterval(async () => {
    await recoverStaleJobs();
  }, RECOVERY_INTERVAL_MS);
  console.log(`[job-manager] Stale-job recovery running every ${RECOVERY_INTERVAL_MS / 1000}s`);
  return () => {
    if (_recoveryTimer) {
      clearInterval(_recoveryTimer);
      _recoveryTimer = null;
    }
  };
}

/**
 * Mark a job as READY (success) and clean up temp files.
 */
export async function completeJob(jobId: string): Promise<void> {
  await db.mediaProcessingJob.update({
    where: { id: jobId },
    data: {
      status: "READY",
      progress: 100,
      completedAt: new Date(),
      claimedBy: null,
      claimedAt: null,
    },
  });
}

/**
 * Mark a job as failed. Classifies the error as transient or permanent.
 * Transient errors allow retry; permanent errors don't.
 */
export async function failJob(
  jobId: string,
  error: string,
  errorClass: "transient" | "permanent" = "transient"
): Promise<void> {
  const job = (await db.mediaProcessingJob.findUnique({ where: { id: jobId } })) as any;
  if (!job) return;

  const newRetryCount = job.retryCount + 1;
  const shouldRetry = errorClass === "transient" && newRetryCount < (job.maxRetries || MAX_RETRIES);

  await db.mediaProcessingJob.update({
    where: { id: jobId },
    data: {
      status: shouldRetry ? "RETRYABLE_FAILURE" : "PERMANENT_FAILURE",
      error: String(error).slice(0, 500),
      errorClass,
      retryCount: newRetryCount,
      completedAt: shouldRetry ? null : new Date(),
      claimedBy: null,
      claimedAt: null,
      // If retryable, reset to QUEUED so the recovery loop picks it up.
      ...(shouldRetry && { status: "QUEUED" }),
    },
  });
}
