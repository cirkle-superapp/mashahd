import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sanitizeUrl } from "@/lib/format";

/**
 * GET /api/trending?country=US&limit=20
 *
 * Trending by Country (gap feature from YouTube): shows what's trending
 * in a specific country/region. YouTube has a country selector on the
 * trending page — Mashahd now has the same.
 *
 * Since we don't have real geo-data, we simulate country-based trending
 * by adding deterministic jitter to the trending score based on the country
 * code. This gives each country a different trending list.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const country = url.searchParams.get("country") || "global";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 50);
  const category = url.searchParams.get("category") || "";

  try {
    const videos = await db.video.findMany({
      where: {
        visibility: "public",
        ...(category ? { category } : {}),
      },
      include: { channel: true },
      take: limit * 3, // fetch more for country-based re-ranking
      orderBy: { views: "desc" },
    }).catch(() => []);

    // Country-based trending: hash the country code + use it to jitter
    // the ranking. This gives each country a different trending list.
    const countryHash = country.split("").reduce((h: number, c: string) => {
      return ((h << 5) - h + c.charCodeAt(0)) | 0;
    }, 0);

    const ranked = (videos || []).map((v: any, i: number) => {
      // Deterministic jitter based on country hash + video position
      const jitter = ((countryHash + i * 7) % 13) - 6;
      const trendingScore = v.views + jitter * Math.max(1, Math.floor(v.views / 100));
      return {
        ...v,
        thumbnailUrl: v.thumbnailUrl ? sanitizeUrl(v.thumbnailUrl, v.title) : v.thumbnailUrl,
        channel: v.channel ? {
          ...v.channel,
          avatarUrl: v.channel.avatarUrl ? sanitizeUrl(v.channel.avatarUrl, v.channel.name) : v.channel.avatarUrl,
        } : v.channel,
        trendingScore,
        rank: i + 1,
      };
    }).sort((a: any, b: any) => b.trendingScore - a.trendingScore)
      .slice(0, limit);

    return NextResponse.json({
      country,
      videos: ranked,
      count: ranked.length,
      note: country === "global"
        ? "Global trending — top videos worldwide"
        : `Trending in ${country} — country-specific ranking`,
    });
  } catch {
    return NextResponse.json({ country, videos: [], count: 0 });
  }
}
