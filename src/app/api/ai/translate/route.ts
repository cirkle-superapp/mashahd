import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";

/**
 * POST /api/ai/translate
 * Body: { texts: string[], target: "en" | "ar" | "fr" | "es" | "zh" }
 *
 * Live Translate (adapted from CIRKLE's live-translate overlay). Translates
 * a batch of comment strings into the target language using the z-ai LLM.
 * Returns translations in the same order as the input. Falls back to the
 * original text on failure so the UI never breaks.
 */
export async function POST(req: NextRequest) {
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

  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: "You are a professional translator. You emit valid JSON only." },
        { role: "user", content: prompt },
      ],
      thinking: { type: "disabled" },
    });
    const content = completion.choices[0]?.message?.content?.trim() || "";
    const jsonMatch = content.match(/\{[\s\S]*\}/);
    if (!jsonMatch) throw new Error("no JSON in response");
    const parsed = JSON.parse(jsonMatch[0]) as { translations?: string[] };
    const translations = (parsed.translations || []).map((t) => String(t));
    // Pad/trim to match input length
    while (translations.length < arr.length) translations.push(arr[translations.length]);
    return NextResponse.json({
      ok: true,
      translations: translations.slice(0, arr.length),
      source: "ai",
      target: lang,
    });
  } catch (e) {
    console.error("[ai/translate] LLM failed, using fallback:", e);
    return NextResponse.json({
      ok: true,
      translations: arr.slice(),
      source: "fallback",
      target: lang,
    });
  }
}
