import { NextRequest, NextResponse } from "next/server";
import { aiChat } from "@/lib/ai-provider";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/ai/chapters
 * Body: { videoId }
 *
 * Smart Chapters (adapted from CIRKLE's smart-chapters overlay). Generates
 * 4-7 chapter segments with timestamps that the player can seek to. The LLM
 * is asked for JSON; we validate the shape and clamp timestamps to the
 * video duration. Falls back to evenly-spaced chapters if the SDK fails or
 * the response isn't valid JSON.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`ai-chapters:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — AI requests are limited to 10/min" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  const { videoId } = await req.json().catch(() => ({} as { videoId?: string }));
  if (!videoId) {
    return NextResponse.json({ error: "videoId required" }, { status: 400 });
  }
  const video = await db.video.findUnique({
    where: { id: videoId },
    select: {
      title: true,
      description: true,
      durationSec: true,
      category: true,
      tags: true,
    },
  });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const totalMin = Math.floor(video.durationSec / 60);
  const prompt = `You are an AI assistant that breaks a video into smart chapters.

Title: ${video.title}
Category: ${video.category}
Tags: ${video.tags.split("|").filter(Boolean).join(", ") || "none"}
Duration: ${totalMin}m ${video.durationSec % 60}s
Description: ${video.description.slice(0, 600)}

Generate 4-6 chapters that span the full video length. Respond in EXACTLY this JSON shape (no markdown, no prose):
{
  "chapters": [
    { "title": "short chapter title", "seconds": 0, "mood": "one-word mood", "summary": "one sentence of what happens" },
    { "title": "...", "seconds": 120, "mood": "...", "summary": "..." }
  ]
}
Rules:
- First chapter MUST start at seconds: 0.
- Last chapter MUST be before ${video.durationSec} seconds.
- Chapters must be in ascending order by seconds.
- Titles <= 40 chars. Summaries <= 100 chars.`;

  // aiChat() returns source: "z-ai"|"groq"|"gemini"|"hf"|"fallback". Normalize
  // to the legacy "ai"|"fallback" values the client already checks against.
  const { text, source: aiSource } = await aiChat({
    system: "You emit valid JSON only — no markdown fences, no prose.",
    user: prompt,
    maxTokens: 900,
    temperature: 0.7,
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let chapters: ReturnType<typeof fallbackChapters> | null = null;
  let source: "ai" | "fallback" = aiSource === "fallback" ? "fallback" : "ai";
  if (jsonMatch) {
    try {
      const parsed = JSON.parse(jsonMatch[0]) as { chapters?: Array<Record<string, unknown>> };
      const built = (parsed.chapters || [])
        .map((c) => ({
          title: String(c.title || "Chapter").slice(0, 60),
          seconds: Math.max(0, Math.min(video.durationSec - 5, Number(c.seconds) || 0)),
          mood: String(c.mood || "—").slice(0, 24),
          summary: String(c.summary || "").slice(0, 140),
        }))
        .sort((a, b) => a.seconds - b.seconds)
        .slice(0, 7);
      // Ensure the first chapter starts at 0
      if (built.length && built[0].seconds !== 0) built[0].seconds = 0;
      if (built.length >= 3) {
        chapters = built;
        source = aiSource === "fallback" ? "fallback" : "ai";
      } else {
        throw new Error("too few chapters");
      }
    } catch (e) {
      console.error("[ai/chapters] JSON parse/validate failed, using fallback:", e);
      chapters = null;
    }
  } else {
    console.error("[ai/chapters] no JSON in LLM response, using fallback");
  }

  if (!chapters) {
    chapters = fallbackChapters(video.title, video.durationSec);
    source = "fallback";
  }
  return NextResponse.json({ ok: true, chapters, source });
}

function fallbackChapters(title: string, durationSec: number) {
  const labels = ["Opening", "Setup", "Deep dive", "Highlights", "Closing thoughts"];
  const n = Math.min(5, Math.max(4, Math.floor(durationSec / 120) + 2));
  const step = Math.floor(durationSec / n);
  return Array.from({ length: n }).map((_, i) => ({
    title: labels[i] || `Part ${i + 1}`,
    seconds: i * step,
    mood: i === 0 ? "Intro" : i === n - 1 ? "Reflective" : "Focused",
    summary: i === 0
      ? `Welcome — ${title.slice(0, 80)}`
      : `Chapter ${i + 1} of this ${Math.floor(durationSec / 60)}-minute video.`,
  }));
}
