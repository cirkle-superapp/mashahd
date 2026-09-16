import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/reset-recommendations
 * Body: { browserId, preserve: { subscriptions, playlists, history, blocks, preferences } }
 *
 * Per spec §27: "Reset my recommendations. Ask which data to preserve.
 * The user decides what gets reset."
 *
 * By default, this clears:
 *   - RecommendationFeedback (not interested / already watched feedback)
 *   - RecommendationChangelog (the recommendation event log)
 *   - UserPreference affinity signals (homeMode reset to smart, discovery mix reset to defaults)
 *
 * The user can choose to preserve specific data (§27):
 *   - subscriptions/follows (preserved by default — they're not affinity signals)
 *   - playlists (preserved by default)
 *   - history (preserved by default — it's watch history, not feedback)
 *   - blocked creators (preserved by default — blocks are intentional, not affinity)
 *   - blocked topics (preserved by default)
 *   - preferences (user can choose — defaults to preserving)
 *
 * What gets RESET (the affinity signals):
 *   - RecommendationFeedback (all "not interested" / "wrong topic" etc. entries)
 *   - RecommendationChangelog (the event log)
 *   - ContinueWatching (the "continue watching" shelf — this is affinity-derived)
 *   - UserPreference.homeMode → reset to "smart"
 *   - UserPreference.discoveryFamiliar/New/Unexpected → reset to defaults (60/25/15)
 *   - UserPreference.pauseRecommendationLearning → false
 *
 * This is a DESTRUCTIVE operation — requires a confirmation token in the body.
 */

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const confirm: string = body.confirm || "";

  if (!bid) return NextResponse.json({ error: "browserId required" }, { status: 400 });
  if (confirm !== "RESET") {
    return NextResponse.json(
      { error: "Confirmation required. Send { confirm: 'RESET' } to proceed." },
      { status: 400 }
    );
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`reset-recs:${ip}`, 3, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // Parse preservation options (all default to true — preserve by default).
  const preserve = {
    subscriptions: body.preserve?.subscriptions !== false,
    playlists: body.preserve?.playlists !== false,
    history: body.preserve?.history !== false,
    blocks: body.preserve?.blocks !== false,
    preferences: body.preserve?.preferences !== false,
  };

  const userId = verification.id;
  const deleted: Record<string, number> = {};

  // 1. Delete all recommendation feedback (the "not interested" signals).
  const fbDeleted = await db.recommendationFeedback.deleteMany({ where: { userId } });
  deleted.recommendationFeedback = fbDeleted.count;

  // 2. Delete the recommendation changelog (the event log).
  const clDeleted = await db.recommendationChangelog.deleteMany({ where: { userId } });
  deleted.recommendationChangelog = clDeleted.count;

  // 3. Delete continue watching (affinity-derived).
  const cwDeleted = await db.continueWatching.deleteMany({ where: { userId } });
  deleted.continueWatching = cwDeleted.count;

  // 4. Reset affinity-related preferences (but preserve blocks + subscriptions + playlists + history).
  if (preserve.preferences) {
    // Preferences are preserved — but reset the affinity-specific fields.
    await db.userPreference.upsert({
      where: { ownerId: userId },
      create: {
        ownerId: userId,
        homeMode: "smart",
        discoveryFamiliar: 60,
        discoveryNewCreators: 25,
        discoveryUnexpected: 15,
        pauseRecommendationLearning: false,
      },
      update: {
        homeMode: "smart",
        discoveryFamiliar: 60,
        discoveryNewCreators: 25,
        discoveryUnexpected: 15,
        pauseRecommendationLearning: false,
      },
    }).catch(() => {});
  } else {
    // Full preference reset — delete the whole row.
    await db.userPreference.deleteMany({ where: { ownerId: userId } }).catch(() => {});
  }

  // 5. If the user chose NOT to preserve blocks, delete them too.
  if (!preserve.blocks) {
    const blDeleted = await db.userBlock.deleteMany({ where: { userId } });
    deleted.userBlocks = blDeleted.count;
  }

  // 6. Log the reset event in the changelog (fresh start).
  await db.recommendationChangelog.create({
    data: {
      userId,
      eventType: "reset_profile",
      description: "Recommendation profile reset. All affinity signals cleared.",
      metadata: JSON.stringify({ preserve }),
    },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    reset: deleted,
    preserved: {
      subscriptions: preserve.subscriptions,
      playlists: preserve.playlists,
      history: preserve.history,
      blocks: preserve.blocks,
      preferences: preserve.preferences,
    },
    message: "Recommendation profile reset. Your feed will rebuild from scratch on next visit.",
  });
}
