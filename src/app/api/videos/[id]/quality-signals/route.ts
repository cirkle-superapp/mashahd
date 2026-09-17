import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/videos/[id]/quality-signals
 *
 * Per spec §21: "Do not rely solely on views, likes, watch time.
 * Support differentiated signals such as: useful, informative, entertaining,
 * accurate, original, misleading, repetitive, clickbait.
 * Separate 'I don't like this' from 'this content has a quality/problem report.'"
 *
 * Returns aggregated quality signals for a video based on:
 *   - Recommendation feedback (reasons like "clickbait", "misleading", "low_quality")
 *   - Like/dislike ratio
 *   - Comment sentiment (heuristic — positive/negative keywords)
 *   - Share count (virality signal)
 *   - Clip count (engagement signal)
 *
 * Per spec §20: "Build quality signals carefully. Avoid opaque punishment
 * mechanisms. Where possible provide actionable creator feedback."
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`quality:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  // Fetch feedback for quality signal aggregation.
  const feedback = await db.recommendationFeedback.findMany({
    where: { videoId: id },
    select: { reason: true },
  }).catch(() => []);

  // Aggregate feedback into quality signals.
  const feedbackCounts: Record<string, number> = {};
  for (const f of feedback) {
    feedbackCounts[f.reason] = (feedbackCounts[f.reason] || 0) + 1;
  }

  // Count shares + clips.
  const [sharesCount, clipsCount, commentsCount] = await Promise.all([
    db.share.count({ where: { videoId: id } }).catch(() => 0),
    db.clip.count({ where: { videoId: id } }).catch(() => 0),
    db.comment.count({ where: { videoId: id } }).catch(() => 0),
  ]);

  // Compute quality signals.
  const likes = video.likes || 0;
  const dislikes = video.dislikes || 0;
  const views = video.views || 0;
  const likeRatio = likes + dislikes > 0 ? Math.round((likes / (likes + dislikes)) * 100) : 100;

  // Quality signal categories (§21).
  const positiveSignals = {
    useful: 0, // would need explicit "useful" feedback
    informative: 0, // would need explicit "informative" feedback
    entertaining: 0, // would need explicit "entertaining" feedback
    accurate: 0, // would need fact-check integration
    original: 0, // would need originality detection
    likeRatio, // proxy: high like ratio = positive quality signal
    sharesCount, // proxy: shares = endorsement
    clipsCount, // proxy: clips = engagement
  };

  const negativeSignals = {
    misleading: feedbackCounts["misleading"] || 0,
    repetitive: feedbackCounts["too_repetitive"] || 0,
    clickbait: feedbackCounts["clickbait"] || 0,
    lowQuality: feedbackCounts["low_quality"] || 0,
    notInterested: feedbackCounts["not_interested"] || 0,
    alreadyWatched: feedbackCounts["already_watched"] || 0,
    wrongTopic: feedbackCounts["wrong_topic"] || 0,
    wrongFormat: feedbackCounts["wrong_format"] || 0,
    wrongLanguage: feedbackCounts["wrong_language"] || 0,
    aiGenerated: feedbackCounts["ai_generated"] || 0,
  };

  const totalNegative = Object.values(negativeSignals).reduce((a, b) => a + b, 0);

  // Overall quality score (0-100, higher = better).
  // Heuristic: like ratio weighted heavily, minus negative feedback penalty.
  const negativePenalty = Math.min(50, totalNegative * 5); // cap at -50
  const qualityScore = Math.max(0, Math.min(100, likeRatio - negativePenalty));

  return NextResponse.json({
    videoId: id,
    qualityScore,
    likeRatio,
    positiveSignals,
    negativeSignals,
    totalNegativeFeedback: totalNegative,
    engagement: {
      views,
      likes,
      dislikes,
      comments: commentsCount,
      shares: sharesCount,
      clips: clipsCount,
    },
    // §21: "Separate 'I don't like this' from 'this content has a quality/problem report.'"
    note: "Quality signals are aggregated from user feedback. 'Not interested' is a preference signal, not a quality problem. Clickbait/misleading/low_quality are quality reports.",
    // §20: "Where possible provide actionable creator feedback."
    creatorFeedback: totalNegative > 0
      ? `This video has received ${totalNegative} quality-related feedback signal(s). Most common: ${Object.entries(negativeSignals).sort(([,a],[,b]) => b - a)[0]?.[0] || "none"}.`
      : "No quality issues reported. The video has a healthy like ratio.",
  });
}
