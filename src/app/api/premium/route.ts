import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/premium?bid=<browserId>
 *
 * Per spec §62: "Premium must provide genuine value. Potential value:
 * higher quality, offline features where licensed, expanded AI capability,
 * creator tools, enhanced analytics, additional storage, premium content.
 * Do not artificially disable essential usability simply to manufacture
 * subscription pressure."
 *
 * Returns the premium features available + the user's premium status.
 * All features listed provide GENUINE value — no artificial paywalls
 * on essential usability (per spec §62).
 *
 * ZERO-COST MODEL: Mashahd is zero-cost-by-default. Premium features are
 * additional value, not gated essentials. The "premium" tier is a future
 * product direction, not a current paywall.
 */

const PREMIUM_FEATURES = [
  {
    id: "higher_quality",
    label: "Higher quality streaming",
    description: "Stream in 4K/8K where source supports it. Free tier caps at 1080p.",
    category: "playback",
    essential: false,
    available: true,
  },
  {
    id: "offline_download",
    label: "Offline downloads",
    description: "Download videos for offline viewing where rights permit.",
    category: "playback",
    essential: false,
    available: false, // requires rights clearance
    note: "Pending content rights agreements.",
  },
  {
    id: "expanded_ai",
    label: "Expanded AI capability",
    description: "More AI recap generations per day, longer multi-video research, unlimited translations.",
    category: "ai",
    essential: false,
    available: true,
  },
  {
    id: "enhanced_analytics",
    label: "Enhanced creator analytics",
    description: "Extended retention curves, audience demographics, traffic sources, deeper distribution diagnostics.",
    category: "creator",
    essential: false,
    available: true,
  },
  {
    id: "additional_storage",
    label: "Additional storage",
    description: "More upload storage for creators (free tier: 5GB via Filebase).",
    category: "creator",
    essential: false,
    available: true,
  },
  {
    id: "premium_content",
    label: "Premium content library",
    description: "Access to premium-only videos from partner creators.",
    category: "content",
    essential: false,
    available: false, // requires content partnerships
    note: "Pending creator partnerships.",
  },
];

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";

  const ip = getClientIP(req);
  const rl = await rateLimit(`premium:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // Check premium status (always false in the zero-cost model — premium is a
  // future product direction, not a current paywall).
  let isPremium = false;
  if (bid) {
    const verification = verifyBrowserId(bid);
    if (verification.valid) {
      // In a real system, check a PremiumSubscription table here.
      // For now, all users are on the free tier with full essential usability.
      isPremium = false;
    }
  }

  return NextResponse.json({
    isPremium,
    tier: isPremium ? "premium" : "free",
    // §62: "Do not artificially disable essential usability simply to
    // manufacture subscription pressure."
    essentialUsabilityUnlocked: true,
    essentialUsabilityNote: "All essential features (playback, search, history, playlists, recommendations) are available on the free tier. Premium features are additional value, not gated essentials.",
    features: PREMIUM_FEATURES,
    availableFeatures: PREMIUM_FEATURES.filter(f => f.available),
    pendingFeatures: PREMIUM_FEATURES.filter(f => !f.available),
    // Zero-cost model.
    model: "zero-cost-by-default",
    monthlyCost: "$0",
  });
}
