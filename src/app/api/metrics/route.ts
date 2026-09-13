import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getCoalesceStats } from "@/lib/request-coalescer";
import { getResourceMetrics } from "@/lib/resource-governor";
import { getAIProviderStatus } from "@/lib/ai-provider";
import { getMetrics } from "@/lib/metrics-store";
import os from "node:os";

/**
 * GET /api/metrics
 *
 * Returns a JSON snapshot of system + application metrics for observability.
 * Per v6 spec §174-180: tracks QoE, P2P, cost, AI, and admin decision metrics.
 */
export async function GET() {
  const memTotal = os.totalmem();
  const memFree = os.freemem();
  const memUsed = memTotal - memFree;
  const cpuLoad = os.loadavg()[0];
  const cpuCount = os.cpus().length;

  const resources = getResourceMetrics();
  const coalesce = getCoalesceStats();
  const aiStatus = getAIProviderStatus();

  // Media job queue depth.
  let queueDepth: Record<string, number> = {};
  let activeJobs = 0;
  let totalVideos = 0;
  let totalSwarms = 0;
  let activeSwarms = 0;
  try {
    for (const status of ["QUEUED", "CLAIMED", "PROCESSING", "READY", "PERMANENT_FAILURE"]) {
      const result = await db.mediaProcessingJob.findMany({
        where: { status },
        select: { id: true },
      });
      queueDepth[status] = (result as any[]).length;
    }
    activeJobs = (queueDepth["CLAIMED"] || 0) + (queueDepth["PROCESSING"] || 0);

    // Content stats.
    const videos = await db.video.findMany({ select: { id: true } });
    totalVideos = (videos as any[]).length;

    const swarms = await db.swarm.findMany({ select: { id: true, activePeers: true } });
    totalSwarms = (swarms as any[]).length;
    activeSwarms = (swarms as any[]).filter((s: any) => s.activePeers > 0).length;
  } catch {
    // DB error — report what we can.
  }

  // QoE averages — from the in-memory metrics store (§79).
  const m = getMetrics();
  const avgStartupTime = m.startupCount > 0
    ? Number((m.totalStartupTime / m.startupCount).toFixed(2))
    : 0;
  const avgRebufferCount = m.rebufferSessions > 0
    ? Number((m.totalRebufferCount / m.rebufferSessions).toFixed(2))
    : 0;

  // Hit ratios.
  const totalCacheLookups = m.cacheHits + m.cacheMisses;
  const cacheHitRatio = totalCacheLookups > 0
    ? Number((m.cacheHits / totalCacheLookups * 100).toFixed(1))
    : 0;

  const totalP2PLookups = m.p2pHits + m.p2pMisses;
  const p2pHitRatio = totalP2PLookups > 0
    ? Number((m.p2pHits / totalP2PLookups * 100).toFixed(1))
    : 0;

  // Origin reduction = P2P bytes / (P2P bytes + origin bytes).
  const totalBytes = m.p2pBytesServed + m.originBytesServed;
  const originReduction = totalBytes > 0
    ? Number((m.p2pBytesServed / totalBytes * 100).toFixed(1))
    : 0;

  // AI stats.
  const aiRequests = m.aiRequests;
  const aiFallbackRate = aiRequests > 0
    ? Number((m.aiFallbacks / aiRequests * 100).toFixed(1))
    : 0;

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    uptime_seconds: Math.floor(process.uptime()),

    // §174: System metrics
    system: {
      cpuLoadAvg1m: Number(cpuLoad.toFixed(3)),
      cpuCount,
      cpuNormalized: Number((cpuLoad / cpuCount).toFixed(3)),
      memoryTotalBytes: memTotal,
      memoryUsedBytes: memUsed,
      memoryUsagePercent: Number(((memUsed / memTotal) * 100).toFixed(1)),
    },

    // §174: Media metrics
    media: {
      queueDepth,
      activeJobs,
      maxConcurrentJobs: resources.maxConcurrentJobs,
      cpuLoadPercent: Number((resources.cpuLoad * 100).toFixed(1)),
      memoryUsagePercent: Number((resources.memoryUsage * 100).toFixed(1)),
      totalVideos,
      totalSwarms,
      activeSwarms,
    },

    // §174: Delivery metrics
    delivery: {
      coalesceInFlight: coalesce.inFlight,
      coalesceSubscribers: coalesce.totalSubscribers,
      originBytesServed: m.originBytesServed,
      p2pBytesServed: m.p2pBytesServed,
      duplicateBytes: m.duplicateBytes,
      cacheHits: m.cacheHits,
      cacheMisses: m.cacheMisses,
      cacheHitRatio,
      p2pHits: m.p2pHits,
      p2pMisses: m.p2pMisses,
      p2pHitRatio,
      originReduction,
    },

    // §175: QoE metrics
    qoe: {
      avgStartupTimeSec: avgStartupTime,
      startupCount: m.startupCount,
      avgRebufferCount,
      rebufferSessions: m.rebufferSessions,
      totalRebufferCount: m.totalRebufferCount,
    },

    // §177: Cost metrics (estimated — per §178, don't count P2P savings as money)
    cost: {
      r2StorageOps: "N/A (track in Cloudflare dashboard)",
      tursoWrites: "N/A (track in Turso dashboard)",
      originBytesServed: m.originBytesServed,
      originReductionPercent: originReduction,
    },

    // §180: AI metrics
    ai: {
      providers: aiStatus,
      activeProviders: Object.values(aiStatus).filter(Boolean).length,
      totalRequests: aiRequests,
      fallbackRate: aiFallbackRate,
    },
  });
}
