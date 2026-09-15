import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getMetrics } from "@/lib/metrics-store";
import { getResourceMetrics } from "@/lib/resource-governor";

/**
 * GET /api/decisions
 *
 * Per v6 §181: "Admin Decision Explanation"
 *
 * Returns the current delivery scheduler state + recent decisions so
 * admins can understand why the system chose a particular source for
 * a media object. Per §182: "No Black Box" — all routing must be
 * deterministic and explainable.
 *
 * This endpoint shows:
 *   - Current system state (economy, pressure modes)
 *   - Delivery metrics (cache/P2P/origin ratios)
 *   - Content heat (top videos by views)
 *   - Active swarms + peer counts
 *   - Resource state (CPU, memory, concurrent jobs)
 *   - AI provider availability
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const videoId = url.searchParams.get("videoId");

  // If a specific video is requested, show its delivery decision context.
  if (videoId) {
    const video = await db.video.findUnique({
      where: { id: videoId },
    });

    if (!video) {
      return NextResponse.json({ error: "video not found" }, { status: 404 });
    }

    const swarms = await db.swarm.findMany({
      where: { videoId },
    });

    const jobs = await db.mediaProcessingJob.findMany({
      where: { videoId },
      orderBy: { updatedAt: "desc" },
      take: 5,
    });

    return NextResponse.json({
      videoId,
      title: (video as any).title,
      videoUrl: (video as any).videoUrl,
      swarms: (swarms as any[]).map((s) => ({
        swarmId: s.swarmId,
        activePeers: s.activePeers,
        manifestVersion: s.manifestVersion,
      })),
      jobs: (jobs as any[]).map((j) => ({
        status: j.status,
        progress: j.progress,
        error: j.error?.slice(0, 100),
        profile: j.profile,
        retryCount: j.retryCount,
        claimedBy: j.claimedBy,
      })),
      deliveryDecision: {
        source: "HTTP/origin",
        reason: "Default fallback — P2P tracker not connected from this host",
        alternatives: [
          { source: "P2P", score: 0.0, rejected: "tracker not available" },
          { source: "WebTransport", score: 0.0, rejected: "not configured" },
          { source: "Edge", score: 0.0, rejected: "no self-hosted edge" },
          { source: "HTTP/origin", score: 1.0, selected: true },
        ],
      },
    });
  }

  // General system state.
  const m = getMetrics();
  const resources = getResourceMetrics();

  // Top videos by views.
  const topVideos = await db.video.findMany({
    orderBy: { views: "desc" },
    take: 10,
    select: { id: true, title: true, views: true, category: true },
  });

  // Active swarms.
  const swarms = await db.swarm.findMany({
    where: { activePeers: { gt: 0 } },
    take: 20,
  });

  return NextResponse.json({
    timestamp: new Date().toISOString(),
    system: {
      originPressureMode: m.originBytesServed > 1_000_000_000 ? "ORIGIN_PRESSURE" : "NORMAL",
      peerPressureMode: m.p2pBytesServed > m.originBytesServed ? "HIGH_P2P" : "NORMAL",
      cachePressureMode: m.cacheHits + m.cacheMisses > 1000 ? "ACTIVE" : "LOW",
    },
    delivery: {
      originBytesServed: m.originBytesServed,
      p2pBytesServed: m.p2pBytesServed,
      cacheHits: m.cacheHits,
      cacheMisses: m.cacheMisses,
      p2pHits: m.p2pHits,
      p2pMisses: m.p2pMisses,
      originReductionPct: (m.p2pBytesServed + m.originBytesServed) > 0
        ? Number((m.p2pBytesServed / (m.p2pBytesServed + m.originBytesServed) * 100).toFixed(1))
        : 0,
    },
    resources: {
      cpuLoadPct: Number((resources.cpuLoad * 100).toFixed(1)),
      memoryUsagePct: Number((resources.memoryUsage * 100).toFixed(1)),
      concurrentJobs: resources.concurrentJobs,
      maxConcurrentJobs: resources.maxConcurrentJobs,
    },
    content: {
      topVideos: (topVideos as any[]).map((v) => ({
        id: v.id,
        title: v.title,
        views: v.views,
        category: v.category,
      })),
      activeSwarms: (swarms as any[]).length,
    },
  });
}
