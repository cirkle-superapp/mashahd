import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/videos/[id]/context
 *
 * Per spec §65: "For factual/current content where appropriate, provide:
 * publication date, update date, creator-provided sources, corrections, provenance.
 * Do not present AI classification as a substitute for evidence."
 *
 * Returns the informational context around a video:
 *   - Publication date (video.createdAt)
 *   - Update date (video.updatedAt or publishedAt)
 *   - Creator-declared sources (from video description or provenance)
 *   - Active corrections (from VideoCorrection table)
 *   - Content provenance (from ContentProvenance table — human/AI-assisted/AI-generated)
 *   - Related sources (from VideoRelationship where type="source")
 *   - Rights claims (active claims that affect the video's context)
 *
 * This gives viewers the full context they need to evaluate the video's
 * credibility and currency.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`context:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  // Fetch parallel data.
  const [corrections, provenance, sourceRelationships, rightsClaims] = await Promise.all([
    // Active corrections.
    db.videoCorrection.findMany({
      where: { videoId: id },
      orderBy: { timestamp: "asc" },
    }).catch(() => []),
    // Content provenance.
    (db as any).contentProvenance.findUnique({ where: { videoId: id } }).catch(() => null),
    // Source relationships (videos that are sources for this video).
    db.videoRelationship.findMany({
      where: { videoId: id, relationType: "source" },
    }).catch(() => []),
    // Active rights claims.
    db.rightsClaim.findMany({
      where: { videoId: id, status: "active" },
      select: { claimant: true, claimType: true, matchedMaterial: true, action: true },
    }).catch(() => []),
  ]);

  // Parse creator-declared sources from the description (heuristic — look for URLs).
  const sourceUrls = (video.description.match(/https?:\/\/[^\s)]+/g) || []).slice(0, 10);

  // Fetch the related source videos.
  const sourceVideoIds = sourceRelationships.map((r: any) => r.relatedVideoId);
  const sourceVideos = sourceVideoIds.length > 0
    ? await db.video.findMany({
        where: { id: { in: sourceVideoIds } },
        select: { id: true, title: true, thumbnailUrl: true, channel: { select: { name: true } } },
      }).catch(() => [])
    : [];

  return NextResponse.json({
    video: {
      id: video.id,
      title: video.title,
      description: video.description,
      category: video.category,
      language: (video as any).language || "",
      ageGated: (video as any).ageGated || false,
    },
    publicationDate: video.createdAt?.toISOString(),
    updateDate: (video as any).publishedAt?.toISOString() || video.createdAt?.toISOString(),
    // §65: creator-provided sources.
    creatorSources: {
      urlsInDescription: sourceUrls,
      sourceVideos: sourceVideos.map((v: any) => ({
        id: v.id,
        title: v.title,
        thumbnailUrl: v.thumbnailUrl,
        channel: v.channel?.name,
      })),
      note: sourceUrls.length > 0 || sourceVideos.length > 0
        ? "Sources identified from the video description and creator-declared relationships."
        : "No creator-declared sources found for this video.",
    },
    // §66: corrections.
    corrections: corrections.map((c: any) => ({
      timestamp: c.timestamp,
      originalText: c.originalText,
      correctedText: c.correctedText,
      note: c.note,
      viewersNotified: !!c.viewersNotified,
      createdAt: c.createdAt?.toISOString(),
    })),
    // §17: content provenance.
    provenance: provenance ? {
      origin: provenance.origin,
      components: (() => { try { return JSON.parse(provenance.components || "{}"); } catch { return {}; } })(),
      sourceNote: provenance.sourceNote,
      declared: provenance.declared,
    } : {
      origin: "unknown",
      note: "Provenance not declared for this video.",
    },
    // §53: active rights claims that affect context.
    rightsClaims: rightsClaims.map((r: any) => ({
      claimant: r.claimant,
      claimType: r.claimType,
      matchedMaterial: r.matchedMaterial,
      action: r.action,
    })),
    // §65: "Do not present AI classification as a substitute for evidence."
    disclaimer: "Context information is provided for transparency. AI-generated provenance classifications are estimates, not evidence. Always verify claims with primary sources.",
  });
}
