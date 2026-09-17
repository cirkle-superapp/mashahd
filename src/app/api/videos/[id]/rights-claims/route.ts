import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/videos/[id]/rights-claims
 * Returns all rights claims for a video (§53-54 transparency).
 *
 * POST /api/videos/[id]/rights-claims
 * Body: { claimant, claimType, matchedMaterial, timestampStart?, timestampEnd?, action?, territory?, evidence? }
 * Creates a rights claim (admin-only in production, open in dev for testing).
 *
 * Per spec §53: "Support where relevant: ownership metadata, licenses,
 * territorial restrictions, audio rights, music rights, claims, disputes,
 * evidence, counter-notices, enforcement records."
 * Per spec §54: "A rights claim should expose: matched material, approximate
 * location/timestamp, claimant, claim type, action, dispute pathway."
 */

const VALID_CLAIM_TYPES = ["copyright", "trademark", "music", "audio", "visual", "other"];
const VALID_ACTIONS = ["monetize", "block", "mute", "track", "none"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const claims = await db.rightsClaim.findMany({
    where: { videoId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    claims: claims.map((c: any) => ({
      id: c.id,
      claimant: c.claimant,
      claimType: c.claimType,
      matchedMaterial: c.matchedMaterial,
      timestampStart: c.timestampStart,
      timestampEnd: c.timestampEnd,
      action: c.action,
      territory: c.territory ? c.territory.split("|").filter(Boolean) : [],
      status: c.status,
      evidence: c.evidence,
      createdAt: c.createdAt?.toISOString(),
      // §54: dispute pathway
      canDispute: c.status === "active" || c.status === "disputed",
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`rights-claim:${ip}`, 5, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await req.json().catch(() => ({}));
  const claimant: string = (body.claimant || "").slice(0, 200);
  const claimType: string = body.claimType || "";
  const matchedMaterial: string = (body.matchedMaterial || "").slice(0, 1000);
  const timestampStart: number = Math.max(0, Math.floor(Number(body.timestampStart) || 0));
  const timestampEnd: number = Math.max(timestampStart, Math.floor(Number(body.timestampEnd) || 0));
  const action: string = VALID_ACTIONS.includes(body.action) ? body.action : "monetize";
  const territory: string = Array.isArray(body.territory)
    ? body.territory.slice(0, 50).join("|")
    : "";
  const evidence: string = (body.evidence || "").slice(0, 2000);

  if (!claimant || !claimType || !matchedMaterial) {
    return NextResponse.json({ error: "claimant+claimType+matchedMaterial required" }, { status: 400 });
  }
  if (!VALID_CLAIM_TYPES.includes(claimType)) {
    return NextResponse.json({ error: `invalid claimType. valid: ${VALID_CLAIM_TYPES.join(", ")}` }, { status: 400 });
  }

  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const claim = await db.rightsClaim.create({
    data: {
      videoId: id,
      claimant,
      claimType,
      matchedMaterial,
      timestampStart,
      timestampEnd,
      action,
      territory,
      evidence,
      status: "active",
    },
  });

  return NextResponse.json({
    ok: true,
    claim: {
      id: claim.id,
      claimant: claim.claimant,
      claimType: claim.claimType,
      matchedMaterial: claim.matchedMaterial,
      action: claim.action,
      status: claim.status,
      disputePathway: "The creator can file a dispute via POST /api/rights-claims/[id]/disputes",
    },
  });
}
