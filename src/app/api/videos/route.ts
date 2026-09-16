import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/videos
 * Query params:
 *   - category: filter by category (default "All" returns everything)
 *   - q: search query (matches title / channel name / tags)
 *   - sort: "recent" (default) | "popular" | "trending"
 *   - channelId: limit to a single channel
 *   - ids: pipe-separated list of video ids (for "liked"/"history" lists)
 *   - limit: max results (default 100, max 200) — pagination guard
 *   - offset: skip N results (for infinite scroll / pagination)
 *
 * SECURITY/perf (deep audit pass 2): added `limit` + `take` to prevent
 * unbounded queries returning thousands of rows.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category") || "All";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const sort = url.searchParams.get("sort") || "recent";
  const channelId = url.searchParams.get("channelId") || "";
  const idsParam = url.searchParams.get("ids") || "";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  const videos = await db.video.findMany({
    where: {
      ...(category !== "All" ? { category } : {}),
      ...(channelId ? { channelId } : {}),
      ...(idsParam
        ? { id: { in: idsParam.split("|").filter(Boolean) } }
        : {}),
    },
    include: { channel: true },
    take: limit + 100, // fetch a bit more for client-side filtering/sorting, then slice
  });

  let filtered = videos;
  if (q) {
    filtered = videos.filter((v) => {
      const hay = (
        v.title +
        " " +
        v.description +
        " " +
        v.tags +
        " " +
        v.channel.name +
        " " +
        v.channel.handle +
        " " +
        v.category
      ).toLowerCase();
      return q.split(/\s+/).every((term) => hay.includes(term));
    });
  }

  // Sort (§12 — deterministic search options).
  // Per spec §14: "Do not manipulate explicit search queries merely to increase
  // engagement. When the user explicitly chooses a deterministic operation, honor it."
  if (sort === "popular" || sort === "most_viewed") {
    filtered.sort((a, b) => b.views - a.views);
  } else if (sort === "least_viewed") {
    filtered.sort((a, b) => a.views - b.views);
  } else if (sort === "trending") {
    // Trending = recent + high view velocity. Proxy: views * recency weight.
    const now = Date.now();
    filtered.sort((a, b) => {
      const wa = scoreTrending(a.views, a.createdAt.getTime(), now);
      const wb = scoreTrending(b.views, b.createdAt.getTime(), now);
      return wb - wa;
    });
  } else if (sort === "newest") {
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else if (sort === "oldest") {
    filtered.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  } else if (sort === "longest") {
    filtered.sort((a, b) => b.durationSec - a.durationSec);
  } else if (sort === "shortest") {
    filtered.sort((a, b) => a.durationSec - b.durationSec);
  } else if (sort === "recent") {
    // Default — newest first (backward compat).
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else if (sort === "relevance") {
    // Relevance: for search queries, score by match quality + popularity.
    // If no query, fall back to recent.
    if (q) {
      filtered.sort((a, b) => {
        const scoreA = relevanceScore(a, q);
        const scoreB = relevanceScore(b, q);
        return scoreB - scoreA;
      });
    } else {
      filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
  } else {
    // Default — newest first.
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // For "ids" mode (history), keep the order of the provided ids.
  if (idsParam) {
    const idOrder = idsParam.split("|").filter(Boolean);
    filtered.sort(
      (a, b) => idOrder.indexOf(a.id) - idOrder.indexOf(b.id)
    );
  }

  // Apply pagination AFTER sort/filter.
  const paginated = filtered.slice(offset, offset + limit);

  return NextResponse.json({
    videos: paginated,
    total: filtered.length,
    limit,
    offset,
    hasMore: offset + limit < filtered.length,
  });
}

function scoreTrending(views: number, createdAt: number, now: number) {
  const daysOld = Math.max(1, (now - createdAt) / (1000 * 60 * 60 * 24));
  return views / Math.pow(daysOld, 0.6);
}

/**
 * Relevance score for search ranking (§12).
 * Scores by: title match > tag match > description match > channel match.
 * Weighted by popularity. Does NOT manipulate the query (§14).
 */
function relevanceScore(v: any, q: string): number {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  let score = 0;
  const title = (v.title || "").toLowerCase();
  const desc = (v.description || "").toLowerCase();
  const tags = (v.tags || "").toLowerCase();
  const channelName = (v.channel?.name || "").toLowerCase();
  const channelHandle = (v.channel?.handle || "").toLowerCase();

  for (const term of terms) {
    // Title match is strongest (10 pts).
    if (title.includes(term)) score += 10;
    // Tag match (5 pts).
    if (tags.includes(term)) score += 5;
    // Channel match (5 pts).
    if (channelName.includes(term) || channelHandle.includes(term)) score += 5;
    // Description match (2 pts — weaker).
    if (desc.includes(term)) score += 2;
  }
  // Popularity tiebreaker (log scale — doesn't overwhelm relevance).
  score += Math.log10(Math.max(1, v.views)) * 0.5;
  return score;
}
