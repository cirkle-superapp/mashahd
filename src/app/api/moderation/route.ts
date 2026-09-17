import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/moderation?videoId=<id>
 *
 * Per spec §23: "For meaningful moderation actions show: action, reason,
 * whether automated/human, appeal availability, appeal status, final result.
 * Do not make enforcement unnecessarily opaque."
 *
 * Returns moderation transparency data for a video:
 *   - Platform moderation actions (rights claims, corrections)
 *   - Community feedback summary (quality signals)
 *   - Appeal availability + status
 *
 * Per spec §22: "Users should understand which entity removed a comment
 * where appropriate: PLATFORM MODERATION vs CREATOR MODERATION."
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const videoId = url.searchParams.get("videoId") || "";
  if (!videoId) {
    return NextResponse.json({ error: "videoId required" }, { status: 400 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`moderation:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const video = await db.video.findUnique({ where: { id: videoId } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  // Fetch moderation-related data.
  const [rightsClaims, rightsDisputes, corrections, feedback, adDisclosures] = await Promise.all([
    db.rightsClaim.findMany({
      where: { videoId },
      orderBy: { createdAt: "desc" },
    }).catch(() => []),
    // Disputes for claims on this video.
    db.rightsDispute.findMany({
      where: { claim: { videoId } },
      orderBy: { createdAt: "desc" },
    }).catch(() => []),
    db.videoCorrection.findMany({
      where: { videoId },
      orderBy: { timestamp: "asc" },
    }).catch(() => []),
    db.recommendationFeedback.findMany({
      where: { videoId },
      select: { reason: true, note: true, createdAt: true },
    }).catch(() => []),
    db.adDisclosure.findMany({
      where: { videoId },
      select: { adType: true, sponsor: true, isPaid: true },
    }).catch(() => []),
  ]);

  // Build moderation actions list.
  const moderationActions: any[] = [];

  // Rights claims = platform moderation actions.
  for (const claim of rightsClaims) {
    const dispute = rightsDisputes.find((d: any) => d.claimId === claim.id);
    moderationActions.push({
      id: claim.id,
      type: "rights_claim",
      action: claim.action, // monetize | block | mute | track | none
      reason: `${claim.claimType}: ${claim.matchedMaterial}`,
      claimant: claim.claimant,
      automated: false, // claims are filed by humans
      status: claim.status, // active | disputed | resolved | withdrawn
      appealAvailable: claim.status === "active" || claim.status === "disputed",
      appealStatus: dispute ? dispute.status : null, // submitted | under_review | accepted | rejected | closed
      appealResult: dispute ? dispute.resolution : null,
      timestamp: claim.timestampStart,
      entity: "platform", // §22: PLATFORM MODERATION
    });
  }

  // Corrections = creator self-moderation.
  for (const correction of corrections) {
    moderationActions.push({
      id: correction.id,
      type: "creator_correction",
      action: "correction_published",
      reason: correction.originalText + " → " + correction.correctedText,
      automated: false,
      status: correction.viewersNotified ? "viewers_notified" : "pending_notification",
      entity: "creator", // §22: CREATOR MODERATION
      timestamp: correction.timestamp,
    });
  }

  // Ad disclosures = transparency (not moderation per se, but related to §15).
  const adTransparency = adDisclosures.map((a: any) => ({
    adType: a.adType,
    sponsor: a.sponsor,
    isPaid: a.isPaid,
    label: adTypeLabel(a.adType),
  }));

  // Community feedback summary.
  const feedbackSummary: Record<string, number> = {};
  for (const f of feedback) {
    feedbackSummary[f.reason] = (feedbackSummary[f.reason] || 0) + 1;
  }

  return NextResponse.json({
    videoId,
    moderationActions,
    moderationCount: moderationActions.length,
    appealAvailable: moderationActions.some((a: any) => a.appealAvailable),
    // §22: "Users should understand which entity removed a comment where appropriate."
    entityBreakdown: {
      platform: moderationActions.filter((a: any) => a.entity === "platform").length,
      creator: moderationActions.filter((a: any) => a.entity === "creator").length,
    },
    adTransparency,
    communityFeedback: {
      summary: feedbackSummary,
      total: feedback.length,
      note: "Community feedback is not moderation — it's user-reported quality signals (§21). 'Not interested' is a preference, not a quality report.",
    },
    principle: "Per spec §23: Do not make enforcement unnecessarily opaque. Show action, reason, whether automated/human, appeal availability, appeal status, final result.",
  });
}

function adTypeLabel(adType: string): string {
  const labels: Record<string, string> = {
    platform_ad: "Platform Advertisement",
    creator_sponsorship: "Creator Sponsorship",
    affiliate: "Affiliate Content",
    paid_placement: "Paid Placement",
  };
  return labels[adType] || "Sponsored";
}
