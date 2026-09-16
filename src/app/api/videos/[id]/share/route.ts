import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/videos/[id]/share
 * Body: { browserId, platform }
 *   platform: "twitter" | "facebook" | "copy_link" | "email" | ...
 *
 * Records a share event for virality metrics + recommendations.
 * The Share model exists in the schema but had no API (social-media
 * structuring audit gap).
 *
 * SECURITY: verifies browserId signature. Rate limited: 30/min per IP.
 * Does NOT require auth (sharing is public) — but the browserId signature
 * prevents fabrication.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const browserId: string = body.browserId || "";
  const platform: string = body.platform || "copy_link";

  // Rate limit.
  const ip = getClientIP(req);
  const rl = await rateLimit(`share:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Verify browserId if provided (optional — anonymous shares allowed).
  let sharerId = "anonymous";
  if (browserId) {
    const verification = verifyBrowserId(browserId);
    if (verification.valid) {
      sharerId = verification.id;
    } else {
      // Don't fail — just record as anonymous.
      sharerId = "anonymous";
    }
  }

  // Validate platform against a whitelist.
  const ALLOWED_PLATFORMS = ["twitter", "facebook", "copy_link", "email", "whatsapp", "telegram", "native", "other"];
  const safePlatform = ALLOWED_PLATFORMS.includes(platform) ? platform : "other";

  // Record the share event.
  try {
    await db.share.create({
      data: {
        videoId: id,
        sharerId,
        platform: safePlatform,
      },
    });
  } catch (e) {
    // Non-critical — log and continue (the share UI still works).
    console.warn("[share] failed to record:", e);
  }

  // Build the share URL.
  const url = `${process.env.APP_URL || "http://localhost:3000"}/?v=watch&id=${id}`;
  const shareText = `${video.title} — watch on Mashahd`;

  // Platform-specific share URLs.
  const platformUrls: Record<string, string> = {
    twitter: `https://twitter.com/intent/tweet?text=${encodeURIComponent(shareText)}&url=${encodeURIComponent(url)}`,
    facebook: `https://www.facebook.com/sharer/sharer.php?u=${encodeURIComponent(url)}`,
    whatsapp: `https://wa.me/?text=${encodeURIComponent(shareText + " " + url)}`,
    telegram: `https://t.me/share/url?url=${encodeURIComponent(url)}&text=${encodeURIComponent(shareText)}`,
    email: `mailto:?subject=${encodeURIComponent(shareText)}&body=${encodeURIComponent(url)}`,
    copy_link: url,
    native: url,
    other: url,
  };

  return NextResponse.json({
    ok: true,
    platform: safePlatform,
    shareUrl: platformUrls[safePlatform] || url,
    directUrl: url,
  });
}
