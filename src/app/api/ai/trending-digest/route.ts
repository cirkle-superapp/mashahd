import { NextRequest, NextResponse } from "next/server";
import { aiChat } from "@/lib/ai-provider";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

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
  const ip = getClientIP(req);
  const rl = await rateLimit(`ai-trending-digest:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — AI requests are limited to 10/min" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
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
  // Fetch channels separately — the turso-db wrapper doesn't reliably
  // populate nested includes.
  const videos = await db.video.findMany({
    orderBy: { views: "desc" },
    take: 6,
  });

  if ((videos as any[]).length === 0) {
    return NextResponse.json({
      ok: true,
      digest: "Nothing's trending right now. Check back in a bit.",
      videos: [],
      source: "fallback",
    });
  }

  // Fetch channel names for the trending videos.
  const channelIds = [...new Set((videos as any[]).map((v) => v.channelId))];
  const channels = channelIds.length > 0
    ? await db.channel.findMany({ where: { id: { in: channelIds } } })
    : [];
  const channelMap: Record<string, any> = {};
  for (const c of channels as any[]) channelMap[c.id] = c;

  const lines = (videos as any[]).map(
    (v, i) =>
      `${i + 1}. "${v.title}" by ${channelMap[v.channelId]?.name || "Unknown"} — ${v.views.toLocaleString()} views, ${v.category}`
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

  // aiChat() returns source from the 5-provider consensus: "groq"|"openrouter"|"nvidia"|"gemini"|"hf"|"fallback". Normalize
  // to the legacy "ai"|"fallback" values the client already checks against.
  const { text, source: aiSource } = await aiChat({
    system: "You write short, punchy editorial digests for a video app.",
    user: prompt,
    maxTokens: 300,
    temperature: 0.7,
  });

  let digest: string;
  let source: "ai" | "fallback";
  const trimmed = text.trim();
  if (!trimmed || trimmed.length < 20) {
    console.error("[ai/trending-digest] LLM returned empty/short digest, using fallback");
    digest = fallbackDigest(videos);
    source = "fallback";
  } else {
    digest = trimmed;
    source = aiSource === "fallback" ? "fallback" : "ai";
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
