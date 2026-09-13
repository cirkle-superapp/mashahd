/**
 * Resource Governor — prevents media workloads from starving the control
 * plane (Next.js API). Monitors CPU, memory, disk, and concurrent FFmpeg
 * jobs. When resources are exhausted, new transcode jobs are left in QUEUED
 * until resources free up.
 *
 * Phase 28: Resource Safety
 *
 * Zero-cost: uses only Node.js built-in os module + fs.stat. No external
 * monitoring service required.
 */

import os from "node:os";
import { promises as fs } from "node:fs";
import path from "node:path";

export interface ResourceState {
  cpuLoad: number; // 0-1 (1 = 100% of all cores)
  memoryUsage: number; // 0-1
  diskUsage: number; // 0-1 (of the storage volume)
  concurrentJobs: number;
  canStartJob: boolean;
  reasons: string[];
}

const MAX_CONCURRENT_JOBS = Number(process.env.MAX_FFMPEG_JOBS) || 2;
const MAX_CPU_LOAD = Number(process.env.MAX_CPU_LOAD) || 0.85;
const MAX_MEMORY_USAGE = Number(process.env.MAX_MEMORY_USAGE) || 0.90;
const MAX_DISK_USAGE = Number(process.env.MAX_DISK_USAGE) || 0.95;

let _activeJobs = 0;

/** Increment the active job counter (called when a transcode starts). */
export function jobStarted(): void {
  _activeJobs++;
}

/** Decrement the active job counter (called when a transcode ends). */
export function jobEnded(): void {
  if (_activeJobs > 0) _activeJobs--;
}

/**
 * Get the current CPU load average (1-minute average, normalized to 0-1).
 * On a 4-core machine, loadavg=4 → cpuLoad=1.0 (100%).
 */
export function getCpuLoad(): number {
  const loadAvg = os.loadavg()[0]; // 1-minute average
  const cpuCount = os.cpus().length;
  return Math.min(1, loadAvg / cpuCount);
}

/**
 * Get memory usage as a fraction (0-1).
 */
export function getMemoryUsage(): number {
  const total = os.totalmem();
  const free = os.freemem();
  return 1 - free / total;
}

/**
 * Get disk usage of the storage volume as a fraction (0-1).
 * Uses fs.statvfs if available, otherwise falls back to checking the
 * storage directory's free space.
 */
export async function getDiskUsage(): Promise<number> {
  try {
    const storagePath = process.env.MEDIA_STORAGE_PATH || path.join(process.cwd(), "storage");
    // Ensure the directory exists.
    await fs.mkdir(storagePath, { recursive: true });
    // Use df-style check via statvfs (Node.js 20+ has fs.statfs).
    const statfs = (fs as any).statfs;
    if (statfs) {
      const stats = await statfs(storagePath);
      const total = stats.blocks * stats.bsize;
      const free = stats.bfree * stats.bsize;
      if (total > 0) return 1 - free / total;
    }
    // Fallback: can't measure, assume 0 (healthy).
    return 0;
  } catch {
    return 0;
  }
}

/**
 * Check if a new media job can be started without starving the control plane.
 * Returns the resource state + reasons if blocked.
 */
export async function canStartJob(): Promise<ResourceState> {
  const cpuLoad = getCpuLoad();
  const memoryUsage = getMemoryUsage();
  const diskUsage = await getDiskUsage();
  const concurrentJobs = _activeJobs;

  const reasons: string[] = [];
  if (concurrentJobs >= MAX_CONCURRENT_JOBS) {
    reasons.push(`max concurrent jobs reached (${concurrentJobs}/${MAX_CONCURRENT_JOBS})`);
  }
  if (cpuLoad >= MAX_CPU_LOAD) {
    reasons.push(`CPU load too high (${(cpuLoad * 100).toFixed(0)}% >= ${MAX_CPU_LOAD * 100}%)`);
  }
  if (memoryUsage >= MAX_MEMORY_USAGE) {
    reasons.push(`memory usage too high (${(memoryUsage * 100).toFixed(0)}% >= ${MAX_MEMORY_USAGE * 100}%)`);
  }
  if (diskUsage >= MAX_DISK_USAGE) {
    reasons.push(`disk usage too high (${(diskUsage * 100).toFixed(0)}% >= ${MAX_DISK_USAGE * 100}%)`);
  }

  return {
    cpuLoad,
    memoryUsage,
    diskUsage,
    concurrentJobs,
    canStartJob: reasons.length === 0,
    reasons,
  };
}

/**
 * Get a metrics snapshot for the /metrics endpoint.
 */
export function getResourceMetrics(): {
  cpuLoad: number;
  memoryUsage: number;
  concurrentJobs: number;
  maxConcurrentJobs: number;
} {
  return {
    cpuLoad: getCpuLoad(),
    memoryUsage: getMemoryUsage(),
    concurrentJobs: _activeJobs,
    maxConcurrentJobs: MAX_CONCURRENT_JOBS,
  };
}
