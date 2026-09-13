import { NextRequest, NextResponse } from "next/server";
import { aiChat } from "@/lib/ai-provider";
import { db } from "@/lib/db";

/**
 * POST /api/ai/oracle
 * Body: { videoId, question }
 *
 * Cirkle Oracle (adapted from CIRKLE's cirkle-oracle overlay). Answers a
 * viewer's question about the video they're watching, grounded in the
 * video's title, description, tags, and category. Falls back to a generic
 * acknowledgment if the LLM is unavailable.
 */
export async function POST(req: NextRequest) {
  const { videoId, question } = await req.json().catch(
    () => ({ videoId: "", question: "" })
  );
  if (!videoId || !question) {
    return NextResponse.json({ error: "videoId + question required" }, { status: 400 });
  }
  const video = await db.video.findUnique({
    where: { id: videoId },
  });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }
  // Fetch the channel separately (the turso-db wrapper doesn't populate
  // nested includes reliably across all code paths).
  const channel = video.channelId
    ? await db.channel.findUnique({ where: { id: video.channelId } })
    : null;
  const channelName = (channel as any)?.name || "Unknown";

  const prompt = `You are the Mashahd Oracle — a knowledgeable assistant that answers questions about a video the viewer is watching. Ground your answer in the video's metadata below; if the question can't be answered from that, say so honestly and offer a related tangent.

Title: ${video.title}
Channel: ${channelName}
Category: ${video.category}
Tags: ${(video.tags || "").split("|").filter(Boolean).join(", ") || "none"}
Description: ${(video.description || "").slice(0, 700)}

Viewer question: ${question}

Answer in 2-4 sentences, conversational, no markdown headers.`;

  // aiChat() returns source: "z-ai"|"groq"|"gemini"|"hf"|"fallback". Normalize
  // to the legacy "ai"|"fallback" values the client already checks against.
  const { text, source: aiSource } = await aiChat({
    system: "You are the Mashahd Oracle — concise, helpful, honest.",
    user: prompt,
    maxTokens: 400,
    temperature: 0.7,
  });

  const answer = text.trim();
  if (!answer) {
    console.error("[ai/oracle] LLM returned empty answer, using fallback");
    return NextResponse.json({
      ok: true,
      answer: `Great question. Based on "${video.title}", I'd suggest watching the full video — the answer usually unfolds in the second half. (The Oracle is offline right now, so this is a fallback reply.)`,
      source: "fallback",
    });
  }
  return NextResponse.json({
    ok: true,
    answer,
    source: aiSource === "fallback" ? "fallback" : "ai",
  });
}
