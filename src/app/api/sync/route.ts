import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { getUserState, parseList } from "@/lib/user-state";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/sync?bid=<browserId>
 *
 * Per spec §59: "Ensure continuity between mobile, desktop, tablet, TV.
 * Synchronize where appropriate: playback, preferences, history, library,
 * language, captions, speed."
 *
 * Returns a unified sync document containing ALL of the user's data that
 * should be synchronized across devices:
 *   - Preferences (all 25+ fields)
 *   - UserState (likes, subs, history, favorites, watch later)
 *   - ContinueWatching (resume positions)
 *   - InterestProfiles (active profile)
 *   - Blocks (topic/creator/keyword blocks)
 *
 * This endpoint is called when a user opens Mashahd on a new device to
 * pull their full state. The POST endpoint is called periodically to push
 * local state changes.
 *
 * SECURITY: requires a valid signed browserId.
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  if (!bid) return NextResponse.json({ error: "browserId required" }, { status: 400 });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`sync:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // Fetch all syncable data in parallel.
  const [preferences, userState, continueWatching, interestProfiles, blocks] = await Promise.all([
    db.userPreference.findUnique({ where: { ownerId: verification.id } }).catch(() => null),
    getUserState(verification.id).catch(() => null),
    db.continueWatching.findMany({
      where: { userId: verification.id, completed: false },
      orderBy: { updatedAt: "desc" },
      take: 20,
      select: { videoId: true, position: true, playbackSpeed: true, qualityPref: true, audioLang: true, subtitleLang: true, updatedAt: true },
    }).catch(() => []),
    db.interestProfile.findMany({
      where: { userId: verification.id },
      select: { id: true, name: true, categories: true, isActive: true },
    }).catch(() => []),
    db.userBlock.findMany({
      where: { userId: verification.id },
      select: { blockType: true, blockValue: true },
    }).catch(() => []),
  ]);

  const activeProfile = interestProfiles.find((p: any) => p.isActive) || null;

  return NextResponse.json({
    syncedAt: new Date().toISOString(),
    userId: verification.id,
    // §59: preferences (quality, speed, subtitles, language, etc.)
    preferences: preferences ? {
      preferredQuality: preferences.preferredQuality,
      preferredSpeed: preferences.preferredSpeed,
      preferredVolume: preferences.preferredVolume,
      preferredSubtitleLang: preferences.preferredSubtitleLang,
      preferredAudioLang: preferences.preferredAudioLang,
      disableShorts: preferences.disableShorts,
      aiContentFilter: preferences.aiContentFilter,
      homeMode: preferences.homeMode,
      discoveryFamiliar: preferences.discoveryFamiliar,
      discoveryNewCreators: preferences.discoveryNewCreators,
      discoveryUnexpected: preferences.discoveryUnexpected,
      searchSort: preferences.searchSort,
      pauseRecommendationLearning: preferences.pauseRecommendationLearning,
      reducedMotion: preferences.reducedMotion,
      highContrast: preferences.highContrast,
      largeControls: preferences.largeControls,
      continueWatchingEnabled: preferences.continueWatchingEnabled,
      autoplayNext: preferences.autoplayNext,
      uiMode: preferences.uiMode,
      likesVisibility: preferences.likesVisibility,
      subscriptionsVisibility: preferences.subscriptionsVisibility,
      historyVisibility: preferences.historyVisibility,
      playlistsVisibility: preferences.playlistsVisibility,
      commentsVisibility: preferences.commentsVisibility,
    } : null,
    // §59: history + library
    userState: userState ? {
      likedVideoIds: parseList(userState.likedVideoIds),
      subscribedChannelIds: parseList(userState.subscribedChannelIds),
      watchedVideoIds: parseList(userState.watchedVideoIds).slice(0, 50),
      favoriteVideoIds: parseList(userState.favoriteVideoIds),
      watchLaterIds: parseList(userState.watchLaterIds),
    } : null,
    // §59: playback state (resume positions)
    continueWatching: continueWatching.map((c: any) => ({
      videoId: c.videoId,
      position: c.position,
      playbackSpeed: c.playbackSpeed,
      qualityPref: c.qualityPref,
      audioLang: c.audioLang,
      subtitleLang: c.subtitleLang,
      updatedAt: c.updatedAt?.toISOString(),
    })),
    // §59: active interest profile
    activeProfile: activeProfile ? {
      id: activeProfile.id,
      name: activeProfile.name,
      categories: activeProfile.categories ? activeProfile.categories.split("|").filter(Boolean) : [],
    } : null,
    // §59: blocks (affect all devices)
    blocks: blocks.map((b: any) => ({
      blockType: b.blockType,
      blockValue: b.blockValue,
    })),
    // Sync version for conflict detection.
    syncVersion: 1,
  });
}

/**
 * POST /api/sync
 * Body: { browserId, type, data }
 *   type: "continueWatching" | "preferences"
 *
 * Pushes local state changes to the server for cross-device sync.
 * This is a lightweight push — only the changed data is sent.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const type: string = body.type || "";

  if (!bid || !type) {
    return NextResponse.json({ error: "browserId+type required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`sync-push:${ip}`, 20, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  if (type === "continueWatching") {
    // Push a continue-watching update.
    const { videoId, position, playbackSpeed, qualityPref, audioLang, subtitleLang } = body.data || {};
    if (!videoId) return NextResponse.json({ error: "videoId required" }, { status: 400 });

    await db.continueWatching.upsert({
      where: { userId_videoId: { userId: verification.id, videoId } },
      create: {
        userId: verification.id,
        videoId,
        position: Math.max(0, Number(position) || 0),
        playbackSpeed: Number(playbackSpeed) || 1,
        qualityPref: String(qualityPref || "auto").slice(0, 20),
        audioLang: String(audioLang || "").slice(0, 10),
        subtitleLang: String(subtitleLang || "").slice(0, 10),
      },
      update: {
        position: Math.max(0, Number(position) || 0),
        playbackSpeed: Number(playbackSpeed) || 1,
        qualityPref: String(qualityPref || "auto").slice(0, 20),
        audioLang: String(audioLang || "").slice(0, 10),
        subtitleLang: String(subtitleLang || "").slice(0, 10),
      },
    }).catch(() => {});

    return NextResponse.json({ ok: true, syncedType: "continueWatching" });
  }

  if (type === "preferences") {
    // Push a preferences update (delegates to the preferences API logic).
    const updates = body.data || {};
    const allowedFields = [
      "preferredQuality", "preferredSpeed", "preferredVolume",
      "preferredSubtitleLang", "preferredAudioLang",
      "disableShorts", "aiContentFilter", "homeMode",
      "uiMode", "reducedMotion", "highContrast", "largeControls",
    ];
    const cleanUpdates: Record<string, any> = {};
    for (const field of allowedFields) {
      if (field in updates) cleanUpdates[field] = updates[field];
    }

    if (Object.keys(cleanUpdates).length === 0) {
      return NextResponse.json({ error: "no valid fields to sync" }, { status: 400 });
    }

    await db.userPreference.upsert({
      where: { ownerId: verification.id },
      create: { ownerId: verification.id, ...cleanUpdates },
      update: cleanUpdates,
    }).catch(() => {});

    return NextResponse.json({ ok: true, syncedType: "preferences", fields: Object.keys(cleanUpdates) });
  }

  return NextResponse.json({ error: "unknown sync type" }, { status: 400 });
}
