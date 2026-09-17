import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/channels/[id]/revenue?bid=<browserId>
 *
 * Per spec §51: "Where monetization exists, show: gross, platform fees,
 * taxes where applicable, rights costs where applicable, creator earnings,
 * pending amounts, payout status. Every deduction must be explainable."
 *
 * Returns a revenue transparency dashboard for a creator.
 *
 * ZERO-COST MODEL: Mashahd is zero-cost-by-default — there are no platform
 * fees, no ads revenue, no payment processing. This endpoint shows the
 * STRUCTURE of revenue transparency (what WOULD be shown if monetization
 * existed), with all amounts at $0.
 *
 * Per spec §62: "Do not artificially disable essential usability simply to
 * manufacture subscription pressure." This endpoint is informational, not
 * a paywall.
 */

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";

  const ip = getClientIP(req);
  const rl = await rateLimit(`revenue:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const channel = await db.channel.findUnique({ where: { id } });
  if (!channel) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  // Fetch monetization-related data.
  const videoIds = (await db.video.findMany({
    where: { channelId: id },
    select: { id: true },
  }).catch(() => []) as any[]).map((v: any) => v.id);

  const [adDisclosures, rightsClaims] = await Promise.all([
    db.adDisclosure.findMany({
      where: { videoId: { in: videoIds } },
    }).catch(() => []),
    db.rightsClaim.findMany({
      where: { videoId: { in: videoIds }, action: "monetize" },
    }).catch(() => []),
  ]);

  // Build the revenue transparency structure (§51).
  // All amounts are $0 in the zero-cost model.
  const revenue = {
    // §51: "gross"
    grossRevenue: {
      amount: 0,
      currency: "USD",
      breakdown: {
        adRevenue: 0, // no ads revenue in zero-cost model
        sponsorships: adDisclosures.filter((a: any) => a.adType === "creator_sponsorship").length,
        tips: 0, // tip system not wired to real payments
        memberships: 0, // no membership system
        premium: 0, // no premium revenue
      },
      note: "Mashahd operates on a zero-cost model. No revenue is collected or distributed.",
    },
    // §51: "platform fees"
    platformFees: {
      amount: 0,
      percentage: "0%",
      note: "Mashahd charges no platform fees. The platform is zero-cost-by-default.",
    },
    // §51: "taxes where applicable"
    taxes: {
      amount: 0,
      note: "No taxes applicable — no revenue is collected.",
    },
    // §51: "rights costs where applicable"
    rightsCosts: {
      amount: 0,
      activeMonetizationClaims: rightsClaims.length,
      note: rightsClaims.length > 0
        ? `${rightsClaims.length} active monetization claim(s) — revenue from claimed content is directed to the claimant, not the creator. In the zero-cost model, this is $0.`
        : "No active rights claims affecting revenue.",
    },
    // §51: "creator earnings"
    creatorEarnings: {
      amount: 0,
      currency: "USD",
      note: "Creator earnings are $0 in the zero-cost model. When monetization is enabled, this will show the net amount after fees, taxes, and rights costs.",
    },
    // §51: "pending amounts"
    pendingAmounts: {
      amount: 0,
      note: "No pending payouts — no revenue to disburse.",
    },
    // §51: "payout status"
    payoutStatus: {
      status: "not_applicable",
      lastPayout: null,
      nextPayout: null,
      note: "No payout system configured. Payouts will appear here when monetization is enabled.",
    },
    // Per §51: "Every deduction must be explainable."
    deductions: [
      {
        type: "platform_fee",
        label: "Platform Fee",
        amount: 0,
        percentage: "0%",
        explanation: "Mashahd charges no platform fees.",
      },
      {
        type: "rights_cost",
        label: "Rights Costs",
        amount: 0,
        explanation: rightsClaims.length > 0
          ? `${rightsClaims.length} monetization claim(s) redirect revenue to claimants.`
          : "No active rights claims.",
      },
      {
        type: "tax",
        label: "Taxes",
        amount: 0,
        explanation: "No taxes applicable in the current model.",
      },
    ],
    // Summary.
    summary: {
      gross: 0,
      totalDeductions: 0,
      netEarnings: 0,
      currency: "USD",
      model: "zero-cost-by-default",
      note: "Per spec §51: 'Every deduction must be explainable.' In the zero-cost model, all amounts are $0 with full transparency about the structure.",
    },
  };

  return NextResponse.json({
    channel: { id: channel.id, name: channel.name, handle: channel.handle },
    revenue,
    generatedAt: new Date().toISOString(),
  });
}
