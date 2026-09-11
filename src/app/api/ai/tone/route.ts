import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

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
  const { text, tone } = await req.json().catch(
    () => ({ text: "", tone: "friendly" })
  );
  if (!text || !tone) {
    return NextResponse.json({ error: "text + tone required" }, { status: 400 });
  }
  const trimmed = String(text).slice(0, 500);

  const prompt = `Rewrite this comment in a ${tone} tone. Keep it under 120 characters. Preserve the core meaning. Respond with ONLY the rewritten comment, no quotes, no preamble.

Original: ${trimmed}`;

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: "You rewrite short comments in a given tone. You emit only the rewritten text." },
        { role: "user", content: prompt },
      ],
      thinking: { type: "disabled" },
    });
    const rewritten = completion.choices[0]?.message?.content?.trim().replace(/^"|"$/g, "") || "";
    if (!rewritten) throw new Error("empty rewrite");
    return NextResponse.json({ ok: true, text: rewritten, source: "ai" });
  } catch (e) {
    console.error("[ai/tone] LLM failed:", e);
    return NextResponse.json({ ok: true, text: trimmed, source: "fallback" });
  }
}
