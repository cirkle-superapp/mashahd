import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { aiChat } from "@/lib/ai-provider";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";
import { sanitizeUserInput } from "@/lib/ai-prompt-security";

/**
 * POST /api/ai/search-in-video
 * Body: { videoId, query }
 *
 * Per spec §38: "Implement AI/search functionality that can find where a topic
 * is discussed. Example: User asks: 'Where does this video discuss customs clearance?'
 * Return timestamp(s). The answer must link to the relevant point in the source video."
 *
 * Uses the video's transcript (if available) + AI to find the most relevant
 * timestamps where the topic is discussed. Falls back to a deterministic
 * keyword search if no transcript or AI is unavailable.
 */

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`search-in-video:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await req.json().catch(() => ({}));
  const videoId: string = body.videoId || "";
  // Sanitize the query to prevent prompt injection (Pass 59).
  const { sanitized: safeQuery } = sanitizeUserInput(body.query || "", 500);
  const query: string = safeQuery.trim();

  if (!videoId || !query) {
    return NextResponse.json({ error: "videoId+query required" }, { status: 400 });
  }

  const video = await db.video.findUnique({
    where: { id: videoId },
    select: { id: true, title: true, description: true, tags: true, durationSec: true },
  });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  // Try to fetch the transcript (if one was generated via /api/ai/transcript).
  // The transcript API caches results, so this is efficient.
  // Use a relative URL so this works in any deployment (not just localhost).
  const baseUrl = process.env.APP_URL || `http://localhost:${process.env.PORT || 3000}`;
  let transcript: any[] = [];
  try {
    const transcriptRes = await fetch(`${baseUrl}/api/ai/transcript?videoId=${videoId}`);
    if (transcriptRes.ok) {
      const data = await transcriptRes.json();
      transcript = data.transcript || [];
    }
  } catch { /* transcript not available */ }

  // If we have a transcript, use AI to find the relevant timestamps.
  if (transcript.length > 0) {
    try {
      const transcriptText = transcript
        .map((seg: any) => `[${Math.floor(seg.start)}s] ${seg.text}`)
        .join("\n");

      const aiResult = await aiChat({
        system: `You are a video search assistant. The user wants to find where a topic is discussed in a video. You are given the video's transcript with timestamps. Find the 1-3 most relevant timestamps where the topic is discussed. Return ONLY a JSON array of objects: [{"start": <seconds>, "end": <seconds>, "reason": "<why this section is relevant>"}]. No other text.`,
        user: `Video title: ${video.title}\nUser query: "${query}"\n\nTranscript:\n${transcriptText}\n\nReturn the most relevant timestamps as a JSON array.`,
        maxTokens: 500,
      });

      // Parse the AI response — try to extract a JSON array.
      const jsonMatch = aiResult.text.match(/\[[\s\S]*\]/);
      if (jsonMatch) {
        const results = JSON.parse(jsonMatch[0]);
        return NextResponse.json({
          results: results.map((r: any) => ({
            start: Math.max(0, Math.floor(r.start || 0)),
            end: Math.floor(r.end || (r.start || 0) + 30),
            reason: String(r.reason || "").slice(0, 200),
            deepLink: `/?v=watch&id=${videoId}&t=${Math.floor(r.start || 0)}`,
          })),
          source: "ai",
          query,
        });
      }
    } catch { /* AI failed — fall through to keyword search */ }
  }

  // Fallback: deterministic keyword search in the title + description.
  // This always works (no AI dependency) — per spec §14, deterministic search
  // must be preserved.
  const queryTerms = query.toLowerCase().split(/\s+/).filter(Boolean);
  const hay = `${video.title} ${video.description} ${video.tags}`.toLowerCase();

  // If the query terms appear in the video metadata, return the beginning as
  // a match (we don't have transcript timestamps without AI).
  const matches = queryTerms.filter((t) => hay.includes(t));
  if (matches.length > 0) {
    return NextResponse.json({
      results: [{
        start: 0,
        end: Math.min(60, video.durationSec),
        reason: `The video's title/description mentions: ${matches.join(", ")}`,
        deepLink: `/?v=watch&id=${videoId}&t=0`,
      }],
      source: "keyword",
      query,
    });
  }

  // No match found.
  return NextResponse.json({
    results: [],
    source: transcript.length > 0 ? "ai-no-match" : "no-transcript",
    query,
    note: transcript.length === 0
      ? "No transcript available for this video. AI-powered search requires a transcript."
      : "No relevant sections found. Try a different query.",
  });
}
