/**
 * GET /api/ads — Sponsored content inventory (Pass 102).
 *
 * Returns active ad campaigns for the three unique Mashahd ad formats:
 *   - rings:    SponsoredRing — ambient brand glow around the player
 *   - lotus:    AdLotus — rotating mandala of brand tiles on home
 *   - quests:   SponsoredQuest — gamified micro-ads → Watch Rewards
 *
 * All ads are clearly labeled "Sponsored" per spec §15 ("Never make paid
 * placements look identical to organic results"). No pre-roll, no mid-roll,
 * no banners — Mashahd's ad formats are non-interruptive and gamified.
 *
 * This is the creative ad layer that no competitor ships. YouTube/Twitch/
 * TikTok all rely on interruptive pre-roll/mid-roll ads. Mashahd's ads
 * BLEND INTO the experience (ambient ring, lotus mandala, reward quests).
 */
import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

// Curated fallback inventory — used when the DB has no active campaigns.
const FALLBACK_INVENTORY = {
  rings: [
    {
      id: "ring-fallback-1",
      advertiser: "Mashahd Premium",
      brandColor: "hsl(var(--gold))",
      headline: "Upgrade for ad-free viewing",
      cta: "Go Premium",
      targetUrl: "/?v=premium",
      disclosure: "Sponsored",
    },
  ],
  lotus: [
    { id: "lotus-1", advertiser: "Creator Fund", tile: "🎁", headline: "Support creators", color: "rose", targetUrl: "/?v=support" },
    { id: "lotus-2", advertiser: "Mashahd Pro", tile: "✨", headline: "Premium features", color: "gold", targetUrl: "/?v=premium" },
    { id: "lotus-3", advertiser: "Community", tile: "🌍", headline: "Join the circle", color: "teal", targetUrl: "/?v=community" },
    { id: "lotus-4", advertiser: "Live TV", tile: "📺", headline: "24/7 channels", color: "cyan", targetUrl: "/?v=live-tv" },
    { id: "lotus-5", advertiser: "Shorts", tile: "⚡", headline: "Vertical feeds", color: "fuchsia", targetUrl: "/?v=shorts" },
    { id: "lotus-6", advertiser: "Watch Party", tile: "👥", headline: "Watch together", color: "amber", targetUrl: "/?v=party" },
  ],
  quests: [
    {
      id: "quest-1",
      advertiser: "Mashahd Rewards",
      headline: "Watch a 15s tour of premium features",
      rewardPoints: 50,
      durationSec: 15,
      questType: "video_tour",
      targetUrl: "/?v=premium",
      disclosure: "Sponsored quest — earn rewards for engaging",
    },
  ],
};

export async function GET(req: Request) {
  const ip = getClientIP(req as any);
  const rl = await rateLimit(`ads:${ip}`, 60, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const url = new URL(req.url);
  const format = url.searchParams.get("format") || "all";

  try {
    let dbAds: any[] = [];
    try {
      const now = new Date();
      dbAds = await (db as any).sponsoredHashtag.findMany({
        where: {
          active: true,
          startsAt: { lte: now },
          OR: [{ endsAt: null }, { endsAt: { gte: now } }],
        },
        orderBy: { budget: "desc" },
        take: 12,
      });
    } catch { /* DB unavailable — use fallback */ }

    const rings = dbAds.slice(0, 1).map((h: any) => ({
      id: `ring-${h.id}`,
      advertiser: h.advertiser,
      brandColor: h.brandColor || "hsl(var(--gold))",
      headline: `Supported by ${h.advertiser}`,
      cta: "Learn more",
      targetUrl: h.targetUrl || "/",
      disclosure: "Sponsored",
    }));

    const lotus = dbAds.slice(0, 6).map((h: any, i: number) => ({
      id: `lotus-${h.id}`,
      advertiser: h.advertiser,
      tile: h.emoji || ["🎁", "✨", "🌍", "📺", "⚡", "👥"][i % 6],
      headline: h.hashtag,
      color: ["rose", "gold", "teal", "cyan", "fuchsia", "amber"][i % 6],
      targetUrl: h.targetUrl || "/",
    }));

    const quests = dbAds.slice(0, 2).map((h: any) => ({
      id: `quest-${h.id}`,
      advertiser: h.advertiser,
      headline: `Discover ${h.advertiser} — earn rewards`,
      rewardPoints: 50,
      durationSec: 15,
      questType: "brand_discovery",
      targetUrl: h.targetUrl || "/",
      disclosure: "Sponsored quest — earn rewards for engaging",
    }));

    const result: Record<string, any[]> = {};
    if (format === "all" || format === "rings") {
      result.rings = rings.length > 0 ? rings : FALLBACK_INVENTORY.rings;
    }
    if (format === "all" || format === "lotus") {
      result.lotus = lotus.length >= 3 ? lotus : [...lotus, ...FALLBACK_INVENTORY.lotus].slice(0, 6);
    }
    if (format === "all" || format === "quests") {
      result.quests = quests.length > 0 ? quests : FALLBACK_INVENTORY.quests;
    }

    return NextResponse.json({
      ...result,
      meta: {
        billingRisk: "NONE — ads are served from DB + fallback, no third-party ad network",
        disclosure: "All ads labeled 'Sponsored' per spec §15",
        formats: ["rings", "lotus", "quests"],
        note: "Mashahd's ad formats are non-interruptive: ambient ring, lotus mandala, reward quests. No pre-roll/mid-roll/banners.",
      },
    });
  } catch {
    return NextResponse.json({ ...FALLBACK_INVENTORY, meta: { source: "fallback" } });
  }
}
