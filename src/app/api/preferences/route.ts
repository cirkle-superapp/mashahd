import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/preferences?bid=<browserId>
 * Returns the user's persisted preferences. If none exist, returns defaults.
 *
 * POST /api/preferences
 * Body: { browserId, ...prefs }
 * Upserts the user's preferences (partial updates supported).
 *
 * Per spec §69: persist user preferences so they don't reconfigure every visit.
 * Per spec §9: discovery mix, topic interest, format mix, creator preference, freshness.
 * Per spec §16: disableShorts (persistent).
 * Per spec §18: aiContentFilter (show_all | prefer_human | reduce_ai | hide_ai).
 * Per spec §26: pauseRecommendationLearning.
 * Per spec §58: accessibility (reducedMotion, highContrast, largeControls).
 */

// Default preferences (mirrors the schema defaults).
const DEFAULTS = {
  preferredQuality: "auto",
  preferredSpeed: 1,
  preferredVolume: 100,
  preferredSubtitleLang: "",
  preferredAudioLang: "",
  disableShorts: false,
  aiContentFilter: "show_all",
  homeMode: "smart",
  discoveryFamiliar: 60,
  discoveryNewCreators: 25,
  discoveryUnexpected: 15,
  searchSort: "relevance",
  pauseRecommendationLearning: false,
  reducedMotion: false,
  highContrast: false,
  largeControls: false,
  continueWatchingEnabled: true,
  autoplayNext: false,
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  if (!bid) return NextResponse.json({ preferences: DEFAULTS });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const pref = await db.userPreference.findUnique({ where: { ownerId: verification.id } });
  return NextResponse.json({ preferences: pref ? formatPref(pref) : DEFAULTS });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  if (!bid) return NextResponse.json({ error: "browserId required" }, { status: 400 });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  // Rate limit.
  const ip = getClientIP(req);
  const rl = await rateLimit(`prefs:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // Extract only known fields (whitelist — prevent injection).
  const updates: Record<string, any> = {};
  const allowedFields = [
    "preferredQuality", "preferredSpeed", "preferredVolume",
    "preferredSubtitleLang", "preferredAudioLang",
    "disableShorts", "aiContentFilter", "homeMode",
    "discoveryFamiliar", "discoveryNewCreators", "discoveryUnexpected",
    "searchSort", "pauseRecommendationLearning",
    "reducedMotion", "highContrast", "largeControls",
    "continueWatchingEnabled", "autoplayNext",
  ];
  for (const field of allowedFields) {
    if (field in body) {
      updates[field] = body[field];
    }
  }

  // Validate discovery mix sums to ~100 (allow ±5 tolerance).
  if ("discoveryFamiliar" in updates || "discoveryNewCreators" in updates || "discoveryUnexpected" in updates) {
    const f = updates.discoveryFamiliar ?? DEFAULTS.discoveryFamiliar;
    const n = updates.discoveryNewCreators ?? DEFAULTS.discoveryNewCreators;
    const u = updates.discoveryUnexpected ?? DEFAULTS.discoveryUnexpected;
    const sum = f + n + u;
    if (sum < 95 || sum > 105) {
      return NextResponse.json(
        { error: `discovery mix must sum to ~100 (got ${sum})` },
        { status: 400 }
      );
    }
  }

  // Validate enums.
  if (updates.preferredQuality && !["auto", "144p", "240p", "360p", "480p", "720p", "1080p", "1440p", "2160p"].includes(updates.preferredQuality)) {
    return NextResponse.json({ error: "invalid preferredQuality" }, { status: 400 });
  }
  if (updates.aiContentFilter && !["show_all", "prefer_human", "reduce_ai", "hide_ai"].includes(updates.aiContentFilter)) {
    return NextResponse.json({ error: "invalid aiContentFilter" }, { status: 400 });
  }
  if (updates.homeMode && !["focus", "following", "chronological", "discovery", "smart", "random"].includes(updates.homeMode)) {
    return NextResponse.json({ error: "invalid homeMode" }, { status: 400 });
  }
  if (updates.searchSort && !["relevance", "newest", "oldest", "most_viewed", "least_viewed", "longest", "shortest"].includes(updates.searchSort)) {
    return NextResponse.json({ error: "invalid searchSort" }, { status: 400 });
  }
  if (updates.preferredSpeed !== undefined) {
    const s = Number(updates.preferredSpeed);
    if (![0.5, 0.75, 1, 1.25, 1.5, 2].includes(s)) {
      return NextResponse.json({ error: "invalid preferredSpeed" }, { status: 400 });
    }
    updates.preferredSpeed = s;
  }

  // Upsert (create if not exists, update if exists).
  const pref = await db.userPreference.upsert({
    where: { ownerId: verification.id },
    create: { ownerId: verification.id, ...updates },
    update: updates,
  });

  return NextResponse.json({ ok: true, preferences: formatPref(pref) });
}

function formatPref(p: any) {
  return {
    preferredQuality: p.preferredQuality,
    preferredSpeed: p.preferredSpeed,
    preferredVolume: p.preferredVolume,
    preferredSubtitleLang: p.preferredSubtitleLang,
    preferredAudioLang: p.preferredAudioLang,
    disableShorts: p.disableShorts,
    aiContentFilter: p.aiContentFilter,
    homeMode: p.homeMode,
    discoveryFamiliar: p.discoveryFamiliar,
    discoveryNewCreators: p.discoveryNewCreators,
    discoveryUnexpected: p.discoveryUnexpected,
    searchSort: p.searchSort,
    pauseRecommendationLearning: p.pauseRecommendationLearning,
    reducedMotion: p.reducedMotion,
    highContrast: p.highContrast,
    largeControls: p.largeControls,
    continueWatchingEnabled: p.continueWatchingEnabled,
    autoplayNext: p.autoplayNext,
  };
}
