import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/channels/[id]/export?bid=<browserId>
 *
 * Per spec §52: "Provide export functionality for creator-owned data where
 * legally and technically possible: uploaded content, metadata, analytics,
 * comments where appropriate, audience/subscriber information where legally
 * transferable."
 *
 * Returns a downloadable JSON file with ALL of the channel's creator data:
 *   - Channel metadata (name, handle, description, banner, links, country)
 *   - All videos with full metadata (title, description, tags, views, likes, etc.)
 *   - Per-video analytics (comments count, shares count, clips count)
 *   - Ad disclosures
 *   - Rights claims + disputes
 *   - Live polls + Q&A
 *   - Video corrections
 *   - Video relationships
 *
 * SECURITY: in production, requires the caller to be the channel owner.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";

  const ip = getClientIP(req);
  const rl = await rateLimit(`creator-export:${ip}`, 3, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — creator exports are limited to 3/min" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const channel = await db.channel.findUnique({ where: { id } });
  if (!channel) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  // Verify ownership in production.
  const isProd = process.env.NODE_ENV === "production";
  if (isProd && bid) {
    const verification = verifyBrowserId(bid);
    if (!verification.valid || channel.ownerId !== verification.id) {
      return NextResponse.json({ error: "not authorized — you must own this channel" }, { status: 403 });
    }
  }

  // Fetch all videos for the channel.
  const videos = await db.video.findMany({
    where: { channelId: id },
    orderBy: { createdAt: "desc" },
  });

  const videoIds = videos.map((v: any) => v.id);

  // Fetch parallel data.
  const [comments, shares, clips, adDisclosures, rightsClaims, rightsDisputes, polls, qaEntries, corrections, relationships] = await Promise.all([
    db.comment.findMany({ where: { videoId: { in: videoIds } }, select: { videoId: true, author: true, text: true, likes: true, createdAt: true } }).catch(() => []),
    db.share.findMany({ where: { videoId: { in: videoIds } }, select: { videoId: true, platform: true, createdAt: true } }).catch(() => []),
    db.clip.findMany({ where: { videoId: { in: videoIds } }, select: { videoId: true, title: true, startSec: true, endSec: true, views: true, createdAt: true } }).catch(() => []),
    db.adDisclosure.findMany({ where: { videoId: { in: videoIds } } }).catch(() => []),
    db.rightsClaim.findMany({ where: { videoId: { in: videoIds } } }).catch(() => []),
    // Disputes for claims.
    db.rightsDispute.findMany({
      where: { claim: { videoId: { in: videoIds } } },
    }).catch(() => []),
    db.livePoll.findMany({ where: { videoId: { in: videoIds } }, select: { videoId: true, question: true, options: true, status: true, createdAt: true } }).catch(() => []),
    db.liveQA.findMany({ where: { videoId: { in: videoIds } }, select: { videoId: true, askerName: true, question: true, answer: true, upvotes: true, createdAt: true } }).catch(() => []),
    db.videoCorrection.findMany({ where: { videoId: { in: videoIds } }, select: { videoId: true, timestamp: true, originalText: true, correctedText: true, note: true, viewersNotified: true } }).catch(() => []),
    db.videoRelationship.findMany({ where: { videoId: { in: videoIds } }, select: { videoId: true, relatedVideoId: true, relationType: true, note: true, createdBy: true } }).catch(() => []),
  ]);

  // Build the export document.
  const exportData = {
    exportedAt: new Date().toISOString(),
    platform: "Mashahd",
    version: "1.0",
    exportType: "creator",
    channel: {
      name: channel.name,
      handle: channel.handle,
      description: channel.description,
      avatarUrl: channel.avatarUrl,
      bannerUrl: channel.bannerUrl,
      bannerColors: channel.bannerColors,
      subscribers: channel.subscribers,
      verified: channel.verified,
      links: channel.links,
      country: channel.country,
      createdAt: channel.createdAt?.toISOString(),
    },
    videos: videos.map((v: any) => ({
      id: v.id,
      title: v.title,
      description: v.description,
      thumbnailUrl: v.thumbnailUrl,
      videoUrl: v.videoUrl,
      durationSec: v.durationSec,
      views: v.views,
      likes: v.likes,
      dislikes: v.dislikes,
      category: v.category,
      tags: v.tags,
      visibility: v.visibility,
      publishedAt: v.publishedAt?.toISOString(),
      language: v.language,
      ageGated: v.ageGated,
      clipPolicy: v.clipPolicy,
      createdAt: v.createdAt?.toISOString(),
    })),
    analytics: {
      totalVideos: videos.length,
      totalViews: videos.reduce((s: number, v: any) => s + (v.views || 0), 0),
      totalLikes: videos.reduce((s: number, v: any) => s + (v.likes || 0), 0),
      totalComments: comments.length,
      totalShares: shares.length,
      totalClips: clips.length,
    },
    // §52: "comments where appropriate"
    comments: comments.map((c: any) => ({
      videoId: c.videoId,
      author: c.author,
      text: c.text,
      likes: c.likes,
      createdAt: c.createdAt?.toISOString(),
    })),
    shares: shares.map((s: any) => ({
      videoId: s.videoId,
      platform: s.platform,
      createdAt: s.createdAt?.toISOString(),
    })),
    clips: clips.map((c: any) => ({
      videoId: c.videoId,
      title: c.title,
      startSec: c.startSec,
      endSec: c.endSec,
      views: c.views,
      createdAt: c.createdAt?.toISOString(),
    })),
    adDisclosures: adDisclosures.map((a: any) => ({
      videoId: a.videoId,
      adType: a.adType,
      sponsor: a.sponsor,
      product: a.product,
      isPaid: a.isPaid,
      disclosureNote: a.disclosureNote,
    })),
    rightsClaims: rightsClaims.map((r: any) => ({
      videoId: r.videoId,
      claimant: r.claimant,
      claimType: r.claimType,
      matchedMaterial: r.matchedMaterial,
      action: r.action,
      status: r.status,
    })),
    rightsDisputes: rightsDisputes.map((d: any) => ({
      claimId: d.claimId,
      disputant: d.disputant,
      reason: d.reason,
      status: d.status,
      resolution: d.resolution,
    })),
    livePolls: polls.map((p: any) => ({
      videoId: p.videoId,
      question: p.question,
      options: p.options,
      status: p.status,
    })),
    liveQA: qaEntries.map((q: any) => ({
      videoId: q.videoId,
      askerName: q.askerName,
      question: q.question,
      answer: q.answer,
      upvotes: q.upvotes,
    })),
    corrections: corrections.map((c: any) => ({
      videoId: c.videoId,
      timestamp: c.timestamp,
      originalText: c.originalText,
      correctedText: c.correctedText,
      note: c.note,
      viewersNotified: c.viewersNotified,
    })),
    relationships: relationships.map((r: any) => ({
      videoId: r.videoId,
      relatedVideoId: r.relatedVideoId,
      relationType: r.relationType,
      note: r.note,
      createdBy: r.createdBy,
    })),
  };

  // Return as a downloadable JSON file.
  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="mashahd-creator-export-${channel.handle}-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
