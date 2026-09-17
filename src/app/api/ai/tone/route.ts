import { NextRequest, NextResponse } from "next/server";
import { aiChat } from "@/lib/ai-provider";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/ai/tone
 * Body: { text, tone }
 *
 * AI Tone Adjuster (adapted from CIRKLE's ai-tone-adjuster overlay). Rewrites
 * a viewer's draft comment in a different tone before they post it. Tones:
 * friendly, witty, formal, concise, enthusiastic. Falls back to the original
 * text if the LLM is unavailable.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`ai-tone:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — AI requests are limited to 10/min" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  const { text, tone } = await req.json().catch(
    () => ({ text: "", tone: "friendly" })
  );
  if (!text || !tone) {
    return NextResponse.json({ error: "text + tone required" }, { status: 400 });
  }
  const trimmed = String(text).slice(0, 500);

  const prompt = `Rewrite this comment in a ${tone} tone. Keep it under 120 characters. Preserve the core meaning. Respond with ONLY the rewritten comment, no quotes, no preamble.

Original: ${trimmed}`;

  // aiChat() returns source: "z-ai"|"groq"|"gemini"|"hf"|"fallback". Normalize
  // to the legacy "ai"|"fallback" values the client already checks against.
  const { text: raw, source: aiSource } = await aiChat({
    system: "You rewrite short comments in a given tone. You emit only the rewritten text.",
    user: prompt,
    maxTokens: 200,
    temperature: 0.7,
  });

  const rewritten = raw.trim().replace(/^"|"$/g, "");
  if (!rewritten) {
    console.error("[ai/tone] LLM returned empty rewrite, using original");
    return NextResponse.json({ ok: true, text: trimmed, source: "fallback" });
  }
  return NextResponse.json({
    ok: true,
    text: rewritten,
    source: aiSource === "fallback" ? "fallback" : "ai",
  });
}
