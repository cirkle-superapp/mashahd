import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiChat } from "@/lib/ai-provider";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/videos/[id]/knowledge-graph
 *
 * Pulled from CIRKLE Mashahd — knowledge graph sidebar.
 * Uses AI to extract people, places, and sources mentioned in the video.
 * Returns a structured knowledge graph overlay for the watch view.
 *
 * Per spec §65: "For factual/current content where appropriate, provide:
 * publication date, update date, creator-provided sources, corrections, provenance."
 */

interface GraphNode {
  kind: "person" | "place" | "source";
  name: string;
  hint?: string;
}

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`knowledge-graph:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  try {
    const video = await db.video.findUnique({
      where: { id },
      select: { id: true, title: true, description: true, tags: true, category: true },
    });
    if (!video) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    // Try AI extraction of knowledge graph nodes.
    try {
      const result = await aiChat({
        system: `You are a knowledge graph extractor. Given a video's title, description, and tags, extract the people, places, and sources mentioned. Return ONLY a JSON array of objects: [{"kind": "person" | "place" | "source", "name": "string", "hint": "optional context"}]. No other text. If nothing is found, return [].`,
        user: `Title: ${video.title}\nDescription: ${video.description.slice(0, 500)}\nTags: ${video.tags}\nCategory: ${video.category}`,
        maxTokens: 300,
      });

      const jsonMatch = result.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const nodes: GraphNode[] = JSON.parse(jsonMatch[0]);
        return NextResponse.json({
          nodes,
          source: result.source === "fallback" ? "deterministic" : result.source,
        });
      }
    } catch { /* AI failed */ }

    // Deterministic fallback: extract from tags + description.
    const nodes: GraphNode[] = [];
    const tags = video.tags.split("|").filter(Boolean);
    for (const tag of tags.slice(0, 5)) {
      // Heuristic: capitalized tags are likely people or places.
      if (tag[0] === tag[0].toUpperCase() && tag.length > 2) {
        nodes.push({ kind: "source", name: tag, hint: "from video tags" });
      }
    }
    // Extract URLs from description as sources.
    const urls = video.description.match(/https?:\/\/[^\s)]+/g) || [];
    for (const url of urls.slice(0, 3)) {
      nodes.push({ kind: "source", name: url.slice(0, 60), hint: "from description" });
    }

    return NextResponse.json({
      nodes: nodes.slice(0, 6),
      source: "deterministic",
    });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
