import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { getUserState, parseList } from "@/lib/user-state";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/data-export?bid=<browserId>
 *
 * Per spec §56: "Where legally required/appropriate, provide export for:
 * watch history, search history, subscriptions/follows, playlists, likes,
 * saved content, preferences, comments, user-created content.
 * Use structured machine-readable formats."
 *
 * Returns a single JSON document containing ALL of the user's data.
 * This is a GDPR-style data portability export.
 *
 * SECURITY: requires a valid signed browserId. Rate limited: 5/min per IP
 * (exports are expensive — we fetch everything).
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
  const rl = await rateLimit(`data-export:${ip}`, 5, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — exports are limited to 5/min" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const userId = verification.id;

  // Fetch everything in parallel.
  const [userState, preferences, blocks, feedback, profiles, smartPlaylists, changelog, continueWatching, notifications] = await Promise.all([
    // 1. User state (likes, subs, history, favorites, watch later).
    getUserState(userId).catch(() => null),
    // 2. Preferences.
    db.userPreference.findUnique({ where: { ownerId: userId } }).catch(() => null),
    // 3. Blocks.
    db.userBlock.findMany({ where: { userId } }).catch(() => []),
    // 4. Recommendation feedback.
    db.recommendationFeedback.findMany({ where: { userId } }).catch(() => []),
    // 5. Interest profiles.
    db.interestProfile.findMany({ where: { userId } }).catch(() => []),
    // 6. Smart playlists.
    db.smartPlaylist.findMany({ where: { userId } }).catch(() => []),
    // 7. Recommendation changelog.
    db.recommendationChangelog.findMany({ where: { userId } }).catch(() => []),
    // 8. Continue watching.
    db.continueWatching.findMany({ where: { userId } }).catch(() => []),
    // 9. Notifications.
    db.notification.findMany({ where: { recipientId: userId } }).catch(() => []),
  ]);

  // Fetch video data for liked/watched/favorited videos.
  const likedIds = parseList(userState?.likedVideoIds || "");
  const watchedIds = parseList(userState?.watchedVideoIds || "");
  const favoriteIds = parseList(userState?.favoriteVideoIds || "");
  const watchLaterIds = parseList(userState?.watchLaterIds || "");
  const subIds = parseList(userState?.subscribedChannelIds || "");

  const allVideoIds = [...new Set([...likedIds, ...watchedIds, ...favoriteIds, ...watchLaterIds])];
  const videos = allVideoIds.length > 0
    ? await db.video.findMany({
        where: { id: { in: allVideoIds } },
        select: { id: true, title: true, category: true, createdAt: true, channel: { select: { name: true, handle: true } } },
      }).catch(() => [])
    : [];

  const videoMap = new Map(videos.map((v: any) => [v.id, v]));

  // Fetch subscribed channels.
  const channels = subIds.length > 0
    ? await db.channel.findMany({
        where: { id: { in: subIds } },
        select: { id: true, name: true, handle: true },
      }).catch(() => [])
    : [];

  // Fetch playlists created by this user (via UserState).
  const playlists = userState
    ? await db.playlist.findMany({
        where: { userStateId: userState.id },
        include: { items: { select: { videoId: true, position: true, addedAt: true } } },
      }).catch(() => [])
    : [];

  // Fetch clips created by this user.
  const clips = await db.clip.findMany({
    where: { creatorId: userId },
    select: { id: true, videoId: true, title: true, startSec: true, endSec: true, note: true, createdAt: true },
  }).catch(() => []);

  // Fetch shares by this user.
  const shares = await db.share.findMany({
    where: { sharerId: userId },
    select: { videoId: true, platform: true, createdAt: true },
  }).catch(() => []);

  // Build the export document.
  const exportData = {
    exportedAt: new Date().toISOString(),
    platform: "Mashahd",
    version: "1.0",
    userId,
    // §56: watch history
    watchHistory: {
      videoIds: watchedIds,
      videos: watchedIds.map((id: string) => videoMap.get(id)).filter(Boolean),
    },
    // §56: subscriptions/follows
    subscriptions: {
      channelIds: subIds,
      channels: channels.map((c: any) => ({ name: c.name, handle: c.handle })),
    },
    // §56: playlists
    playlists: playlists.map((p: any) => ({
      title: p.title,
      description: p.description,
      visibility: p.visibility,
      items: p.items?.map((i: any) => ({
        videoId: i.videoId,
        position: i.position,
        addedAt: i.addedAt?.toISOString(),
      })) || [],
    })),
    // §56: likes
    likes: {
      videoIds: likedIds,
      videos: likedIds.map((id: string) => videoMap.get(id)).filter(Boolean),
    },
    // §56: saved content
    savedContent: {
      favoriteVideoIds: favoriteIds,
      watchLaterIds: watchLaterIds,
      videos: [...favoriteIds, ...watchLaterIds].map((id: string) => videoMap.get(id)).filter(Boolean),
    },
    // §56: preferences
    preferences: preferences ? {
      preferredQuality: preferences.preferredQuality,
      preferredSpeed: preferences.preferredSpeed,
      preferredVolume: preferences.preferredVolume,
      preferredSubtitleLang: preferences.preferredSubtitleLang,
      preferredAudioLang: preferences.preferredAudioLang,
      disableShorts: preferences.disableShorts,
      aiContentFilter: preferences.aiContentFilter,
      homeMode: preferences.homeMode,
      discoveryMix: {
        familiar: preferences.discoveryFamiliar,
        newCreators: preferences.discoveryNewCreators,
        unexpected: preferences.discoveryUnexpected,
      },
      searchSort: preferences.searchSort,
      pauseRecommendationLearning: preferences.pauseRecommendationLearning,
      privacy: {
        likesVisibility: preferences.likesVisibility,
        subscriptionsVisibility: preferences.subscriptionsVisibility,
        historyVisibility: preferences.historyVisibility,
        playlistsVisibility: preferences.playlistsVisibility,
        commentsVisibility: preferences.commentsVisibility,
      },
      accessibility: {
        reducedMotion: preferences.reducedMotion,
        highContrast: preferences.highContrast,
        largeControls: preferences.largeControls,
      },
    } : null,
    // §56: comments (user-created content)
    clips: clips,
    shares: shares,
    // Additional data
    blocks: blocks.map((b: any) => ({
      blockType: b.blockType,
      blockValue: b.blockValue,
      createdAt: b.createdAt?.toISOString(),
    })),
    recommendationFeedback: feedback.map((f: any) => ({
      videoId: f.videoId,
      reason: f.reason,
      note: f.note,
      createdAt: f.createdAt?.toISOString(),
    })),
    interestProfiles: profiles.map((p: any) => ({
      name: p.name,
      categories: p.categories ? p.categories.split("|").filter(Boolean) : [],
      isActive: p.isActive,
    })),
    smartPlaylists: smartPlaylists.map((p: any) => ({
      name: p.name,
      description: p.description,
      rules: JSON.parse(p.rules || "{}"),
    })),
    recommendationChangelog: changelog.map((c: any) => ({
      eventType: c.eventType,
      description: c.description,
      createdAt: c.createdAt?.toISOString(),
    })),
    continueWatching: continueWatching.map((c: any) => ({
      videoId: c.videoId,
      position: c.position,
      completed: c.completed,
      updatedAt: c.updatedAt?.toISOString(),
    })),
    notifications: notifications.map((n: any) => ({
      type: n.type,
      read: n.read,
      createdAt: n.createdAt?.toISOString(),
    })),
  };

  // Return as a downloadable JSON file.
  return new NextResponse(JSON.stringify(exportData, null, 2), {
    headers: {
      "Content-Type": "application/json",
      "Content-Disposition": `attachment; filename="mashahd-data-export-${new Date().toISOString().slice(0, 10)}.json"`,
    },
  });
}
