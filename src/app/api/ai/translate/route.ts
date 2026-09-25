import { NextRequest, NextResponse } from "next/server";
import { aiChat } from "@/lib/ai-provider";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/ai/translate
 * Body: { texts: string[], target: "en" | "ar" | "fr" | "es" | "zh" }
 *
 * Live Translate (adapted from CIRKLE's live-translate overlay). Translates
 * a batch of comment strings into the target language using the multi-provider
 * LLM abstraction. Uses a single prompt that asks for all translations at once
 * (preferred over per-item calls for efficiency). Returns translations in the
 * same order as the input. Falls back to the original text on failure so the
 * UI never breaks.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`ai-translate:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — AI requests are limited to 10/min" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  const { texts, target } = await req.json().catch(
    () => ({ texts: [] as string[], target: "en" })
  );
  const arr: string[] = Array.isArray(texts) ? texts.slice(0, 50) : [];
  const lang: string = target || "en";

  if (arr.length === 0) {
    return NextResponse.json({ ok: true, translations: [] });
  }

  const langNames: Record<string, string> = {
    en: "English",
    ar: "Arabic",
    fr: "French",
    es: "Spanish",
    zh: "Chinese (Simplified)",
  };
  const langName = langNames[lang] || "English";

  const numbered = arr.map((t, i) => `${i + 1}. ${t}`).join("\n");
  const prompt = `Translate each of the following ${arr.length} comments into ${langName}.
Preserve meaning and tone. Keep it natural and conversational.
Respond as a JSON object with an array "translations" of ${arr.length} strings, in the SAME ORDER as the input, no extra commentary.

Input:
${numbered}`;

  // aiChat() returns source from the 5-provider consensus: "groq"|"openrouter"|"nvidia"|"gemini"|"hf"|"fallback". Normalize
  // to the legacy "ai"|"fallback" values the client already checks against.
  const { text, source: aiSource } = await aiChat({
    system: "You are a professional translator. You emit valid JSON only.",
    user: prompt,
    maxTokens: Math.min(2000, 200 * arr.length + 200),
    temperature: 0.3,
  });

  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[ai/translate] no JSON in LLM response, using fallback");
    return NextResponse.json({
      ok: true,
      translations: arr.slice(),
      source: "fallback",
      target: lang,
    });
  }

  try {
    const parsed = JSON.parse(jsonMatch[0]) as { translations?: string[] };
    const translations = (parsed.translations || []).map((t) => String(t));
    // Pad/trim to match input length
    while (translations.length < arr.length) translations.push(arr[translations.length]);
    return NextResponse.json({
      ok: true,
      translations: translations.slice(0, arr.length),
      source: aiSource === "fallback" ? "fallback" : "ai",
      target: lang,
    });
  } catch (e) {
    console.error("[ai/translate] JSON parse failed, using fallback:", e);
    return NextResponse.json({
      ok: true,
      translations: arr.slice(),
      source: "fallback",
      target: lang,
    });
  }
}
