import { NextRequest, NextResponse } from "next/server";
import ZAI from "z-ai-web-dev-sdk";
import { db } from "@/lib/db";

/**
 * GET /api/ai/trending-digest
 *
 * Generates an AI "trending digest" — a short, engaging summary of today's
 * top trending videos on Mashahd. Surfaces AI as the platform's identity:
 * instead of a bare list of videos, the viewer gets a 3-4 sentence editorial
 * wrap-up that reads like a curator's note.
 *
 * Caches for 10 minutes in-memory so repeated requests don't re-hit the LLM.
 * Falls back to a deterministic digest if the SDK is unavailable.
 */
let _cache: { at: number; digest: string; videos: { id: string; title: string }[] } | null = null;
const CACHE_TTL_MS = 10 * 60 * 1000;

export async function GET(req: NextRequest) {
  // Cache hit?
  if (_cache && Date.now() - _cache.at < CACHE_TTL_MS) {
    return NextResponse.json({
      ok: true,
      digest: _cache.digest,
      videos: _cache.videos,
      source: "ai",
      cached: true,
    });
  }

  // Fetch the current top trending videos (by views, recent).
  const videos = await db.video.findMany({
    orderBy: { views: "desc" },
    take: 6,
    include: { channel: true },
  });

  if (videos.length === 0) {
    return NextResponse.json({
      ok: true,
      digest: "Nothing's trending right now. Check back in a bit.",
      videos: [],
      source: "fallback",
    });
  }

  const lines = videos.map(
    (v: any, i: number) =>
      `${i + 1}. "${v.title}" by ${v.channel?.name || "Unknown"} — ${v.views.toLocaleString()} views, ${v.category}`
  );
  const prompt = `You are the AI editor of a video discovery app called Mashahd (مشاهِد).
Write a short, engaging editorial digest of today's trending videos. It should:

- Be 3-4 sentences, max ~80 words.
- Read like a friendly curator's note (not a dry list).
- Mention 2-3 of the videos by name, weaving them into a narrative.
- End with a light hook inviting the viewer to pick one and watch.

Today's trending videos:
${lines.join("\n")}

Respond with the digest text only — no markdown, no quotes, no preamble.`;

  let digest: string;
  let source: "ai" | "fallback" = "ai";
  try {
    const zai = await ZAI.create();
    const completion = await zai.chat.completions.create({
      messages: [
        { role: "assistant", content: "You write short, punchy editorial digests for a video app." },
        { role: "user", content: prompt },
      ],
      thinking: { type: "disabled" },
    });
    digest = completion.choices[0]?.message?.content?.trim() || fallbackDigest(videos);
    if (!digest || digest.length < 20) {
      digest = fallbackDigest(videos);
      source = "fallback";
    }
  } catch (e) {
    console.error("[ai/trending-digest] LLM failed, using fallback:", e);
    digest = fallbackDigest(videos);
    source = "fallback";
  }

  _cache = {
    at: Date.now(),
    digest,
    videos: videos.map((v: any) => ({ id: v.id, title: v.title })),
  };

  return NextResponse.json({
    ok: true,
    digest,
    videos: _cache.videos,
    source,
    cached: false,
  });
}

function fallbackDigest(videos: any[]): string {
  if (videos.length === 0) return "Nothing's trending right now.";
  const top = videos.slice(0, 3).map((v) => `"${v.title}"`);
  const lead = top[0];
  const rest = top.slice(1).join(" and ");
  return `Today's feed is led by ${lead}${rest ? `, alongside ${rest}` : ""}. A nicely mixed bag — pick whichever matches your mood and press play.`;
}
