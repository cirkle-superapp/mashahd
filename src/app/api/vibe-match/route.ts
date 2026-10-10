import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sanitizeUrl } from "@/lib/format";

/**
 * GET /api/vibe-match?vibe=Energetic&limit=20
 *
 * Finds videos with the same CIRKLE BRAIN-detected vibe label, across
 * ALL categories. This is "vibe matching" — a fundamentally different
 * recommendation strategy from YouTube's category/algorithm-based related
 * videos. A Gaming video and a Fitness video can both be "Energetic."
 *
 * The vibe label comes from the CIRKLE BRAIN's 5-provider consensus
 * (stored in the Video.aiVibe field, populated when the user first
 * clicks CIRKLE BRAIN Recap).
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const vibe = url.searchParams.get("vibe") || "";
  const limit = Math.min(parseInt(url.searchParams.get("limit") || "20", 10) || 20, 50);
  const excludeVideoId = url.searchParams.get("exclude") || "";

  if (!vibe) {
    return NextResponse.json({ error: "vibe parameter required (e.g. ?vibe=Energetic)" }, { status: 400 });
  }

  // Query videos where the AI vibe matches (case-insensitive).
  // The aiVibe field is populated by the CIRKLE BRAIN consensus.
  // If no videos have aiVibe set yet, fall back to category-based matching
  // using the CATEGORY_VIBES mapping.
  const videos = await db.video.findMany({
    where: {
      ...(excludeVideoId ? { id: { not: excludeVideoId } } : {}),
      OR: [
        { aiVibe: { contains: vibe, mode: "insensitive" } },
        // Fallback: match by category that typically has this vibe
        // (the CATEGORY_VIBES mapping in ai-summarize-consensus.ts)
        { category: { in: getCategoriesForVibe(vibe) } },
      ],
    },
    include: { channel: true },
    take: limit,
    orderBy: { views: "desc" },
  }).catch(() => []);

  // Sanitize URLs
  const sanitized = videos.map((v: any) => ({
    ...v,
    thumbnailUrl: v.thumbnailUrl ? sanitizeUrl(v.thumbnailUrl, v.title) : v.thumbnailUrl,
    channel: v.channel ? {
      ...v.channel,
      avatarUrl: v.channel.avatarUrl ? sanitizeUrl(v.channel.avatarUrl, v.channel.name) : v.channel.avatarUrl,
    } : v.channel,
  }));

  return NextResponse.json({
    vibe,
    videos: sanitized,
    count: sanitized.length,
    note: "Vibe matching finds videos with the same emotional signature, across all categories. Powered by the CIRKLE BRAIN consensus.",
  });
}

// Map vibes → categories (used as fallback when aiVibe isn't populated yet)
function getCategoriesForVibe(vibe: string): string[] {
  const VIBE_TO_CATEGORIES: Record<string, string[]> = {
    "Energetic": ["Gaming", "Fitness", "Music", "Cars"],
    "Intense": ["Gaming", "Fitness", "Cars"],
    "Triumphant": ["Gaming", "Fitness"],
    "Determined": ["Fitness", "Gaming", "Tech"],
    "Cozy": ["Food", "Music", "Art", "Travel"],
    "Calm": ["Nature", "Travel", "Music"],
    "Reflective": ["Travel", "Nature", "Art", "Science"],
    "Curious": ["Science", "Tech", "Nature", "Art"],
    "Awe": ["Nature", "Travel", "Science"],
    "Adventurous": ["Travel", "Nature", "Cars"],
  };
  return VIBE_TO_CATEGORIES[vibe] || [];
}
