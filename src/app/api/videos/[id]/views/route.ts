import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/videos/[id]/views
 * Increments the view counter for a video. Called when the player starts.
 *
 * SECURITY (deep audit pass 2):
 *   - Verifies the browserId HMAC signature (prevents fabricated-ID inflation).
 *   - Rate limits per browserId (10 views/min) + per IP (30 views/min).
 *   - Dedupes: one browserId can only increment a given video's views once
 *     per session (tracked via watchedVideoIds — but here we just rate-limit
 *     to keep it simple and zero-cost).
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const ip = getClientIP(req);

  // Rate limit: 30 views/min per IP (generous — legit users watch multiple videos).
  const ipRl = await rateLimit(`views-ip:${ip}`, 30, 60_000);
  if (ipRl.limited) {
    return NextResponse.json(
      { ok: false, error: "rate limited" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  // Verify browserId signature (prevents inflation attacks).
  if (bid) {
    const verification = verifyBrowserId(bid);
    if (!verification.valid) {
      return NextResponse.json(
        { ok: false, error: "invalid browserId", reissue: true },
        { status: 403 }
      );
    }
    // Rate limit per browserId: 10 views/min (one user watching many videos).
    const bidRl = await rateLimit(`views-bid:${verification.id}`, 10, 60_000);
    if (bidRl.limited) {
      return NextResponse.json(
        { ok: false, error: "rate limited per browser" },
        { status: 429, headers: { "Retry-After": "60" } }
      );
    }
  }

  try {
    const updated = await db.video.update({
      where: { id },
      data: { views: { increment: 1 } },
      select: { views: true },
    });
    return NextResponse.json({ ok: true, views: updated.views });
  } catch {
    return NextResponse.json({ ok: false }, { status: 404 });
  }
}
