import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/interest-profiles?bid=<browserId>
 * Returns all interest profiles for the user, with the active one flagged.
 *
 * POST /api/interest-profiles
 * Body: { browserId, name, categories? }
 * Creates a new interest profile (§28).
 *
 * PATCH /api/interest-profiles
 * Body: { browserId, profileId, action: "activate" | "update", name?, categories? }
 * Activates or updates a profile (§28).
 *
 * DELETE /api/interest-profiles
 * Body: { browserId, profileId }
 * Deletes a profile.
 *
 * Per spec §28: "Support separate recommendation contexts such as:
 * Personal, Work, Research, Technology, Entertainment, Business.
 * Do NOT require separate accounts.
 * A profile must not unintentionally leak preferences into another profile."
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  if (!bid) return NextResponse.json({ profiles: [] });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const profiles = await db.interestProfile.findMany({
    where: { userId: verification.id },
    orderBy: { createdAt: "asc" },
  });

  return NextResponse.json({
    profiles: profiles.map((p) => ({
      id: p.id,
      name: p.name,
      categories: p.categories ? p.categories.split("|").filter(Boolean) : [],
      isActive: p.isActive,
      createdAt: p.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const name: string = (body.name || "").slice(0, 60);
  const categories: string[] = Array.isArray(body.categories) ? body.categories.slice(0, 20) : [];

  if (!bid || !name) {
    return NextResponse.json({ error: "browserId+name required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`profiles:${ip}`, 20, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // Limit to 10 profiles per user (§28 — multiple but bounded).
  const existingCount = await db.interestProfile.count({ where: { userId: verification.id } });
  if (existingCount >= 10) {
    return NextResponse.json({ error: "Maximum 10 profiles allowed" }, { status: 400 });
  }

  const profile = await db.interestProfile.create({
    data: {
      userId: verification.id,
      name,
      categories: categories.join("|"),
      isActive: existingCount === 0, // first profile becomes active automatically
    },
  });

  return NextResponse.json({
    ok: true,
    profile: {
      id: profile.id,
      name: profile.name,
      categories,
      isActive: profile.isActive,
    },
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const profileId: string = body.profileId || "";
  const action: string = body.action || "";

  if (!bid || !profileId || !action) {
    return NextResponse.json({ error: "browserId+profileId+action required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  // Verify ownership.
  const profile = await db.interestProfile.findUnique({ where: { id: profileId } });
  if (!profile || profile.userId !== verification.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (action === "activate") {
    // Deactivate all other profiles, activate this one.
    await db.interestProfile.updateMany({
      where: { userId: verification.id, isActive: true },
      data: { isActive: false },
    });
    await db.interestProfile.update({
      where: { id: profileId },
      data: { isActive: true },
    });
    return NextResponse.json({ ok: true, activeProfileId: profileId });
  }

  if (action === "update") {
    const updates: any = {};
    if (typeof body.name === "string") updates.name = body.name.slice(0, 60);
    if (Array.isArray(body.categories)) {
      updates.categories = body.categories.slice(0, 20).join("|");
    }
    const updated = await db.interestProfile.update({
      where: { id: profileId },
      data: updates,
    });
    return NextResponse.json({
      ok: true,
      profile: {
        id: updated.id,
        name: updated.name,
        categories: updated.categories ? updated.categories.split("|").filter(Boolean) : [],
        isActive: updated.isActive,
      },
    });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const profileId: string = body.profileId || "";

  if (!bid || !profileId) {
    return NextResponse.json({ error: "browserId+profileId required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const profile = await db.interestProfile.findUnique({ where: { id: profileId } });
  if (!profile || profile.userId !== verification.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.interestProfile.delete({ where: { id: profileId } });

  // If we deleted the active profile, activate the first remaining one.
  if (profile.isActive) {
    const remaining = await db.interestProfile.findFirst({
      where: { userId: verification.id },
      orderBy: { createdAt: "asc" },
    });
    if (remaining) {
      await db.interestProfile.update({
        where: { id: remaining.id },
        data: { isActive: true },
      });
    }
  }

  return NextResponse.json({ ok: true });
}
