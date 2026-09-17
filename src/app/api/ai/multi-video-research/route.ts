import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiChat } from "@/lib/ai-provider";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/ai/multi-video-research
 * Body: { videoIds: string[], operation: string }
 *
 * Per spec §40: "Allow users to select multiple videos and ask Mashahd AI to:
 * compare, summarize, identify agreements, identify differences, organize
 * claims, surface referenced sources, identify contradictions.
 * Do not manufacture consensus."
 *
 * Operations:
 *   - compare: compare the videos on key points
 *   - summarize: combined summary across all videos
 *   - agreements: identify where the videos agree
 *   - differences: identify where the videos differ
 *   - contradictions: identify direct contradictions
 *   - sources: surface referenced sources across all videos
 *   - organize: organize claims by topic
 *
 * Uses AI to analyze the videos' titles + descriptions. Falls back to a
 * deterministic summary if AI is unavailable.
 */

const VALID_OPS = ["compare", "summarize", "agreements", "differences", "contradictions", "sources", "organize"];

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`multi-research:${ip}`, 5, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await req.json().catch(() => ({}));
  const videoIds: string[] = Array.isArray(body.videoIds) ? body.videoIds.slice(0, 10) : [];
  const operation: string = body.operation || "";

  if (videoIds.length < 2) {
    return NextResponse.json({ error: "at least 2 videoIds required" }, { status: 400 });
  }
  if (!VALID_OPS.includes(operation)) {
    return NextResponse.json({ error: `invalid operation. valid: ${VALID_OPS.join(", ")}` }, { status: 400 });
  }

  // Fetch the videos.
  const videos = await db.video.findMany({
    where: { id: { in: videoIds } },
    include: { channel: true },
  });

  if (videos.length < 2) {
    return NextResponse.json({ error: "at least 2 valid videos required" }, { status: 400 });
  }

  // Build the context for the AI.
  const videoContext = videos.map((v: any, i: number) =>
    `Video ${i + 1}: "${v.title}" by ${v.channel.name}\n  Description: ${v.description.slice(0, 300)}\n  Category: ${v.category}\n  Tags: ${v.tags}`
  ).join("\n\n");

  // Build the prompt based on the operation.
  const prompts: Record<string, { system: string; user: string }> = {
    compare: {
      system: "You are a research assistant. Compare the following videos on their key points, perspectives, and approaches. Return a structured comparison. Do not manufacture consensus — if the videos disagree, state the disagreement clearly.",
      user: `Compare these ${videos.length} videos:\n\n${videoContext}\n\nProvide a structured comparison of their key points, perspectives, and approaches.`,
    },
    summarize: {
      system: "You are a research assistant. Provide a combined summary of the following videos. Highlight what they collectively cover. Do not manufacture consensus.",
      user: `Summarize these ${videos.length} videos collectively:\n\n${videoContext}\n\nProvide a combined summary highlighting what they collectively cover.`,
    },
    agreements: {
      system: "You are a research assistant. Identify where the following videos agree. Only list points where multiple videos explicitly support the same conclusion. Do not manufacture consensus.",
      user: `Identify agreements across these ${videos.length} videos:\n\n${videoContext}\n\nList only points where multiple videos explicitly agree.`,
    },
    differences: {
      system: "You are a research assistant. Identify where the following videos differ in their approaches, perspectives, or conclusions.",
      user: `Identify differences across these ${videos.length} videos:\n\n${videoContext}\n\nList where they differ in approach, perspective, or conclusions.`,
    },
    contradictions: {
      system: "You are a research assistant. Identify direct contradictions between the following videos. Only list points where one video directly contradicts another. Do not infer contradictions that aren't explicit.",
      user: `Identify direct contradictions across these ${videos.length} videos:\n\n${videoContext}\n\nList only explicit contradictions, not inferred ones.`,
    },
    sources: {
      system: "You are a research assistant. Surface referenced sources across the following videos. List any sources, citations, or references mentioned.",
      user: `Surface referenced sources across these ${videos.length} videos:\n\n${videoContext}\n\nList any sources, citations, or references mentioned.`,
    },
    organize: {
      system: "You are a research assistant. Organize the claims from the following videos by topic. Group related claims together.",
      user: `Organize claims from these ${videos.length} videos by topic:\n\n${videoContext}\n\nGroup related claims by topic.`,
    },
  };

  const prompt = prompts[operation];

  // Try AI.
  try {
    const result = await aiChat({
      system: prompt.system,
      user: prompt.user,
      maxTokens: 1000,
    });

    if (result.text && result.text.length > 10) {
      return NextResponse.json({
        operation,
        videoIds: videos.map((v: any) => v.id),
        videoTitles: videos.map((v: any) => ({ id: v.id, title: v.title, channel: v.channel.name })),
        result: result.text,
        source: result.source === "fallback" ? "deterministic-fallback" : result.source,
        disclaimer: "This is an AI-generated analysis. Distinguish source-derived information from AI interpretation. Do not treat AI output as a factual guarantee.",
      });
    }
  } catch { /* fall through to deterministic */ }

  // Deterministic fallback.
  const fallbackResult = `## ${operation.charAt(0).toUpperCase() + operation.slice(1)} across ${videos.length} videos\n\n` +
    videos.map((v: any, i: number) => `${i + 1}. "${v.title}" by ${v.channel.name} — ${v.description.slice(0, 200)}`).join("\n\n");

  return NextResponse.json({
    operation,
    videoIds: videos.map((v: any) => v.id),
    videoTitles: videos.map((v: any) => ({ id: v.id, title: v.title, channel: v.channel.name })),
    result: fallbackResult,
    source: "deterministic-fallback",
    disclaimer: "AI analysis was unavailable. This is a deterministic listing of the selected videos.",
  });
}
