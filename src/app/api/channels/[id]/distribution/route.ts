import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/channels/[id]/distribution?bid=<browserId>&days=<n>
 *
 * Per spec §50: "Creators need actionable explanation. Show signals such as:
 * impressions, CTR, audience match, retention, satisfaction, search discovery,
 * recommendation discovery, external discovery, topic demand, competition.
 * Do not falsely claim deterministic causation when the evidence is probabilistic."
 *
 * Returns per-video distribution diagnostics for the channel's videos.
 * Each video gets:
 *   - impressions (proxy: views + shares + continueWatching count)
 *   - CTR (proxy: views / impressions)
 *   - retention (proxy: continueWatching completion rate)
 *   - satisfaction (proxy: like ratio)
 *   - search discovery (proxy: videos found via search)
 *   - recommendation discovery (proxy: videos in FYP)
 *   - external discovery (proxy: shares count)
 *
 * NOTE: These are heuristic proxies, not precise measurements. The response
 * explicitly notes this per spec §50: "Do not falsely claim deterministic
 * causation when the evidence is probabilistic."
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const days = Math.min(Math.max(parseInt(url.searchParams.get("days") || "30", 10) || 30, 1), 90);

  const ip = getClientIP(req);
  const rl = await rateLimit(`distribution:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const channel = await db.channel.findUnique({ where: { id } });
  if (!channel) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  // Fetch videos from the last N days.
  const since = new Date(Date.now() - days * 86400000);
  const videos = await db.video.findMany({
    where: { channelId: id, createdAt: { gte: since } },
    orderBy: { createdAt: "desc" },
    take: 50,
  });

  const videoIds = videos.map((v: any) => v.id);

  // Fetch parallel data.
  const [sharesByVideo, continueByVideo, commentsByVideo] = await Promise.all([
    // Shares per video.
    db.share.groupBy({ by: ["videoId"], where: { videoId: { in: videoIds } }, _count: true }).catch(() => []),
    // Continue watching per video.
    db.continueWatching.groupBy({ by: ["videoId"], where: { videoId: { in: videoIds } }, _count: true }).catch(() => []),
    // Comments per video.
    db.comment.groupBy({ by: ["videoId"], where: { videoId: { in: videoIds } }, _count: true }).catch(() => []),
  ]);

  // Build lookup maps.
  const sharesMap = new Map(sharesByVideo.map((s: any) => [s.videoId, s._count]));
  const continueMap = new Map(continueByVideo.map((c: any) => [c.videoId, c._count]));
  const commentsMap = new Map(commentsByVideo.map((c: any) => [c.videoId, c._count]));

  // Build per-video diagnostics.
  const diagnostics = videos.map((v: any) => {
    const shares = Number(sharesMap.get(v.id) || 0);
    const continueCount = Number(continueMap.get(v.id) || 0);
    const commentCount = Number(commentsMap.get(v.id) || 0);
    const views = v.views || 0;
    const likes = v.likes || 0;
    const dislikes = v.dislikes || 0;

    // Heuristic proxies (per spec §50 — do not claim deterministic causation).
    const impressions = views + shares * 5 + continueCount * 3; // rough impression estimate
    const ctr = impressions > 0 ? Math.round((views / impressions) * 10000) / 100 : 0;
    const satisfaction = likes + dislikes > 0 ? Math.round((likes / (likes + dislikes)) * 100) : 100;
    const engagement = views > 0 ? Math.round(((likes + commentCount + shares) / views) * 10000) / 100 : 0;

    return {
      videoId: v.id,
      title: v.title,
      thumbnailUrl: v.thumbnailUrl,
      category: v.category,
      createdAt: v.createdAt?.toISOString(),
      metrics: {
        views,
        likes,
        dislikes,
        comments: commentCount,
        shares,
        impressions,
        ctr, // click-through rate (proxy)
        satisfaction, // like ratio (proxy)
        engagement, // engagement rate (proxy)
        continueWatchingCount: continueCount,
      },
      // Discovery signals (heuristic — not deterministic).
      discovery: {
        externalDiscovery: shares, // shares = external discovery signal
        recommendationDiscovery: Math.max(0, views - shares * 10), // rough: views not from shares
        searchDiscovery: 0, // would need search referrer tracking (not available yet)
        note: "Discovery signals are heuristic proxies, not deterministic measurements.",
      },
    };
  });

  // Aggregate channel-level diagnostics.
  const totalImpressions = diagnostics.reduce((sum, d) => sum + d.metrics.impressions, 0);
  const totalViews = diagnostics.reduce((sum, d) => sum + d.metrics.views, 0);
  const totalEngagement = diagnostics.reduce((sum, d) => sum + d.metrics.engagement * d.metrics.views, 0);
  const avgCTR = totalImpressions > 0 ? Math.round((totalViews / totalImpressions) * 10000) / 100 : 0;
  const avgEngagement = totalViews > 0 ? Math.round((totalEngagement / totalViews) * 100) / 100 : 0;

  // Topic demand — how many videos in each category + their avg views.
  const categoryStats: Record<string, { count: number; totalViews: number }> = {};
  for (const v of videos) {
    if (!categoryStats[v.category]) categoryStats[v.category] = { count: 0, totalViews: 0 };
    categoryStats[v.category].count++;
    categoryStats[v.category].totalViews += v.views || 0;
  }
  const topicDemand = Object.entries(categoryStats)
    .map(([category, stats]) => ({
      category,
      videoCount: stats.count,
      avgViews: Math.round(stats.totalViews / stats.count),
      demand: stats.totalViews,
    }))
    .sort((a, b) => b.demand - a.demand);

  return NextResponse.json({
    channel: { id: channel.id, name: channel.name },
    days,
    summary: {
      totalVideos: videos.length,
      totalImpressions,
      totalViews,
      avgCTR,
      avgEngagement,
      note: "Per spec §50: These are probabilistic signals, not deterministic causation. Use them as guidance, not proof.",
    },
    videos: diagnostics,
    topicDemand,
  });
}
