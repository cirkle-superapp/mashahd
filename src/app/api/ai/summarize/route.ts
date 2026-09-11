import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";

/**
 * POST /api/ai/summarize
 * Body: { videoId }
 *
 * AI Recap (adapted from CIRKLE's ai-recap overlay). Generates a concise
 * "recap" of a video — a 2-sentence TL;DR plus 3-4 key-takeaway bullets —
 * using the z-ai LLM. Falls back to a deterministic summary if the SDK is
 * unavailable.
 */
export async function POST(req: NextRequest) {
  const { videoId } = await req.json().catch(() => ({} as { videoId?: string }));
  if (!videoId) {
    return NextResponse.json({ error: "videoId required" }, { status: 400 });
  }
  const video = await db.video.findUnique({
    where: { id: videoId },
    include: { channel: true },
  });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const prompt = `You are an expert video editor's assistant. A viewer wants a quick recap of a video they're about to watch.

Title: ${video.title}
Channel: ${video.channel.name}
Category: ${video.category}
Duration: ${Math.floor(video.durationSec / 60)}m ${video.durationSec % 60}s
Views: ${video.views.toLocaleString()}
Description: ${video.description.slice(0, 800)}

Respond in EXACTLY this JSON shape (no markdown fences, no extra text):
{
  "tldr": "one or two sentences capturing what the video is about",
  "takeaways": ["key point 1", "key point 2", "key point 3"],
  "bestMoment": "the single most memorable moment a viewer should look out for",
  "vibe": "one-word mood label, e.g. Reflective, Energetic, Cozy, Curious"
}`;

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: "You produce tight, accurate video recaps in JSON." },
        { role: "user", content: prompt },
      ],
      thinking: { type: "disabled" },
    });
    const content = completion.choices[0]?.message?.content?.trim() || "";
    // Try to parse JSON; tolerate code fences.
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    const recap = jsonMatch
      ? JSON.parse(jsonMatch[0])
      : fallbackRecap(video.title, video.channel.name, video.category);
    return NextResponse.json({ ok: true, recap, source: "ai" });
  } catch (e) {
    console.error("[ai/summarize] LLM failed, using fallback:", e);
    return NextResponse.json({
      ok: true,
      recap: fallbackRecap(video.title, video.channel.name, video.category),
      source: "fallback",
    });
  }
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
