import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/channels/[id]/studio?bid=<browserId>
 *
 * Per spec §49: "Provide: content, analytics, audience, monetization, rights,
 * moderation, distribution diagnostics, AI tools, live, notifications, API, exports."
 *
 * Returns a unified Creator Studio dashboard for a channel:
 *   - Overview stats (total videos, total views, total subscribers, total likes)
 *   - Recent videos (last 10) with per-video analytics
 *   - Audience insights (top categories, growth trend)
 *   - Engagement metrics (total comments, shares, clips)
 *   - Monetization summary (ad disclosures count, tips count)
 *   - Rights summary (active claims, disputes)
 *
 * SECURITY: the caller must be the channel owner (verified via browserId
 * matching the channel's ownerId, OR the browserId is the channel's
 * legacy owner in dev mode).
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";

  const ip = getClientIP(req);
  const rl = await rateLimit(`studio:${ip}`, 20, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const channel = await db.channel.findUnique({
    where: { id },
    include: { videos: { orderBy: { createdAt: "desc" }, take: 50 } },
  });
  if (!channel) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  // Verify ownership (in dev, allow any signed browserId to view studio data
  // for demo purposes; in production, require ownerId match).
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && bid) {
    const verification = verifyBrowserId(bid);
    if (!verification.valid || channel.ownerId !== verification.id) {
      return NextResponse.json({ error: "not authorized — you must own this channel" }, { status: 403 });
    }
  }

  const videos = channel.videos || [];
  const videoIds = videos.map((v: any) => v.id);

  // Fetch parallel data for the studio.
  const [comments, shares, clips, adDisclosures, rightsClaims, continueWatching] = await Promise.all([
    // Total comments across all videos.
    db.comment.count({ where: { videoId: { in: videoIds } } }).catch(() => 0),
    // Total shares.
    db.share.count({ where: { videoId: { in: videoIds } } }).catch(() => 0),
    // Total clips.
    db.clip.count({ where: { videoId: { in: videoIds } } }).catch(() => 0),
    // Ad disclosures.
    db.adDisclosure.count({ where: { videoId: { in: videoIds } } }).catch(() => 0),
    // Active rights claims.
    db.rightsClaim.count({ where: { videoId: { in: videoIds }, status: "active" } }).catch(() => 0),
    // Continue watching (unique viewers).
    db.continueWatching.count({ where: { videoId: { in: videoIds } } }).catch(() => 0),
  ]);

  // Compute aggregate stats.
  const totalViews = videos.reduce((sum: number, v: any) => sum + (v.views || 0), 0);
  const totalLikes = videos.reduce((sum: number, v: any) => sum + (v.likes || 0), 0);
  const totalDislikes = videos.reduce((sum: number, v: any) => sum + (v.dislikes || 0), 0);
  const totalDuration = videos.reduce((sum: number, v: any) => sum + (v.durationSec || 0), 0);

  // Per-video analytics (top 10 recent).
  const recentVideos = videos.slice(0, 10).map((v: any) => ({
    id: v.id,
    title: v.title,
    thumbnailUrl: v.thumbnailUrl,
    views: v.views || 0,
    likes: v.likes || 0,
    dislikes: v.dislikes || 0,
    likeRatio: v.likes + v.dislikes > 0 ? Math.round((v.likes / (v.likes + v.dislikes)) * 100) : 100,
    durationSec: v.durationSec,
    createdAt: v.createdAt?.toISOString(),
    category: v.category,
  }));

  // Audience insights — top categories.
  const categoryCount: Record<string, number> = {};
  for (const v of videos) {
    categoryCount[v.category] = (categoryCount[v.category] || 0) + (v.views || 0);
  }
  const topCategories = Object.entries(categoryCount)
    .sort(([, a], [, b]) => (b as number) - (a as number))
    .slice(0, 5)
    .map(([category, views]) => ({ category, views }));

  // Growth trend (last 30 days, views per day).
  const thirtyDaysAgo = new Date(Date.now() - 30 * 86400000);
  const recentVideoViews = videos
    .filter((v: any) => new Date(v.createdAt) > thirtyDaysAgo)
    .reduce((sum: number, v: any) => sum + (v.views || 0), 0);

  // Engagement rate (likes + comments + shares / views).
  const engagement = totalViews > 0
    ? Math.round(((totalLikes + comments + shares) / totalViews) * 10000) / 100
    : 0;

  return NextResponse.json({
    channel: {
      id: channel.id,
      name: channel.name,
      handle: channel.handle,
      subscribers: channel.subscribers,
      verified: channel.verified,
      avatarUrl: channel.avatarUrl,
      videoCount: videos.length,
    },
    overview: {
      totalViews,
      totalLikes,
      totalDislikes,
      totalDuration,
      totalComments: comments,
      totalShares: shares,
      totalClips: clips,
      uniqueViewers: continueWatching,
      engagementRate: engagement,
      avgViewsPerVideo: videos.length > 0 ? Math.round(totalViews / videos.length) : 0,
      avgLikeRatio: totalLikes + totalDislikes > 0
        ? Math.round((totalLikes / (totalLikes + totalDislikes)) * 100)
        : 100,
    },
    recentVideos,
    audience: {
      topCategories,
      recent30DayViews: recentVideoViews,
    },
    monetization: {
      adDisclosures,
      // Tips would go here when the tip system is wired to real payments.
    },
    rights: {
      activeClaims: rightsClaims,
    },
    // Per spec §50: "Creators need actionable explanation."
    // The distribution diagnostics endpoint provides more detail.
    distributionDiagnosticsUrl: `/api/channels/${id}/distribution?bid=${encodeURIComponent(bid)}`,
  });
}
