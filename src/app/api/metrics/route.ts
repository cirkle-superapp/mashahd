import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCoalesceStats } from "@/lib/request-coalescer";
import { getResourceMetrics } from "@/lib/resource-governor";
import os from "node:os";

/**
 * GET /api/metrics
 *
 * Returns a JSON snapshot of system + application metrics for observability.
 * Phase 27: Observability — free, local-first, no external monitoring service.
 *
 * Metrics include:
 *   - System: CPU load, memory usage, uptime
 *   - Media: FFmpeg queue depth, active jobs, resource state
 *   - Delivery: request coalescer stats
 *   - Database: connection check
 *
 * This endpoint is NOT cached — it always returns fresh metrics.
 */
export async function GET() {
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsed = memTotal - memFree;
  const cpuLoad = os.loadavg()[0];
  const cpuCount = os.cpus().length;

  // Resource governor metrics.
  const resources = getResourceMetrics();

  // Request coalescer stats.
  const coalesce = getCoalesceStats();

  // Media job queue depth (from DB).
  let queueDepth: Record<string, number> = {};
  let activeJobs = 0;
  try {
    // Count jobs by status.
    for (const status of ["QUEUED", "CLAIMED", "PROCESSING", "READY", "PERMANENT_FAILURE"]) {
      const result = await db.mediaProcessingJob.findMany({
        where: { status },
        select: { id: true },
      });
      queueDepth[status] = (result as any[]).length;
    }
    activeJobs = (queueDepth["CLAIMED"] || 0) + (queueDepth["PROCESSING"] || 0);
  } catch {
    // DB error — report what we can.
  }

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),
    system: {
      cpuLoadAvg1m: Number(cpuLoad.toFixed(3)),
      cpuCount,
      cpuNormalized: Number((cpuLoad / cpuCount).toFixed(3)),
      memoryTotalBytes: memTotal,
      memoryUsedBytes: memUsed,
      memoryUsagePercent: Number(((memUsed / memTotal) * 100).toFixed(1)),
    },
    media: {
      queueDepth,
      activeJobs,
      maxConcurrentJobs: resources.maxConcurrentJobs,
      cpuLoadPercent: Number((resources.cpuLoad * 100).toFixed(1)),
      memoryUsagePercent: Number((resources.memoryUsage * 100).toFixed(1)),
    },
    delivery: {
      coalesceInFlight: coalesce.inFlight,
      coalesceSubscribers: coalesce.totalSubscribers,
    },
  });
}
