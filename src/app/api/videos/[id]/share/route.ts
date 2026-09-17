import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/videos/[id]/share
 * Body: { browserId, platform, shareType?, timestamp?, clipId?, chapterStart? }
 *   platform: "twitter" | "facebook" | "copy_link" | "email" | "whatsapp" | "telegram" | "native" | "other"
 *   shareType: "full" (default) | "timestamp" | "clip" | "chapter" | "transcript"
 *   timestamp: number (seconds) — for shareType="timestamp"
 *   clipId: string — for shareType="clip"
 *   chapterStart: number (seconds) — for shareType="chapter"
 *
 * Per spec §44: "Support: full video, timestamp, clip, chapter, playlist,
 * transcript location where legally appropriate."
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
  const shareType: string = body.shareType || "full";
  const timestamp: number | undefined = typeof body.timestamp === "number" ? Math.max(0, Math.floor(body.timestamp)) : undefined;
  const clipId: string | undefined = body.clipId ? String(body.clipId).slice(0, 60) : undefined;
  const chapterStart: number | undefined = typeof body.chapterStart === "number" ? Math.max(0, Math.floor(body.chapterStart)) : undefined;

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
      sharerId = "anonymous";
    }
  }

  // Validate platform against a whitelist.
  const ALLOWED_PLATFORMS = ["twitter", "facebook", "copy_link", "email", "whatsapp", "telegram", "native", "other"];
  const safePlatform = ALLOWED_PLATFORMS.includes(platform) ? platform : "other";

  // Validate shareType.
  const VALID_SHARE_TYPES = ["full", "timestamp", "clip", "chapter", "transcript"];
  const safeShareType = VALID_SHARE_TYPES.includes(shareType) ? shareType : "full";

  // Build the share URL based on shareType (§44).
  const baseUrl = process.env.APP_URL || "http://localhost:3000";
  let url = `${baseUrl}/?v=watch&id=${id}`;
  let shareText = `${video.title} — watch on Mashahd`;

  if (safeShareType === "timestamp" && timestamp !== undefined) {
    url += `&t=${timestamp}`;
    shareText = `${video.title} (at ${formatTimestamp(timestamp)}) — watch on Mashahd`;
  } else if (safeShareType === "clip" && clipId) {
    // Verify the clip exists + belongs to this video.
    const clip = await db.clip.findUnique({ where: { id: clipId } }).catch(() => null);
    if (!clip || clip.videoId !== id) {
      return NextResponse.json({ error: "clip not found" }, { status: 404 });
    }
    url += `&clip=${clipId}`;
    shareText = `${clip.title} (clip from ${video.title}) — Mashahd`;
  } else if (safeShareType === "chapter" && chapterStart !== undefined) {
    url += `&t=${chapterStart}`;
    shareText = `${video.title} (chapter at ${formatTimestamp(chapterStart)}) — watch on Mashahd`;
  } else if (safeShareType === "transcript" && timestamp !== undefined) {
    url += `&t=${timestamp}&tab=transcript`;
    shareText = `${video.title} (transcript at ${formatTimestamp(timestamp)}) — Mashahd`;
  }

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
    console.warn("[share] failed to record:", e);
  }

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
    shareType: safeShareType,
    shareUrl: platformUrls[safePlatform] || url,
    directUrl: url,
    shareText,
  });
}

function formatTimestamp(seconds: number): string {
  const m = Math.floor(seconds / 60);
  const s = Math.floor(seconds % 60);
  return `${m}:${String(s).padStart(2, "0")}`;
}
