import { NextRequest, NextResponse } from "next/server";
import { aiChat } from "@/lib/ai-provider";
import { db } from "@/lib/db";

/**
 * POST /api/ai/starters
 * Body: { videoId }
 *
 * AI Conversation Starters (adapted from CIRKLE's ai-conversation-starters
 * overlay). Generates 4 comment-style conversation starters tailored to the
 * video, so a viewer who doesn't know what to say has a springboard. Falls
 * back to a deterministic set if the LLM is unavailable.
 */
export async function POST(req: NextRequest) {
  const { videoId } = await req.json().catch(() => ({ videoId: "" }));
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

  const prompt = `You write conversation-starting comments for a video platform. A viewer is watching this video and wants something to say.

Title: ${video.title}
Channel: ${channelName}
Category: ${video.category}
Description: ${(video.description || "").slice(0, 500)}

Generate exactly 4 short comment-style conversation starters (each <= 120 chars). They should range in tone: one curious question, one genuine compliment, one hot take, one relatable observation. No emojis, no quotes, no numbering — just the raw text, one per line.

Respond with EXACTLY 4 lines, nothing else.`;

  // aiChat() returns source: "z-ai"|"groq"|"gemini"|"hf"|"fallback". Normalize
  // to the legacy "ai"|"fallback" values the client already checks against.
  const { text, source: aiSource } = await aiChat({
    system: "You emit exactly 4 short lines, no preamble, no numbering.",
    user: prompt,
    maxTokens: 300,
    temperature: 0.8,
  });

  const starters = text
    .split("\n")
    .map((s) => s.replace(/^\d+[\).\s-]*/, "").trim().replace(/^"|"$/g, ""))
    .filter((s) => s.length > 0 && s.length <= 200)
    .slice(0, 4);

  if (starters.length < 3) {
    console.error("[ai/starters] LLM returned too few starters, using fallback");
    return NextResponse.json({
      ok: true,
      starters: fallbackStarters(video.title, video.category),
      source: "fallback",
    });
  }
  return NextResponse.json({
    ok: true,
    starters,
    source: aiSource === "fallback" ? "fallback" : "ai",
  });
}

function fallbackStarters(title: string, category: string): string[] {
  return [
    `What was the moment that surprised you most in this ${category.toLowerCase()} video?`,
    `The pacing here is genuinely good — rare for the category.`,
    `Hot take: this deserves way more views than it has.`,
    `Anyone else watching this twice? The second watch hits different.`,
  ];
}
