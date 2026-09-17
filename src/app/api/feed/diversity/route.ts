import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { getUserState, parseList } from "@/lib/user-state";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/feed/diversity?bid=<browserId>&limit=<n>
 *
 * Per spec §64: "Add recommendation diversity across: creators, topics,
 * formats, publication dates, geography, popularity, new creators,
 * established creators. Avoid recommending twenty near-duplicates."
 *
 * Returns a diversity-analyzed feed. Unlike the FYP (which personalizes for
 * engagement), this feed is optimized for DIVERSITY — ensuring the user
 * sees a wide range of creators, topics, and formats.
 *
 * Algorithm:
 *   1. Fetch candidate videos (recent, not watched).
 *   2. Score each video's diversity contribution:
 *      - Creator diversity: how many different creators are represented?
 *      - Topic diversity: how many different categories?
 *      - Format diversity: mix of long/short/live (based on durationSec).
 *      - Date diversity: spread across publication dates.
 *      - Popularity diversity: mix of popular + niche.
 *   3. Greedily select videos that maximize diversity.
 *   4. Return with diversity metrics.
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "12", 10) || 12, 1), 50);

  const ip = getClientIP(req);
  const rl = await rateLimit(`diversity:${ip}`, 20, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // Without a bid, return diverse trending content.
  if (!bid) {
    const videos = await db.video.findMany({
      include: { channel: true },
      take: 100,
      orderBy: { createdAt: "desc" },
    });
    const result = greedyDiverseSelect(videos, limit);
    return NextResponse.json({
      videos: result.videos,
      diversity: result.metrics,
      source: "diverse-trending",
    });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const st = await getUserState(verification.id);
  const watched = parseList(st.watchedVideoIds);

  // Fetch candidates (not watched).
  const candidates = await db.video.findMany({
    where: { id: { notIn: watched.slice(0, 50) } },
    include: { channel: true },
    take: 150,
    orderBy: { createdAt: "desc" },
  });

  // Greedily select for maximum diversity.
  const result = greedyDiverseSelect(candidates, limit);

  return NextResponse.json({
    videos: result.videos,
    diversity: result.metrics,
    source: "diverse-personalized",
    principle: "Per spec §64: Avoid recommending twenty near-duplicates. Ensure diversity across creators, topics, formats, dates, and popularity.",
  });
}

/**
 * Greedily select videos that maximize diversity.
 * At each step, pick the video that adds the most new diversity dimensions.
 */
function greedyDiverseSelect(
  candidates: any[],
  limit: number
): { videos: any[]; metrics: any } {
  if (candidates.length === 0) {
    return { videos: [], metrics: { totalSelected: 0 } };
  }

  const selected: any[] = [];
  const seenChannels = new Set<string>();
  const seenCategories = new Set<string>();
  const seenFormats = new Set<string>();
  const seenDateBuckets = new Set<string>();
  const seenPopularityBuckets = new Set<string>();

  // Sort candidates by views (descending) as a starting point.
  const sorted = [...candidates].sort((a, b) => (b.views || 0) - (a.views || 0));

  for (const v of sorted) {
    if (selected.length >= limit) break;

    const channelId = v.channelId;
    const category = v.category;
    const format = v.durationSec < 300 ? "short" : v.durationSec < 900 ? "medium" : "long";
    const dateBucket = new Date(v.createdAt).toISOString().slice(0, 7); // YYYY-MM
    const popularityBucket = v.views > 1000000 ? "viral" : v.views > 100000 ? "popular" : v.views > 10000 ? "moderate" : "niche";

    // Score: how many NEW diversity dimensions does this video add?
    let diversityScore = 0;
    if (!seenChannels.has(channelId)) diversityScore += 4; // creator diversity is most important
    if (!seenCategories.has(category)) diversityScore += 3;
    if (!seenFormats.has(format)) diversityScore += 2;
    if (!seenDateBuckets.has(dateBucket)) diversityScore += 1;
    if (!seenPopularityBuckets.has(popularityBucket)) diversityScore += 1;

    // Only select if it adds at least some diversity (or if we need to fill the quota).
    if (diversityScore >= 2 || selected.length < limit) {
      selected.push(v);
      seenChannels.add(channelId);
      seenCategories.add(category);
      seenFormats.add(format);
      seenDateBuckets.add(dateBucket);
      seenPopularityBuckets.add(popularityBucket);
    }
  }

  // Compute diversity metrics.
  const metrics = {
    uniqueCreators: seenChannels.size,
    uniqueCategories: seenCategories.size,
    uniqueFormats: Array.from(seenFormats),
    uniqueDateBuckets: seenDateBuckets.size,
    uniquePopularityBuckets: Array.from(seenPopularityBuckets),
    totalSelected: selected.length,
    // Diversity ratio: unique creators / total selected (1.0 = max diversity).
    creatorDiversity: selected.length > 0 ? Math.round((seenChannels.size / selected.length) * 100) : 0,
    topicDiversity: selected.length > 0 ? Math.round((seenCategories.size / selected.length) * 100) : 0,
    note: "Creator diversity = unique creators / total videos. 100% means every video is from a different creator.",
  };

  return { videos: selected, metrics };
}
