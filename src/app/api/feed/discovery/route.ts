import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { getUserState, parseList } from "@/lib/user-state";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/feed/discovery?bid=<browserId>&limit=<n>
 *
 * Per spec §63: "Implement intentional discovery. Users should be able to define:
 * familiar content, adjacent interests, completely new subjects, new creators,
 * international content, archived content, random.
 * The recommendation system should not become an endless loop of almost-identical content."
 *
 * Returns a discovery feed — content that is intentionally DIFFERENT from what
 * the user normally watches. This is the opposite of the FYP (which personalizes).
 * Discovery deliberately introduces unfamiliar content.
 *
 * Algorithm:
 *   1. Identify the user's watched categories + subscribed channels.
 *   2. Fetch videos OUTSIDE those categories + channels.
 *   3. Boost: international content (different language), archived content (old),
 *      new creators (low subscriber count).
 *   4. Shuffle for serendipity.
 *   5. Return with "discoveryType" labels (new_subject, new_creator, international, archived, random).
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "12", 10) || 12, 1), 50);

  const ip = getClientIP(req);
  const rl = await rateLimit(`discovery:${ip}`, 20, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // Without a bid, return random content (non-personalized discovery).
  if (!bid) {
    const random = await db.video.findMany({
      include: { channel: true },
      take: limit + 10,
      orderBy: { createdAt: "desc" },
    });
    // Shuffle for serendipity.
    const shuffled = [...random].sort(() => Math.random() - 0.5).slice(0, limit);
    return NextResponse.json({
      videos: shuffled,
      discoveryTypes: shuffled.map(() => ["random"]),
      source: "random",
    });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  // Identify the user's familiar content (watched categories + subscribed channels).
  const st = await getUserState(verification.id);
  const watched = parseList(st.watchedVideoIds);
  const subs = parseList(st.subscribedChannelIds);

  // Fetch watched videos' categories to identify familiar territory.
  const watchedVideos = watched.length > 0
    ? await db.video.findMany({
        where: { id: { in: watched.slice(0, 30) } },
        select: { category: true, channelId: true, language: true },
      }).catch(() => [])
    : [];
  const familiarCategories = new Set(watchedVideos.map((v: any) => v.category));
  const familiarChannels = new Set([...subs, ...watchedVideos.map((v: any) => v.channelId)]);
  const familiarLanguages = new Set(watchedVideos.map((v: any) => v.language).filter(Boolean));

  // Fetch candidate videos that are OUTSIDE the user's familiar territory.
  const candidates = await db.video.findMany({
    where: {
      // Exclude watched videos.
      id: { notIn: watched.slice(0, 50) },
      // Exclude subscribed channels.
      channelId: { notIn: Array.from(familiarChannels) },
    },
    include: { channel: true },
    take: 100,
    orderBy: { createdAt: "desc" },
  });

  // Classify each candidate by discovery type.
  const now = Date.now();
  const scored = candidates.map((v: any) => {
    const types: string[] = [];
    const reasons: string[] = [];

    // New subject: category not in watched categories.
    if (!familiarCategories.has(v.category)) {
      types.push("new_subject");
      reasons.push(`New subject: ${v.category}`);
    }

    // New creator: channel with < 10K subscribers.
    if (v.channel && v.channel.subscribers < 10000) {
      types.push("new_creator");
      reasons.push(`New creator: ${v.channel.name}`);
    }

    // International: different language.
    const lang = (v as any).language || "";
    if (lang && familiarLanguages.size > 0 && !familiarLanguages.has(lang)) {
      types.push("international");
      reasons.push(`International content (${lang})`);
    }

    // Archived: older than 1 year.
    const daysOld = (now - v.createdAt.getTime()) / 86400000;
    if (daysOld > 365) {
      types.push("archived");
      reasons.push(`Archived content (${Math.floor(daysOld / 30)} months old)`);
    }

    // If no specific type, mark as random discovery.
    if (types.length === 0) {
      types.push("random");
      reasons.push("Random discovery");
    }

    // Score: more discovery types = higher score.
    const score = types.length * 10 + Math.random() * 5;
    return { video: v, score, types, reasons };
  });

  // Sort by score (most "different" first), then shuffle within score tiers.
  scored.sort((a, b) => b.score - a.score);

  // Take the top N, but shuffle within small tiers for serendipity.
  const top = scored.slice(0, limit * 2);
  const shuffled = top.sort(() => Math.random() - 0.5).slice(0, limit);

  return NextResponse.json({
    videos: shuffled.map((s) => s.video),
    discoveryTypes: shuffled.map((s) => s.types),
    reasons: shuffled.map((s) => s.reasons),
    source: "discovery",
    summary: {
      familiarCategories: Array.from(familiarCategories),
      familiarChannelCount: familiarChannels.size,
      candidatePool: candidates.length,
      returnedCount: shuffled.length,
      discoveryBreakdown: {
        new_subject: shuffled.filter((s) => s.types.includes("new_subject")).length,
        new_creator: shuffled.filter((s) => s.types.includes("new_creator")).length,
        international: shuffled.filter((s) => s.types.includes("international")).length,
        archived: shuffled.filter((s) => s.types.includes("archived")).length,
        random: shuffled.filter((s) => s.types.includes("random")).length,
      },
    },
    principle: "Per spec §63: The recommendation system should not become an endless loop of almost-identical content.",
  });
}
