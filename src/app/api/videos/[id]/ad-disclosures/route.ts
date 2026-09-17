import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/videos/[id]/ad-disclosures
 * Returns all ad disclosures for a video (§61 transparency).
 *
 * POST /api/videos/[id]/ad-disclosures
 * Body: { adType, sponsor, product?, isPaid?, disclosureNote? }
 * Creates an ad disclosure (creator-side). Per spec §61.
 *
 * Per spec §61: "Separate: platform advertising, creator sponsorship,
 * affiliate content, paid placement. Never make paid content deceptive."
 * Per spec §15: "Never make paid placements look identical to organic results."
 *
 * This ensures viewers always know when content is sponsored.
 */

const VALID_AD_TYPES = ["platform_ad", "creator_sponsorship", "affiliate", "paid_placement"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const disclosures = await db.adDisclosure.findMany({
    where: { videoId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    disclosures: disclosures.map((d: any) => ({
      id: d.id,
      adType: d.adType,
      sponsor: d.sponsor,
      product: d.product,
      isPaid: !!d.isPaid,
      disclosureNote: d.disclosureNote,
      createdAt: d.createdAt?.toISOString(),
      // Human-readable label for the UI.
      label: adTypeLabel(d.adType),
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`ad-disclose:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await req.json().catch(() => ({}));
  const adType: string = body.adType || "";
  const sponsor: string = (body.sponsor || "").slice(0, 200);
  const product: string = (body.product || "").slice(0, 500);
  const isPaid: boolean = body.isPaid !== false; // default true
  const disclosureNote: string = (body.disclosureNote || "").slice(0, 1000);

  if (!adType || !sponsor) {
    return NextResponse.json({ error: "adType+sponsor required" }, { status: 400 });
  }
  if (!VALID_AD_TYPES.includes(adType)) {
    return NextResponse.json({ error: `invalid adType. valid: ${VALID_AD_TYPES.join(", ")}` }, { status: 400 });
  }

  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const disclosure = await db.adDisclosure.create({
    data: {
      videoId: id,
      adType,
      sponsor,
      product,
      isPaid,
      disclosureNote,
    },
  });

  return NextResponse.json({
    ok: true,
    disclosure: {
      id: disclosure.id,
      adType: disclosure.adType,
      sponsor: disclosure.sponsor,
      product: disclosure.product,
      isPaid: disclosure.isPaid,
      label: adTypeLabel(disclosure.adType),
    },
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
