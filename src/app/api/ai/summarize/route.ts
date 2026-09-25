import { NextRequest, NextResponse } from "next/server";
import { aiChat } from "@/lib/ai-provider";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/ai/summarize
 * Body: { videoId }
 *
 * AI Recap (adapted from CIRKLE's ai-recap overlay). Generates a concise
 * "recap" of a video — a 2-sentence TL;DR plus 3-4 key-takeaway bullets —
 * using the 5-provider consensus LLM abstraction (Groq + OpenRouter +
 * NVIDIA + Gemini + HuggingFace, fired in parallel; longest non-empty
 * response wins). Falls back to a deterministic summary if every
 * provider fails or the response isn't valid JSON.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`ai-summarize:${ip}`, 10, 60_000);
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
  });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }
  const channel = video.channelId
    ? await db.channel.findUnique({ where: { id: video.channelId } })
    : null;
  const channelName = (channel as any)?.name || "Unknown";

  const prompt = `You are an expert video editor's assistant. A viewer wants a quick recap of a video they're about to watch.

Title: ${video.title}
Channel: ${channelName}
Category: ${video.category}
Duration: ${Math.floor(video.durationSec / 60)}m ${video.durationSec % 60}s
Views: ${video.views.toLocaleString()}
Description: ${(video.description || "").slice(0, 800)}

Respond in EXACTLY this JSON shape (no markdown fences, no extra text):
{
  "tldr": "one or two sentences capturing what the video is about",
  "takeaways": ["key point 1", "key point 2", "key point 3"],
  "bestMoment": "the single most memorable moment a viewer should look out for",
  "vibe": "one-word mood label, e.g. Reflective, Energetic, Cozy, Curious"
}`;

  // aiChat() returns source from the 5-provider consensus: "groq"|"openrouter"|"nvidia"|"gemini"|"hf"|"fallback". Normalize
  // to the legacy "ai"|"fallback" values the client already checks against.
  const { text, source: aiSource } = await aiChat({
    system: "You produce tight, accurate video recaps in JSON.",
    user: prompt,
    maxTokens: 800,
    temperature: 0.7,
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  let recap;
  let source: "ai" | "fallback";
  if (jsonMatch) {
    try {
      recap = JSON.parse(jsonMatch[0]);
      source = aiSource === "fallback" ? "fallback" : "ai";
    } catch (e) {
      console.error("[ai/summarize] JSON parse failed, using fallback:", e);
      recap = fallbackRecap(video.title, channelName, video.category);
      source = "fallback";
    }
  } else {
    console.error("[ai/summarize] no JSON in LLM response, using fallback");
    recap = fallbackRecap(video.title, channelName, video.category);
    source = "fallback";
  }
  return NextResponse.json({ ok: true, recap, source });
}

function fallbackRecap(title: string, channel: string, category: string) {
  return {
    tldr: `"${title}" by ${channel} — a ${category.toLowerCase()} pick worth your next coffee break.`,
    takeaways: [
      `A ${category.toLowerCase()} video from ${channel}.`,
      "Watch for the practical tips sprinkled throughout.",
      "Great production quality and a steady pace.",
    ],
    bestMoment: "The payoff in the second half — don't skip ahead.",
    vibe: "Curious",
  };
}
