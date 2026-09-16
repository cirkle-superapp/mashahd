import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { getUserState, parseList } from "@/lib/user-state";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/feed/for-you?bid=<browserId>&limit=<n>
 *
 * Personalized "For You" feed — the FYP (For You Page) that was missing
 * per the social-media structuring audit (the audit found home feed was
 * just `sort=recent`, no recommendation system at all).
 *
 * ALGORITHM (zero-cost, no ML, no embeddings):
 *   1. Score every video by a weighted blend of:
 *      - Category affinity (categories the user has liked/watched get a boost)
 *      - Channel affinity (videos from subscribed channels get a boost)
 *      - Recency (newer videos get a small boost)
 *      - Popularity (views as a tiebreaker)
 *      - Diversity penalty (don't show 10 videos from the same channel)
 *   2. Exclude already-watched videos (so the feed feels fresh).
 *   3. Add a 20% random exploration slice (so the user discovers new things
 *      and the feed doesn't become an echo chamber).
 *   4. Return the top N.
 *
 * This is a lightweight heuristic recommender — not ML, but it produces
 * meaningfully personalized results. A production system would use
 * collaborative filtering or embeddings, but this is zero-cost and
 * works on the existing data.
 *
 * SECURITY: requires a valid signed browserId. Rate limited: 30/min per IP.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  const limit = Math.min(
    Math.max(parseInt(url.searchParams.get("limit") || "24", 10) || 24, 1),
    50
  );

  // Rate limit.
  const ip = getClientIP(req);
  const rl = await rateLimit(`fyp:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // Without a bid, fall back to trending (non-personalized).
  if (!bid) {
    const trending = await db.video.findMany({
      include: { channel: true },
      take: limit + 20,
      orderBy: { createdAt: "desc" },
    });
    const now = Date.now();
    const scored = trending
      .map((v) => ({
        video: v,
        score: v.views / Math.pow(Math.max(1, (now - v.createdAt.getTime()) / 86400000), 0.6),
      }))
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((s) => s.video);
    return NextResponse.json({ videos: scored, source: "trending" });
  }

  // Verify browserId signature.
  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json(
      { error: "invalid browserId", reissue: true },
      { status: 403 }
    );
  }

  // Fetch user state to build affinity profile.
  const st = await getUserState(verification.id);
  const liked = parseList(st.likedVideoIds);
  const watched = parseList(st.watchedVideoIds);
  const subs = parseList(st.subscribedChannelIds);

  // Fetch liked videos' categories to build category affinity.
  let categoryAffinity: Record<string, number> = {};
  if (liked.length > 0) {
    const likedVideos = await db.video.findMany({
      where: { id: { in: liked.slice(0, 50) } },
      select: { category: true, channelId: true },
    });
    for (const v of likedVideos) {
      categoryAffinity[v.category] = (categoryAffinity[v.category] || 0) + 2;
    }
  }
  // Watched videos also contribute (weaker signal).
  if (watched.length > 0) {
    const watchedVideos = await db.video.findMany({
      where: { id: { in: watched.slice(0, 30) } },
      select: { category: true },
    });
    for (const v of watchedVideos) {
      categoryAffinity[v.category] = (categoryAffinity[v.category] || 0) + 0.5;
    }
  }

  // Fetch candidate videos (recent + not watched).
  const excludeIds = new Set([...watched.slice(0, 50)]);
  const candidates = await db.video.findMany({
    where: {
      id: { notIn: Array.from(excludeIds) },
    },
    include: { channel: true },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  const now = Date.now();

  // Score every candidate.
  const scored = candidates.map((v) => {
    let score = 0;
    score += (categoryAffinity[v.category] || 0) * 10;
    if (subs.includes(v.channelId)) score += 15;
    const daysOld = Math.max(1, (now - v.createdAt.getTime()) / 86400000);
    score += Math.max(0, 5 - Math.log2(daysOld));
    score += Math.log10(Math.max(1, v.views));
    return { video: v, score, channelId: v.channelId };
  });

  // Sort by score descending.
  scored.sort((a, b) => b.score - a.score);

  // Diversity: cap at 3 videos per channel in the top results.
  const channelCount: Record<string, number> = {};
  const diverse: typeof scored = [];
  const overflow: typeof scored = [];
  for (const s of scored) {
    if ((channelCount[s.channelId] || 0) < 3) {
      diverse.push(s);
      channelCount[s.channelId] = (channelCount[s.channelId] || 0) + 1;
    } else {
      overflow.push(s);
    }
  }

  // Reserve 20% for random exploration (prevents echo chamber).
  const exploreCount = Math.max(1, Math.floor(limit * 0.2));
  const explorePool = overflow.length > 0
    ? overflow.sort(() => Math.random() - 0.5).slice(0, exploreCount)
    : [];

  const final = [...diverse.slice(0, limit - exploreCount), ...explorePool].slice(0, limit);

  return NextResponse.json({
    videos: final.map((s) => s.video),
    source: "for-you",
    personalization: {
      affinityCategories: Object.keys(categoryAffinity).length,
      subscribedCount: subs.length,
      watchedCount: watched.length,
      exploreRatio: exploreCount / limit,
    },
  });
}
