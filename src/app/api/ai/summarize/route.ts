import { NextRequest, NextResponse } from "next/server";
import { aiSummarizeConsensus } from "@/lib/ai-summarize-consensus";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";
import { sanitizeUrl } from "@/lib/format";

/**
 * POST /api/ai/summarize
 * Body: { videoId }
 *
 * STATE-OF-ART ENSEMBLE FUSION CONSENSUS (Pass 91):
 * Fires all 5 CIRKLE BRAIN providers (Groq + OpenRouter + NVIDIA + Gemini + HuggingFace)
 * in parallel, parses each response, scores on structural + content quality,
 * then SYNTHESIZES a best-of-all recap:
 *   - TL;DR: from the highest-scored response
 *   - Takeaways: union of all unique takeaways, ranked by cross-provider frequency
 *   - Best Moment: most specific (mentions a number/timestamp/concrete action)
 *   - Vibe: majority vote across all valid responses
 *   - Confidence: how many providers agreed on the vibe (0.0 to 1.0)
 *
 * The response now includes:
 *   - source: "consensus" | "ai" | "fallback"
 *   - sources: which providers contributed (e.g. ["groq", "openrouter", "nvidia"])
 *   - confidence: 0.0-1.0 (cross-provider agreement on the vibe)
 *   - providerCount: how many of the 5 providers responded
 *   - synthesized: true = ensemble fusion, false = single-provider pick
 *
 * Falls back to a deterministic summary if all 5 providers fail.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`ai-summarize:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — AI requests are limited to 10/min" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  const { videoId } = await req.json().catch(() => ({} as { videoId?: string }));
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

  // Call the state-of-art ensemble fusion consensus.
  const result = await aiSummarizeConsensus({
    videoTitle: video.title,
    videoDescription: video.description || "",
    videoCategory: video.category,
    channelName,
    durationSec: video.durationSec,
  });

  // Normalize source for backwards-compat with the client (which checks
  // source === "ai" | "fallback"). The new "consensus" source is treated
  // as "ai" by the client (it's still AI-generated, just synthesized).
  const clientSource: "ai" | "fallback" = result.source === "fallback" ? "fallback" : "ai";

  return NextResponse.json({
    ok: true,
    recap: result.recap,
    source: clientSource,
    // Pass 91: new state-of-art consensus metadata.
    consensus: {
      source: result.source,         // "consensus" | "ai" | "fallback"
      sources: result.sources,        // ["groq", "openrouter", ...]
      confidence: result.confidence,  // 0.0-1.0
      providerCount: result.providerCount,  // 0-5
      synthesized: result.synthesized,  // true = fusion, false = single
    },
  });
}
