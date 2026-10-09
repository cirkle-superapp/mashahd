/**
 * aiSummarizeConsensus — State-of-Art Ensemble Fusion Consensus (Pass 91).
 *
 * Per user request: "make ai summarise the videos in state of art consensus way."
 *
 * The existing aiChat() returns only the longest non-empty response — a poor
 * proxy for "best". For true state-of-art consensus, we use ENSEMBLE FUSION:
 * generate 5 summaries in parallel (one per AI provider), then SYNTHESIZE a
 * best-of-all response by combining the strongest elements from each.
 *
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ STAGE 1: Parallel generation (5 providers fire simultaneously)       │
 * │   Groq → response A    OpenRouter → response B    NVIDIA → response C│
 * │   Gemini → response D  HuggingFace → response E                    │
 * └──────────────────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ STAGE 2: Structural validation + scoring                              │
 * │   For each response:                                                  │
 * │     - Parse as JSON (valid? has tldr/takeaways/bestMoment/vibe?)     │
 * │     - Score: TL;DR length (sweet spot 50-250 chars),                 │
 * │              takeaways count (3-5 ideal),                             │
 * │              best moment specificity (mentions timestamp/action),    │
 * │              vibe appropriateness (single word, matches category)    │
 * └──────────────────────────────────────────────────────────────────────┘
 *                              │
 *                              ▼
 * ┌──────────────────────────────────────────────────────────────────────┐
 * │ STAGE 3: Ensemble Fusion synthesis                                    │
 * │   - TL;DR: longest (most informative) response                       │
 * │   - Takeaways: union of all unique takeaways, deduplicated,          │
 * │     top 3-4 by cross-provider frequency (most providers agreed)     │
 * │   - Best Moment: most specific (mentions a number, timestamp,       │
 * │     or concrete action)                                              │
 * │   - Vibe: majority vote across all valid responses                   │
 * │   - Confidence: how many providers agreed on the vibe (5/5=high)    │
 * └──────────────────────────────────────────────────────────────────────┘
 *
 * WHY THIS IS STATE-OF-ART (creative + out-of-box + realistic):
 *   - Not just "pick the longest" — synthesizes the best elements from each
 *   - Majority vote on vibe = robust against any single provider's quirk
 *   - Union of takeaways = richer information than any single response
 *   - Confidence score surfaces when providers disagreed (low confidence)
 *   - All 5 providers fire in parallel — no extra latency vs single-call
 *   - Falls back to deterministic if all 5 fail (every AI feature always returns something)
 *
 * USAGE:
 *   import { aiSummarizeConsensus } from "@/lib/ai-summarize-consensus";
 *   const result = await aiSummarizeConsensus({
 *     videoTitle: "Elden Ring — Final Boss, No-Hit Run",
 *     videoDescription: "1,200 attempts to defeat the final boss without taking damage.",
 *     videoCategory: "Gaming",
 *     channelName: "Apex Gaming",
 *     durationSec: 596,
 *   });
 *   // result = {
 *   //   recap: { tldr, takeaways, bestMoment, vibe },
 *   //   source: "consensus",
 *   //   sources: ["groq", "openrouter", "nvidia", "gemini", "hf"],
 *   //   confidence: 0.8,  // 4/5 providers agreed on the vibe
 *   //   providerCount: 5,  // how many providers responded
 *   //   synthesized: true,  // true = fusion, false = single-provider pick
 *   // }
 */

import { aiConsensusAll, type ConsensusResponse } from "./ai-provider";

export interface SummarizeInput {
  videoTitle: string;
  videoDescription: string;
  videoCategory: string;
  channelName: string;
  durationSec: number;
}

export interface Recap {
  tldr: string;
  takeaways: string[];
  bestMoment: string;
  vibe: string;
}

export interface SummarizeConsensusResult {
  recap: Recap;
  source: "consensus" | "ai" | "fallback";
  sources: string[];  // which providers contributed
  confidence: number;  // 0.0 to 1.0 — how much providers agreed on vibe
  providerCount: number;  // how many providers responded
  synthesized: boolean;  // true = fusion of multiple, false = single-provider pick
}

// Vibe labels appropriate per category (used to validate/score the vibe field)
const CATEGORY_VIBES: Record<string, string[]> = {
  Gaming: ["Energetic", "Intense", "Triumphant", "Determined", "Focused", "Hype", "Adrenaline"],
  Music: ["Energetic", "Reflective", "Cozy", "Hypnotic", "Euphoric", "Mellow", "Atmospheric"],
  Travel: ["Reflective", "Awe", "Curious", "Wanderlust", "Calm", "Inspiring", "Adventurous"],
  Food: ["Cozy", "Curious", "Savory", "Comforting", "Indulgent", "Wholesome"],
  Fitness: ["Energetic", "Determined", "Intense", "Motivating", "Sweaty", "Disciplined"],
  Science: ["Curious", "Awe", "Analytical", "Fascinating", "Mind-bending", "Rigorous"],
  Art: ["Reflective", "Creative", "Inspiring", "Atmospheric", "Imaginative", "Expressive"],
  Nature: ["Awe", "Calm", "Reflective", "Majestic", "Serenity", "Wild"],
  Cars: ["Energetic", "Adrenaline", "Intense", "Thrilling", "Powerful", "Nostalgic"],
  Tech: ["Curious", "Analytical", "Pragmatic", "Futuristic", "Geeky", "Innovative"],
  News: ["Serious", "Informative", "Urgent", "Reflective", "Concerned", "Objective"],
};
const DEFAULT_VIBES = ["Curious", "Reflective", "Energetic", "Cozy", "Awe", "Intense", "Triumphant", "Determined"];

/**
 * Build the LLM prompt for the summarize task.
 */
function buildPrompt(input: SummarizeInput): { system: string; user: string } {
  const { videoTitle, videoDescription, videoCategory, channelName, durationSec } = input;
  const mins = Math.floor(durationSec / 60);
  const secs = durationSec % 60;
  const durStr = `${mins}:${secs.toString().padStart(2, "0")}`;

  const system = "You produce tight, accurate video recaps in JSON. You emit valid JSON only — no markdown fences, no preamble.";

  const user = `Summarize this video into a structured recap.

Title: ${videoTitle}
Channel: ${channelName}
Category: ${videoCategory}
Duration: ${durStr}
Description: ${videoDescription.slice(0, 1000)}

Respond with EXACTLY this JSON shape (no other text):
{
  "tldr": "one or two sentences capturing what the video is about (50-200 chars)",
  "takeaways": ["key point 1 (15-80 chars)", "key point 2", "key point 3"],
  "bestMoment": "the single most memorable moment a viewer should look out for (15-100 chars)",
  "vibe": "one-word mood label (e.g. Reflective, Energetic, Cozy, Curious, Awe, Intense, Triumphant, Determined)"
}`;

  return { system, user };
}

/**
 * Parse a provider's response into a Recap object.
 * Returns null if the response is not valid JSON or missing required fields.
 */
function parseRecap(text: string): Recap | null {
  // Extract JSON from the response (LLMs sometimes wrap in markdown fences)
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) return null;

  try {
    const obj = JSON.parse(jsonMatch[0]);
    // Validate required fields.
    if (typeof obj.tldr !== "string" || obj.tldr.length < 10) return null;
    if (!Array.isArray(obj.takeaways) || obj.takeaways.length === 0) return null;
    if (typeof obj.bestMoment !== "string" || obj.bestMoment.length < 5) return null;
    if (typeof obj.vibe !== "string" || obj.vibe.length === 0) return null;

    // Normalize takeaways: filter empty, cap at 5.
    const takeaways = (obj.takeaways as any[])
      .filter((t) => typeof t === "string" && t.trim().length > 5)
      .map((t) => t.trim())
      .slice(0, 5);
    if (takeaways.length === 0) return null;

    return {
      tldr: obj.tldr.trim(),
      takeaways,
      bestMoment: obj.bestMoment.trim(),
      vibe: obj.vibe.trim(),
    };
  } catch {
    return null;
  }
}

/**
 * Score a recap on quality metrics (0-100).
 * Higher = better.
 */
function scoreRecap(recap: Recap, category: string): number {
  let score = 0;

  // TL;DR length: sweet spot 50-250 chars.
  const tldrLen = recap.tldr.length;
  if (tldrLen >= 50 && tldrLen <= 250) score += 25;
  else if (tldrLen >= 30 && tldrLen <= 350) score += 15;
  else if (tldrLen >= 20) score += 5;

  // Takeaways count: 3-5 ideal.
  const tkCount = recap.takeaways.length;
  if (tkCount >= 3 && tkCount <= 5) score += 25;
  else if (tkCount >= 2 && tkCount <= 6) score += 15;
  else if (tkCount >= 1) score += 5;

  // Best moment specificity: contains a number, timestamp, or concrete action verb.
  const hasSpecificity = /\d|:\d{2}|moment|final|when|after|defeat|win|loses|completes|achieves|discovers/i.test(recap.bestMoment);
  if (hasSpecificity) score += 20;
  else score += 5;

  // Vibe appropriateness: single word, in the category's vibe list (or default).
  const validVibes = CATEGORY_VIBES[category] || DEFAULT_VIBES;
  const vibeWord = recap.vibe.split(/\s+/)[0];  // take first word if it's multi-word
  if (validVibes.some((v) => v.toLowerCase() === vibeWord.toLowerCase())) {
    score += 20;
  } else if (DEFAULT_VIBES.some((v) => v.toLowerCase() === vibeWord.toLowerCase())) {
    score += 15;
  } else if (recap.vibe.length <= 20) {
    score += 5;  // short but not in the list — still acceptable
  }

  return score;
}

/**
 * Normalize a takeaway for deduplication (lowercase, strip punctuation).
 */
function normalizeTakeaway(t: string): string {
  return t.toLowerCase().replace(/[^a-z0-9 ]/g, "").replace(/\s+/g, " ").trim();
}

/**
 * SYNTHESIS: combine the best elements from multiple recaps into one.
 *
 * - TL;DR: pick the one from the highest-scored recap.
 * - Takeaways: union of all unique takeaways, sorted by cross-provider
 *   frequency (most providers mentioned it = higher rank), top 3-4.
 * - Best Moment: the most specific one (longest with a number/timestamp).
 * - Vibe: majority vote across all recaps.
 */
function synthesizeRecap(recaps: Recap[], category: string): { recap: Recap; confidence: number } {
  // Score all recaps.
  const scored = recaps.map((r) => ({ recap: r, score: scoreRecap(r, category) }));
  scored.sort((a, b) => b.score - a.score);

  // TL;DR: pick the highest-scored recap's TL;DR (most informative).
  const bestTldr = scored[0].recap.tldr;

  // Takeaways: union + dedupe + rank by frequency.
  const takeawayFreq = new Map<string, { original: string; count: number }>();
  for (const { recap } of scored) {
    for (const t of recap.takeaways) {
      const norm = normalizeTakeaway(t);
      const existing = takeawayFreq.get(norm);
      if (existing) {
        existing.count++;
        // Prefer the longest original wording.
        if (t.length > existing.original.length) existing.original = t;
      } else {
        takeawayFreq.set(norm, { original: t, count: 1 });
      }
    }
  }
  // Sort by frequency (desc), then by original length (desc).
  const rankedTakeaways = Array.from(takeawayFreq.values())
    .sort((a, b) => b.count - a.count || b.original.length - a.original.length)
    .slice(0, 4)
    .map((t) => t.original);

  // Best Moment: pick the most specific (contains a number/timestamp/concrete action).
  const bestMoments = scored.map((s) => s.recap.bestMoment);
  const mostSpecific = bestMoments
    .map((m) => ({ moment: m, specificity: (m.match(/\d|:\d{2}|final|defeat|win|completes|achieves|discovers|moment/gi) || []).length }))
    .sort((a, b) => b.specificity - a.specificity)[0];
  const bestMoment = mostSpecific ? mostSpecific.moment : bestMoments[0];

  // Vibe: majority vote across all recaps.
  const vibeCounts = new Map<string, number>();
  for (const { recap } of scored) {
    const v = recap.vibe.split(/\s+/)[0].toLowerCase();
    vibeCounts.set(v, (vibeCounts.get(v) || 0) + 1);
  }
  const sortedVibes = Array.from(vibeCounts.entries()).sort((a, b) => b[1] - a[1]);
  const winningVibe = sortedVibes[0];
  // Confidence = (count of winning vibe) / (total recaps).
  const confidence = winningVibe ? winningVibe[1] / recaps.length : 0;
  // Restore the original casing of the vibe (from the first recap that had it).
  const winningVibeOriginal = winningVibe
    ? (recaps.find((r) => r.vibe.toLowerCase() === winningVibe[0])?.vibe || winningVibe[0])
    : "Curious";

  return {
    recap: {
      tldr: bestTldr,
      takeaways: rankedTakeaways,
      bestMoment,
      vibe: winningVibeOriginal,
    },
    confidence,
  };
}

/**
 * Deterministic fallback recap (used when all 5 AI providers fail).
 */
function fallbackRecap(input: SummarizeInput): Recap {
  return {
    tldr: `"${input.videoTitle}" by ${input.channelName} — a ${input.videoCategory.toLowerCase()} pick worth your next coffee break.`,
    takeaways: [
      `A ${input.videoCategory.toLowerCase()} video from ${input.channelName}.`,
      "Watch for the practical tips sprinkled throughout.",
      "Great production quality and a steady pace.",
    ],
    bestMoment: "The payoff in the second half — don't skip ahead.",
    vibe: "Curious",
  };
}

/**
 * Main entry point — state-of-art ensemble fusion consensus for video summarization.
 *
 * Fires all 5 AI providers in parallel, scores each response, synthesizes a
 * best-of-all recap. Returns a confidence score based on cross-provider agreement.
 */
export async function aiSummarizeConsensus(input: SummarizeInput): Promise<SummarizeConsensusResult> {
  const { system, user } = buildPrompt(input);

  // STAGE 1: Fire all 5 providers in parallel.
  const responses: ConsensusResponse[] = await aiConsensusAll({
    system,
    user,
    maxTokens: 800,
    temperature: 0.7,
  });

  // STAGE 2: Parse + score each response.
  const parsed: Array<{ recap: Recap; source: string; ms: number; score: number }> = [];
  for (const r of responses) {
    const recap = parseRecap(r.text);
    if (recap) {
      parsed.push({
        recap,
        source: r.source,
        ms: r.ms,
        score: scoreRecap(recap, input.videoCategory),
      });
    }
  }

  // STAGE 3: Synthesize or fallback.
  if (parsed.length === 0) {
    // All 5 providers failed OR none returned valid JSON.
    return {
      recap: fallbackRecap(input),
      source: "fallback",
      sources: [],
      confidence: 0,
      providerCount: responses.length,
      synthesized: false,
    };
  }

  if (parsed.length === 1) {
    // Only 1 valid response — no synthesis needed, just return it.
    return {
      recap: parsed[0].recap,
      source: "ai",
      sources: [parsed[0].source],
      confidence: 1.0,  // 1/1 = 100% agreement (trivially)
      providerCount: responses.length,
      synthesized: false,
    };
  }

  // Multiple valid responses — SYNTHESIZE (ensemble fusion).
  const recapsToFuse = parsed.map((p) => p.recap);
  const { recap: synthesized, confidence } = synthesizeRecap(recapsToFuse, input.videoCategory);

  return {
    recap: synthesized,
    source: "consensus",
    sources: parsed.map((p) => p.source),
    confidence,
    providerCount: responses.length,
    synthesized: true,
  };
}
