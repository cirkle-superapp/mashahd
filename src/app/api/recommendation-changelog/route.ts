import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/recommendation-changelog?bid=<browserId>&limit=<n>
 *
 * Per spec §70: "Implement a user-facing explanation layer where useful:
 * 'My Recommendation Profile'. Show meaningful events such as:
 *   followed creator, blocked topic, watched repeated topic, explicit negative
 *   feedback, explicit positive feedback, reset recommendation profile."
 *
 * This endpoint returns the user's recommendation event log, newest first.
 * The FYP + feedback + blocks APIs all write to this changelog automatically,
 * so the user can see WHY their feed looks the way it does.
 *
 * Does NOT expose proprietary ranking formulas (§70).
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 100);

  if (!bid) return NextResponse.json({ events: [] });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`changelog:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const events = await db.recommendationChangelog.findMany({
    where: { userId: verification.id },
    orderBy: { createdAt: "desc" },
    take: limit,
  });

  return NextResponse.json({
    events: events.map((e) => {
      let metadata: any = {};
      try { metadata = JSON.parse(e.metadata); } catch { /* corrupted */ }
      return {
        id: e.id,
        eventType: e.eventType,
        description: e.description,
        metadata,
        createdAt: e.createdAt.toISOString(),
      };
    }),
    // Summary stats for the profile header.
    summary: {
      total: events.length,
      followedCreators: events.filter((e) => e.eventType === "followed_creator").length,
      blockedTopics: events.filter((e) => e.eventType === "blocked_topic").length,
      negativeFeedback: events.filter((e) => e.eventType === "negative_feedback").length,
      positiveFeedback: events.filter((e) => e.eventType === "positive_feedback").length,
      resets: events.filter((e) => e.eventType === "reset_profile").length,
    },
  });
}
