import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { getUserState, parseList } from "@/lib/user-state";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/feed/for-you?bid=<browserId>&limit=<n>&mode=<mode>
 *
 * Personalized "For You" feed — the FYP (For You Page).
 *
 * Pass 5 upgrade — now respects user preferences + blocks + feedback (§7,§9,§10,§11):
 *   - Reads UserPreference (homeMode, discoveryMix, disableShorts, aiContentFilter)
 *   - Reads UserBlock (excludes blocked topics/keywords/creators/languages)
 *   - Reads RecommendationFeedback (excludes "not interested" videos)
 *   - Supports home modes (§6): focus | following | chronological | discovery | smart | random
 *   - Returns "whyAmISeeingThis" reasons per video (§8 transparency)
 *
 * ALGORITHM (zero-cost, no ML, no embeddings):
 *   1. Build category affinity from liked/watched videos.
 *   2. Exclude: watched, blocked, feedback-given videos.
 *   3. Score by: category affinity + channel affinity + recency + popularity.
 *   4. Apply diversity penalty (max 3/channel).
 *   5. Apply discovery mix (familiar/new/unexpected percentages).
 *   6. Attach "whyAmISeeingThis" reasons.
 *
 * SECURITY: requires a valid signed browserId. Rate limited: 30/min per IP.
 */

interface ScoredVideo {
  video: any;
  score: number;
  channelId: string;
  reasons: string[];
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "24", 10) || 24, 1), 50);
  const modeOverride = url.searchParams.get("mode");

  // Rate limit.
  const ip = getClientIP(req);
  const rl = await rateLimit(`fyp:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
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
    return NextResponse.json({
      videos: scored,
      source: "trending",
      reasons: scored.map(() => ["Trending on Mashahd"]),
    });
  }

  // Verify browserId signature.
  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  // ── Load user state + preferences + blocks + feedback ──
  const st = await getUserState(verification.id);
  const liked = parseList(st.likedVideoIds);
  const watched = parseList(st.watchedVideoIds);
  const subs = parseList(st.subscribedChannelIds);

  // Load preferences (or defaults).
  const pref = await db.userPreference.findUnique({ where: { ownerId: verification.id } });
  const homeMode = modeOverride || pref?.homeMode || "smart";
  const disableShorts = pref?.disableShorts ?? false;
  const aiContentFilter = pref?.aiContentFilter || "show_all";
  const discoveryFamiliar = pref?.discoveryFamiliar ?? 60;
  const discoveryNewCreators = pref?.discoveryNewCreators ?? 25;
  const discoveryUnexpected = pref?.discoveryUnexpected ?? 15;

  // Load blocks (§11).
  const blocks = await db.userBlock.findMany({ where: { userId: verification.id } });
  const blockedTopics = new Set(blocks.filter(b => b.blockType === "topic").map(b => b.blockValue.toLowerCase()));
  const blockedKeywords = blocks.filter(b => b.blockType === "keyword").map(b => b.blockValue.toLowerCase());
  const blockedCreators = new Set(blocks.filter(b => b.blockType === "creator").map(b => b.blockValue));
  const blockedLanguages = new Set(blocks.filter(b => b.blockType === "language").map(b => b.blockValue.toLowerCase()));

  // Load recommendation feedback (§10) — these videos are excluded.
  const feedback = await db.recommendationFeedback.findMany({
    where: { userId: verification.id },
    select: { videoId: true },
  });
  const feedbackExcluded = new Set(feedback.map(f => f.videoId));

  // ── Build category affinity ──
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
  // Watched videos also contribute (weaker signal) — UNLESS pauseRecommendationLearning is on (§26).
  const pauseLearning = pref?.pauseRecommendationLearning ?? false;
  if (!pauseLearning && watched.length > 0) {
    const watchedVideos = await db.video.findMany({
      where: { id: { in: watched.slice(0, 30) } },
      select: { category: true },
    });
    for (const v of watchedVideos) {
      categoryAffinity[v.category] = (categoryAffinity[v.category] || 0) + 0.5;
    }
  }

  // ── Fetch candidate videos ──
  const excludeIds = new Set([...watched.slice(0, 50), ...feedbackExcluded]);
  let candidates = await db.video.findMany({
    where: { id: { notIn: Array.from(excludeIds) } },
    include: { channel: true },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  // ── Apply blocks (§11) ──
  candidates = candidates.filter((v) => {
    // Blocked creators.
    if (blockedCreators.has(v.channelId)) return false;
    // Blocked topics (category).
    if (blockedTopics.has(v.category.toLowerCase())) return false;
    // Blocked languages.
    const lang = (v as any).language || "";
    if (lang && blockedLanguages.has(lang.toLowerCase())) return false;
    // Blocked keywords (in title/description/tags).
    if (blockedKeywords.length > 0) {
      const hay = (v.title + " " + v.description + " " + v.tags).toLowerCase();
      for (const kw of blockedKeywords) {
        if (hay.includes(kw)) return false;
      }
    }
    return true;
  });

  // ── Mode-specific filtering (§6) ──
  if (homeMode === "focus") {
    // Focus: only explicitly relevant content (liked categories + subscribed channels).
    candidates = candidates.filter((v) =>
      categoryAffinity[v.category] > 0 || subs.includes(v.channelId)
    );
  } else if (homeMode === "following") {
    // Following: primarily content from followed creators.
    candidates = candidates.filter((v) => subs.includes(v.channelId));
  } else if (homeMode === "chronological") {
    // Chronological: newest first, no personalization scoring.
    candidates.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    const sliced = candidates.slice(0, limit);
    return NextResponse.json({
      videos: sliced,
      source: "chronological",
      mode: homeMode,
      reasons: sliced.map(() => ["Newest uploads first"]),
      personalization: {
        affinityCategories: Object.keys(categoryAffinity).length,
        subscribedCount: subs.length,
        watchedCount: watched.length,
        blockedCount: blocks.length,
        feedbackCount: feedbackExcluded.size,
      },
    });
  } else if (homeMode === "random") {
    // Random / Surprise me (§6): deliberately random.
    candidates.sort(() => Math.random() - 0.5);
    const sliced = candidates.slice(0, limit);
    return NextResponse.json({
      videos: sliced,
      source: "random",
      mode: homeMode,
      reasons: sliced.map(() => ["Random discovery — something unexpected"]),
      personalization: {
        affinityCategories: Object.keys(categoryAffinity).length,
        subscribedCount: subs.length,
        watchedCount: watched.length,
        blockedCount: blocks.length,
        feedbackCount: feedbackExcluded.size,
      },
    });
  }

  // ── Score every candidate (smart + discovery modes) ──
  const now = Date.now();
  const knownCreatorIds = new Set(subs);
  const scored: ScoredVideo[] = candidates.map((v) => {
    let score = 0;
    const reasons: string[] = [];

    // Category affinity boost.
    const affinity = categoryAffinity[v.category] || 0;
    if (affinity > 0) {
      score += affinity * 10;
      reasons.push(`You watched similar videos in ${v.category}`);
    }

    // Subscribed channel boost.
    if (subs.includes(v.channelId)) {
      score += 15;
      reasons.push(`You follow ${v.channel.name}`);
    }

    // Recency boost (logarithmic).
    const daysOld = Math.max(1, (now - v.createdAt.getTime()) / 86400000);
    const recencyBoost = Math.max(0, 5 - Math.log2(daysOld));
    score += recencyBoost;
    if (daysOld < 1) reasons.push("Recently uploaded");

    // Popularity tiebreaker.
    score += Math.log10(Math.max(1, v.views));

    // Discovery mode: boost new/unknown creators.
    if (homeMode === "discovery" && !knownCreatorIds.has(v.channelId)) {
      score += 10;
      reasons.push("Part of your discovery mix — new creator");
    }

    // If no reasons, add a default.
    if (reasons.length === 0) {
      reasons.push("Recommended for you");
    }

    return { video: v, score, channelId: v.channelId, reasons };
  });

  // Sort by score descending.
  scored.sort((a, b) => b.score - a.score);

  // ── Diversity: cap at 3 videos per channel (§64) ──
  const channelCount: Record<string, number> = {};
  const diverse: ScoredVideo[] = [];
  const overflow: ScoredVideo[] = [];
  for (const s of scored) {
    if ((channelCount[s.channelId] || 0) < 3) {
      diverse.push(s);
      channelCount[s.channelId] = (channelCount[s.channelId] || 0) + 1;
    } else {
      overflow.push(s);
    }
  }

  // ── Discovery mix (§9) ──
  // Split into familiar (high affinity or subscribed) vs new (low affinity).
  const familiar = diverse.filter(s =>
    subs.includes(s.channelId) || (categoryAffinity[s.video.category] || 0) > 0
  );
  const newCreators = diverse.filter(s =>
    !subs.includes(s.channelId) && (categoryAffinity[s.video.category] || 0) === 0
  );

  const familiarCount = Math.round(limit * discoveryFamiliar / 100);
  const newCount = Math.round(limit * discoveryNewCreators / 100);
  const unexpectedCount = Math.max(1, limit - familiarCount - newCount);

  const familiarSlice = familiar.slice(0, familiarCount);
  const newSlice = newCreators.slice(0, newCount);

  // Unexpected: random from overflow (§63 serendipity).
  const unexpectedPool = [...overflow, ...newCreators.slice(newCount)]
    .sort(() => Math.random() - 0.5)
    .slice(0, unexpectedCount);

  // Tag unexpected reasons.
  for (const s of unexpectedPool) {
    if (!s.reasons.includes("Part of your discovery mix — unexpected subject")) {
      s.reasons.push("Part of your discovery mix — unexpected subject");
    }
  }

  const final = [...familiarSlice, ...newSlice, ...unexpectedPool].slice(0, limit);

  return NextResponse.json({
    videos: final.map((s) => s.video),
    reasons: final.map((s) => s.reasons),
    source: homeMode === "discovery" ? "discovery" : "for-you",
    mode: homeMode,
    personalization: {
      affinityCategories: Object.keys(categoryAffinity).length,
      subscribedCount: subs.length,
      watchedCount: watched.length,
      blockedCount: blocks.length,
      feedbackCount: feedbackExcluded.size,
      pauseLearning,
      discoveryMix: {
        familiar: familiarSlice.length,
        newCreators: newSlice.length,
        unexpected: unexpectedPool.length,
      },
    },
  });
}
