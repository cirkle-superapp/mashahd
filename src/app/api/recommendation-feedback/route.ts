import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/recommendation-feedback
 * Body: { browserId, videoId, reason, note? }
 *
 * Records explicit user feedback on a recommendation (§10).
 * Each feedback has a REAL, PERSISTENT effect on the recommendation engine:
 *   - The video is excluded from the user's FYP forever.
 *   - "dont_like_creator" also blocks the creator's videos from recommendations.
 *   - "wrong_topic" reduces the category's affinity weight.
 *
 * Per spec §10: "Do NOT implement these as cosmetic UI buttons that do not
 * materially alter the recommendation profile."
 *
 * Valid reasons (§10): not_interested | already_watched | wrong_topic |
 * too_repetitive | low_quality | clickbait | misleading | wrong_language |
 * wrong_format | ai_generated | dont_like_creator
 */

const VALID_REASONS = [
  "not_interested", "already_watched", "wrong_topic", "too_repetitive",
  "low_quality", "clickbait", "misleading", "wrong_language", "wrong_format",
  "ai_generated", "dont_like_creator",
];

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const videoId: string = body.videoId || "";
  const reason: string = body.reason || "";
  const note: string = (body.note || "").slice(0, 500);

  if (!bid || !videoId || !reason) {
    return NextResponse.json({ error: "browserId+videoId+reason required" }, { status: 400 });
  }
  if (!VALID_REASONS.includes(reason)) {
    return NextResponse.json({ error: `invalid reason. valid: ${VALID_REASONS.join(", ")}` }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`rec-feedback:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // Verify the video exists.
  const video = await db.video.findUnique({
    where: { id: videoId },
    select: { id: true, channelId: true, category: true },
  });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  // Upsert the feedback (unique on userId+videoId — one feedback per user+video).
  const feedback = await db.recommendationFeedback.upsert({
    where: { userId_videoId: { userId: verification.id, videoId } },
    create: { userId: verification.id, videoId, reason, note },
    update: { reason, note },
  });

  // If "dont_like_creator", also create a creator block (§11).
  if (reason === "dont_like_creator") {
    await db.userBlock.upsert({
      where: { userId_blockType_blockValue: { userId: verification.id, blockType: "creator", blockValue: video.channelId } },
      create: { userId: verification.id, blockType: "creator", blockValue: video.channelId },
      update: {},
    });
  }

  // If "wrong_topic", reduce that category's affinity by creating a topic block
  // (soft — the FYP will deprioritize the category).
  if (reason === "wrong_topic") {
    await db.userBlock.upsert({
      where: { userId_blockType_blockValue: { userId: verification.id, blockType: "topic", blockValue: video.category } },
      create: { userId: verification.id, blockType: "topic", blockValue: video.category },
      update: {},
    });
  }

  // Log to the recommendation changelog (§70 — "My Recommendation Profile").
  const isNegative = ["not_interested", "already_watched", "wrong_topic", "too_repetitive", "low_quality", "clickbait", "misleading", "wrong_language", "wrong_format", "ai_generated", "dont_like_creator"].includes(reason);
  await db.recommendationChangelog.create({
    data: {
      userId: verification.id,
      eventType: isNegative ? "negative_feedback" : "positive_feedback",
      description: `Marked a video as "${reason.replace(/_/g, " ")}"`,
      metadata: JSON.stringify({ videoId, reason }),
    },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    feedbackId: feedback.id,
    reason,
    effects: [
      "video_excluded_from_recommendations",
      ...(reason === "dont_like_creator" ? ["creator_blocked"] : []),
      ...(reason === "wrong_topic" ? ["topic_blocked"] : []),
    ],
  });
}

/**
 * DELETE /api/recommendation-feedback
 * Body: { browserId, videoId }
 * Removes the feedback (undo "not interested").
 */
export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const videoId: string = body.videoId || "";

  if (!bid || !videoId) {
    return NextResponse.json({ error: "browserId+videoId required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  await db.recommendationFeedback.deleteMany({
    where: { userId: verification.id, videoId },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
