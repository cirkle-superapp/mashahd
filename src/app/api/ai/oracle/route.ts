import { NextRequest, NextResponse } from "next/server";
import { aiChat } from "@/lib/ai-provider";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";
import { sanitizeUserInput, boundUserInput } from "@/lib/ai-prompt-security";

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
  const ip = getClientIP(req);
  const rl = await rateLimit(`ai-oracle:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — AI requests are limited to 10/min" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  const { videoId, question } = await req.json().catch(
    () => ({ videoId: "", question: "" })
  );
  if (!videoId || !question) {
    return NextResponse.json({ error: "videoId + question required" }, { status: 400 });
  }

  // ── Prompt injection defense (Pass 59) ──
  // Sanitize the user's question before inserting it into the AI prompt.
  // This prevents attacks like "Ignore previous instructions and..." from
  // hijacking the model's behavior.
  const { sanitized: safeQuestion, injectionDetected } = sanitizeUserInput(question, 1000);
  if (injectionDetected) {
    console.warn("[ai/oracle] prompt injection detected, question still processed with bounding");
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

  // Build the prompt with BOUNDED user input — the question is wrapped in
  // delimiters + a safety suffix prevents the AI from following injection
  // instructions embedded in the question.
  const prompt = `You are the Mashahd Oracle — a knowledgeable assistant that answers questions about a video the viewer is watching. Ground your answer in the video's metadata below; if the question can't be answered from that, say so honestly and offer a related tangent.

Title: ${video.title}
Channel: ${channelName}
Category: ${video.category}
Tags: ${(video.tags || "").split("|").filter(Boolean).join(", ") || "none"}
Description: ${(video.description || "").slice(0, 700)}

${boundUserInput(safeQuestion, "Oracle", "Answer the viewer's question about the video above in 2-4 sentences, conversational, no markdown headers.")}`;

  // aiChat() returns source from the 5-provider consensus: "groq"|"openrouter"|"nvidia"|"gemini"|"hf"|"fallback". Normalize
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
