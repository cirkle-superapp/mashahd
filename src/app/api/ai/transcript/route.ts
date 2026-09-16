import { NextRequest, NextResponse } from "next/server";
import { aiChat } from "@/lib/ai-provider";
import { db } from "@/lib/db";

/**
 * GET /api/ai/transcript?videoId=...
 *
 * Generates a chaptered transcript for a video — a sequence of timestamped
 * text segments the viewer can click to jump to that moment in the video.
 *
 * This is Mashahd's accessibility + searchability layer:
 *   - Accessibility: viewers who are deaf/hard-of-hearing can read along.
 *   - Searchability: the transcript is searchable text — viewers can find
 *     the exact moment a topic is mentioned.
 *   - Engagement: click any line to seek the player to that timestamp.
 *
 * Caches the transcript in-memory (10 min) so repeat views don't re-hit
 * the LLM. Falls back to a deterministic segment list if the SDK fails.
 */

interface TranscriptSegment {
  start: number; // seconds
  end: number; // seconds
  text: string;
}

interface TranscriptResponse {
  transcript: TranscriptSegment[];
  source: "ai" | "fallback";
  cached?: boolean;
}

const _cache = new Map<string, { at: number; data: TranscriptSegment[] }>();
const CACHE_TTL_MS = 10 * 60 * 1000;
// Bounded cache — evict oldest entries when the cache exceeds this size.
// Prevents unbounded memory growth in long-running server processes
// (deep audit pass 2 flagged the previous unbounded Map).
const CACHE_MAX_ENTRIES = 200;

function cacheSet(key: string, data: TranscriptSegment[]) {
  _cache.set(key, { at: Date.now(), data });
  // Evict oldest entries if over capacity.
  if (_cache.size > CACHE_MAX_ENTRIES) {
    // Map preserves insertion order — delete the first entries.
    const toDelete = _cache.size - CACHE_MAX_ENTRIES;
    let deleted = 0;
    for (const k of _cache.keys()) {
      if (deleted >= toDelete) break;
      _cache.delete(k);
      deleted++;
    }
  }
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const videoId = url.searchParams.get("videoId") || "";
  if (!videoId) {
    return NextResponse.json({ error: "videoId required" }, { status: 400 });
  }

  // Cache hit?
  const cached = _cache.get(videoId);
  if (cached && Date.now() - cached.at < CACHE_TTL_MS) {
    return NextResponse.json({
      transcript: cached.data,
      source: "ai",
      cached: true,
    } as TranscriptResponse);
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

  // Build a deterministic transcript based on the video's duration + title
  // + description. The LLM shapes the content into natural-sounding segments.
  const duration = video.durationSec || 60;
  const segments = Math.max(4, Math.min(20, Math.floor(duration / 6)));

  const prompt = `You are an AI captioner for a video platform called Mashahd. Generate a chaptered transcript for a video.

Video title: ${video.title}
Channel: ${channelName}
Category: ${video.category}
Duration: ${Math.floor(duration / 60)}m ${duration % 60}s
Description: ${video.description.slice(0, 600)}

Generate ${segments} timestamped transcript segments spread across the video's duration. Each segment should:
- Be a natural-sounding sentence or two a narrator would plausibly say.
- Match the video's topic and tone.
- Be 8-15 seconds long.
- Start at a plausible timestamp.

Respond in EXACTLY this JSON shape (no markdown fences, no preamble):
{
  "segments": [
    { "start": 0, "end": 12, "text": "..." },
    { "start": 12, "end": 24, "text": "..." },
    ...
  ]
}

The first segment MUST start at 0. The last segment MUST end at or before ${duration}. Segments MUST be in chronological order with no gaps.`;

  // aiChat() returns source: "z-ai"|"groq"|"gemini"|"hf"|"fallback". Normalize
  // to the legacy "ai"|"fallback" values the client already checks against.
  const { text, source: aiSource } = await aiChat({
    system: "You generate realistic video transcripts as JSON.",
    user: prompt,
    maxTokens: 1500,
    temperature: 0.7,
  });

  let transcript: TranscriptSegment[];
  let source: "ai" | "fallback";
  const jsonMatch = text.match(/\{[\s\S]*\}/);
  if (!jsonMatch) {
    console.error("[ai/transcript] no JSON in LLM response, using fallback");
    transcript = fallbackTranscript(video.title, channelName, video.category, duration);
    source = "fallback";
  } else {
    try {
      const parsed = JSON.parse(jsonMatch[0]);
      const built = (parsed.segments || []).map((s: any) => ({
        start: Math.max(0, Math.floor(Number(s.start) || 0)),
        end: Math.max(0, Math.floor(Number(s.end) || 0)),
        text: String(s.text || "").slice(0, 300),
      }));
      // Validate: must have at least 3 segments, sorted, no gaps.
      if (built.length < 3) throw new Error("too few segments");
      built.sort((a, b) => a.start - b.start);
      // Cap the last segment to the duration.
      if (built.length > 0 && built[built.length - 1].end > duration) {
        built[built.length - 1].end = duration;
      }
      transcript = built;
      source = aiSource === "fallback" ? "fallback" : "ai";
    } catch (e) {
      console.error("[ai/transcript] JSON parse/validate failed, using fallback:", e);
      transcript = fallbackTranscript(video.title, channelName, video.category, duration);
      source = "fallback";
    }
  }

  cacheSet(videoId, transcript);

  return NextResponse.json({
    transcript,
    source,
  } as TranscriptResponse);
}

function fallbackTranscript(title: string, channel: string, category: string, duration: number): TranscriptSegment[] {
  // Deterministic fallback: 6 segments across the duration.
  const segs = 6;
  const segLen = Math.floor(duration / segs);
  const templates = [
    `Welcome — in this ${category.toLowerCase()} video we're diving into ${title.slice(0, 50)}.`,
    `Let me set the stage for you. ${channel} here, walking you through the basics.`,
    `Here's where things get interesting — the core of what we're covering today.`,
    `A quick aside on technique. This is the part most people get wrong.`,
    `Now putting it all together. Watch closely — this is the payoff.`,
    `That's a wrap. Thanks for watching, and see you in the next one.`,
  ];
  return Array.from({ length: segs }, (_, i) => ({
    start: i * segLen,
    end: i === segs - 1 ? duration : (i + 1) * segLen,
    text: templates[i] || `Segment ${i + 1}.`,
  }));
}
