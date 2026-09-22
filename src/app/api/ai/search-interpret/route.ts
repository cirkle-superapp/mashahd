import { NextRequest, NextResponse } from "next/server";
import { aiChat } from "@/lib/ai-provider";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";
import { sanitizeUserInput, boundUserInput } from "@/lib/ai-prompt-security";

/**
 * POST /api/ai/search-interpret
 * Body: { query }
 *
 * AI Smart Search — intent detection (Pass 71).
 *
 * When a user searches for something like "cozy winter vibes" or "videos
 * that make me feel inspired", the AI interprets the intent and returns:
 *   - interpretation: a short explanation of what the user is looking for
 *   - keywords: search terms the backend can use to find matching videos
 *   - categories: suggested categories to browse
 *
 * This is unique to Mashahd — YouTube's search is keyword-only. Our AI
 * understands the FEELING behind the search, not just the words.
 *
 * If the AI is unavailable, returns null (the frontend falls back to
 * the standard keyword search).
 */

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`ai-search-interpret:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — max 10 interpretations per minute" },
      { status: 429, headers: { "Retry-After": "60" } },
    );
  }

  const body = await req.json().catch(() => ({}));
  const query: string = body.query || "";
  if (!query || query.trim().length < 2) {
    return NextResponse.json({ ok: false, interpretation: null });
  }

  // Sanitize the query for prompt injection defense.
  const { sanitized: safeQuery } = sanitizeUserInput(query, 500);

  const prompt = `You are the Mashahd AI Search Interpreter. A user searched for: "${safeQuery}"

Your job: interpret the user's intent and suggest better search terms.

Respond as a JSON object (no markdown, no code fences):
{
  "interpretation": "one-sentence explanation of what the user wants",
  "keywords": "pipe-separated keywords for the video search API",
  "categories": ["suggested category 1", "suggested category 2"]
}

Rules:
- If the query is already a clear keyword (e.g., "next.js tutorial"), return the same keywords.
- If the query is a vibe/mood/feeling (e.g., "cozy winter vibes"), translate it into concrete search terms.
- Keywords should be things that would appear in video titles or tags.
- Categories should be from: Tech, Music, Gaming, Cooking, Travel, Fitness, Art, Science, Nature, Cars.
- Keep interpretation under 100 characters.
- Maximum 5 keywords, 3 categories.
Respond with ONLY the JSON object.`;

  try {
    const { text, source } = await aiChat({
      system: "You are a search intent interpreter. You output only JSON.",
      user: prompt,
      maxTokens: 200,
      temperature: 0.3,
    });

    // Parse the AI response as JSON.
    let parsed: any = null;
    try {
      // Strip any markdown code fences if present.
      const clean = text.replace(/```json\n?/g, "").replace(/```\n?/g, "").trim();
      parsed = JSON.parse(clean);
    } catch {
      // AI didn't return valid JSON — return null (frontend falls back).
      return NextResponse.json({ ok: true, interpretation: null, source });
    }

    return NextResponse.json({
      ok: true,
      interpretation: {
        interpretation: String(parsed.interpretation || "").slice(0, 200),
        keywords: String(parsed.keywords || "").slice(0, 500),
        categories: Array.isArray(parsed.categories)
          ? parsed.categories.slice(0, 3).map((c: string) => String(c).slice(0, 50))
          : [],
      },
      source,
    });
  } catch {
    // AI unavailable — return null (frontend uses standard search).
    return NextResponse.json({ ok: true, interpretation: null, source: "fallback" });
  }
}
