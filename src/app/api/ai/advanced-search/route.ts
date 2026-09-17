import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/ai/advanced-search
 * Body: { query: string }
 *
 * Per spec §13: "Implement natural-language filtering such as:
 * 'Show videos about logistics uploaded in Egypt during the last 30 days,
 * longer than 15 minutes, excluding Shorts.'
 * The search parser should transform natural language into structured filters."
 *
 * This endpoint parses a natural-language query into structured filters,
 * then applies them to the video database. It supports:
 *   - Topic/subject extraction ("videos about logistics")
 *   - Duration filters ("longer than 15 minutes", "shorter than 5 min")
 *   - Date filters ("last 30 days", "this week", "today")
 *   - Format exclusion ("excluding Shorts")
 *   - Category inference (maps keywords to categories)
 *
 * Falls back to standard keyword search if parsing fails.
 */

interface ParsedFilters {
  topic: string;
  categories: string[];
  minDuration?: number; // seconds
  maxDuration?: number; // seconds
  dateRange?: "today" | "7d" | "30d" | "90d" | "all";
  excludeShorts: boolean;
  excludeLong: boolean;
}

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`adv-search:${ip}`, 20, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await req.json().catch(() => ({}));
  const query: string = (body.query || "").slice(0, 500);
  if (!query) {
    return NextResponse.json({ error: "query required" }, { status: 400 });
  }

  // Parse the natural-language query into structured filters.
  const filters = parseQuery(query.toLowerCase());

  // Build the database query.
  const where: any = {};

  // Topic search (in title + description + tags).
  if (filters.topic) {
    const terms = filters.topic.split(/\s+/).filter(Boolean);
    // We'll filter client-side after fetching since SQLite doesn't have full-text search.
  }

  // Category filter.
  if (filters.categories.length > 0) {
    where.category = { in: filters.categories };
  }

  // Date range filter.
  if (filters.dateRange && filters.dateRange !== "all") {
    const days = filters.dateRange === "today" ? 1 : parseInt(filters.dateRange);
    const since = new Date(Date.now() - days * 86400000);
    where.createdAt = { gte: since };
  }

  // Fetch candidates.
  let videos = await db.video.findMany({
    where,
    include: { channel: true },
    take: 200,
    orderBy: { createdAt: "desc" },
  });

  // Apply duration filters.
  if (filters.minDuration !== undefined) {
    videos = videos.filter((v: any) => v.durationSec >= filters.minDuration!);
  }
  if (filters.maxDuration !== undefined) {
    videos = videos.filter((v: any) => v.durationSec <= filters.maxDuration!);
  }

  // Exclude Shorts (videos under 60s).
  if (filters.excludeShorts) {
    videos = videos.filter((v: any) => v.durationSec >= 60);
  }
  // Exclude long-form.
  if (filters.excludeLong) {
    videos = videos.filter((v: any) => v.durationSec <= 600);
  }

  // Apply topic search (client-side substring matching).
  if (filters.topic) {
    const terms = filters.topic.split(/\s+/).filter(Boolean);
    videos = videos.filter((v: any) => {
      const hay = (v.title + " " + v.description + " " + v.tags + " " + v.category).toLowerCase();
      return terms.every((term: string) => hay.includes(term));
    });
  }

  return NextResponse.json({
    query,
    parsedFilters: filters,
    videos: videos.slice(0, 50),
    count: videos.length,
    note: "Natural-language search parsed into structured filters. Duration/date filters are applied server-side; topic matching is client-side substring.",
  });
}

/**
 * Parse a natural-language query into structured filters.
 */
function parseQuery(q: string): ParsedFilters {
  const filters: ParsedFilters = {
    topic: "",
    categories: [],
    excludeShorts: false,
    excludeLong: false,
  };

  // Extract topic: "videos about X" or "videos on X" or "show X".
  const topicMatch = q.match(/(?:videos?\s+(?:about|on|for|showing)|show\s+)\s*(.+?)(?:\s+(?:uploaded|in|during|last|longer|shorter|excluding|from|over|under|this)|$)/);
  if (topicMatch) {
    filters.topic = topicMatch[1].trim();
  } else {
    // If no pattern, treat the whole query as a topic.
    filters.topic = q.replace(/(?:uploaded|in|during|last|longer|shorter|excluding|from|over|under|this|days?|minutes?|hours?|week|month|year|today|shorts?|long)\s*/g, "").trim();
  }

  // Duration filters.
  // "longer than 15 minutes" or "over 15 min" or "longer than 5 min"
  const longMatch = q.match(/(?:longer than|over|more than)\s+(\d+)\s*(?:min|minutes?|m)/);
  if (longMatch) {
    filters.minDuration = parseInt(longMatch[1]) * 60;
  }
  // "shorter than 5 minutes" or "under 5 min" or "less than 10 min"
  const shortMatch = q.match(/(?:shorter than|under|less than)\s+(\d+)\s*(?:min|minutes?|m)/);
  if (shortMatch) {
    filters.maxDuration = parseInt(shortMatch[1]) * 60;
  }

  // Date range filters.
  if (q.includes("today")) {
    filters.dateRange = "today";
  } else if (q.includes("this week") || q.includes("last 7 days") || q.includes("7 days")) {
    filters.dateRange = "7d";
  } else if (q.includes("last 30 days") || q.includes("30 days") || q.includes("this month")) {
    filters.dateRange = "30d";
  } else if (q.includes("last 90 days") || q.includes("90 days") || q.includes("last 3 months")) {
    filters.dateRange = "90d";
  }

  // Exclude Shorts.
  if (q.includes("excluding shorts") || q.includes("no shorts") || q.includes("without shorts")) {
    filters.excludeShorts = true;
  }

  // Category inference (map keywords to categories).
  const CATEGORY_KEYWORDS: Record<string, string[]> = {
    "Music": ["music", "song", "album", "concert", "lofi", "beats"],
    "Gaming": ["game", "gaming", "gameplay", "elden ring", "boss fight"],
    "Tech": ["tech", "technology", "programming", "typescript", "code", "ai", "software"],
    "Cooking": ["cooking", "recipe", "food", "ramen", "pasta", "kitchen"],
    "Science": ["science", "physics", "chemistry", "biology", "space", "research"],
    "Nature": ["nature", "wildlife", "animals", "gorilla", "mountain", "ocean"],
    "Travel": ["travel", "kyoto", "city", "trip", "adventure"],
    "Fitness": ["fitness", "workout", "gym", "exercise", "running"],
    "Art": ["art", "painting", "drawing", "design", "creative"],
    "Cars": ["cars", "car", "driving", "automotive"],
  };
  for (const [category, keywords] of Object.entries(CATEGORY_KEYWORDS)) {
    if (keywords.some((kw) => q.includes(kw))) {
      filters.categories.push(category);
    }
  }

  return filters;
}
