import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/rights-claims/[id]/disputes
 * Returns all disputes for a rights claim (§24, §54 transparency).
 *
 * POST /api/rights-claims/[id]/disputes
 * Body: { disputant, reason, evidence? }
 * Files a dispute against a rights claim (§24 appeal workflow).
 *
 * PATCH /api/rights-claims/[id]/disputes
 * Body: { disputeId, status, resolution? }
 * Updates the dispute status (admin/moderator action).
 *
 * Per spec §24: "Implement an appeal workflow. Track: submitted, under review,
 * additional information requested, accepted, rejected, closed."
 * Per spec §54: "A rights claim should expose: dispute pathway."
 */

const VALID_DISPUTE_STATUSES = ["submitted", "under_review", "info_requested", "accepted", "rejected", "closed"];

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const claim = await db.rightsClaim.findUnique({ where: { id } });
  if (!claim) {
    return NextResponse.json({ error: "claim not found" }, { status: 404 });
  }

  const disputes = await db.rightsDispute.findMany({
    where: { claimId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    claim: {
      id: claim.id,
      videoId: claim.videoId,
      claimant: claim.claimant,
      claimType: claim.claimType,
      matchedMaterial: claim.matchedMaterial,
      status: claim.status,
    },
    disputes: disputes.map((d: any) => ({
      id: d.id,
      disputant: d.disputant,
      reason: d.reason,
      evidence: d.evidence,
      status: d.status,
      resolution: d.resolution,
      createdAt: d.createdAt?.toISOString(),
      updatedAt: d.updatedAt?.toISOString(),
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`rights-dispute:${ip}`, 5, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await req.json().catch(() => ({}));
  const disputant: string = (body.disputant || "").slice(0, 200);
  const reason: string = (body.reason || "").slice(0, 1000);
  const evidence: string = (body.evidence || "").slice(0, 2000);

  if (!disputant || !reason) {
    return NextResponse.json({ error: "disputant+reason required" }, { status: 400 });
  }

  const claim = await db.rightsClaim.findUnique({ where: { id } });
  if (!claim) {
    return NextResponse.json({ error: "claim not found" }, { status: 404 });
  }

  // Create the dispute.
  const dispute = await db.rightsDispute.create({
    data: {
      claimId: id,
      disputant,
      reason,
      evidence,
      status: "submitted",
    },
  });

  // Update the claim status to "disputed".
  await db.rightsClaim.update({
    where: { id },
    data: { status: "disputed" },
  }).catch(() => {});

  return NextResponse.json({
    ok: true,
    dispute: {
      id: dispute.id,
      status: dispute.status,
      claimId: id,
    },
    message: "Dispute filed. The claim status is now 'disputed'. You will be notified when a decision is made.",
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const disputeId: string = body.disputeId || "";
  const status: string = body.status || "";
  const resolution: string = (body.resolution || "").slice(0, 1000);

  if (!disputeId || !status) {
    return NextResponse.json({ error: "disputeId+status required" }, { status: 400 });
  }
  if (!VALID_DISPUTE_STATUSES.includes(status)) {
    return NextResponse.json({ error: `invalid status. valid: ${VALID_DISPUTE_STATUSES.join(", ")}` }, { status: 400 });
  }

  const claim = await db.rightsClaim.findUnique({ where: { id } });
  if (!claim) {
    return NextResponse.json({ error: "claim not found" }, { status: 404 });
  }

  const dispute = await db.rightsDispute.findUnique({ where: { id: disputeId } });
  if (!dispute || dispute.claimId !== id) {
    return NextResponse.json({ error: "dispute not found" }, { status: 404 });
  }

  await db.rightsDispute.update({
    where: { id: disputeId },
    data: { status, resolution },
  });

  // If the dispute is accepted, update the claim status to "resolved".
  if (status === "accepted") {
    await db.rightsClaim.update({
      where: { id },
      data: { status: "resolved" },
    }).catch(() => {});
  } else if (status === "rejected") {
    await db.rightsClaim.update({
      where: { id },
      data: { status: "active" },
    }).catch(() => {});
  }

  return NextResponse.json({ ok: true, disputeId, status });
}
