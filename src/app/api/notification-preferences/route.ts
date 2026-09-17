import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/notification-preferences?bid=<browserId>
 * Returns the user's notification preferences.
 *
 * POST /api/notification-preferences
 * Body: { browserId, ...prefs }
 * Upserts the user's notification preferences.
 *
 * Per the social-media structuring audit: the NotificationPreference model
 * existed in the schema but had NO API endpoint — the Settings → Notifications
 * tab used stateless <Switch defaultChecked />. This fixes that gap.
 */

const DEFAULTS = {
  newVideos: true,
  comments: true,
  subscribers: true,
  tips: true,
  mentions: true,
  emailEnabled: true,
  pushEnabled: false,
};

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  if (!bid) return NextResponse.json({ preferences: DEFAULTS });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  try {
    const pref = await (db as any).notificationPreference.findUnique({
      where: { userId: verification.id },
    });
    return NextResponse.json({
      preferences: pref ? {
        newVideos: pref.newVideos,
        comments: pref.comments,
        subscribers: pref.subscribers,
        tips: pref.tips,
        mentions: pref.mentions,
        emailEnabled: pref.emailEnabled,
        pushEnabled: pref.pushEnabled,
      } : DEFAULTS,
    });
  } catch {
    return NextResponse.json({ preferences: DEFAULTS });
  }
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  if (!bid) return NextResponse.json({ error: "browserId required" }, { status: 400 });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`notif-prefs:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  // Extract only known fields.
  const updates: Record<string, any> = {};
  const allowedFields = ["newVideos", "comments", "subscribers", "tips", "mentions", "emailEnabled", "pushEnabled"];
  for (const field of allowedFields) {
    if (field in body) updates[field] = !!body[field];
  }

  if (Object.keys(updates).length === 0) {
    return NextResponse.json({ error: "no valid fields to update" }, { status: 400 });
  }

  try {
    const pref = await (db as any).notificationPreference.upsert({
      where: { userId: verification.id },
      create: { userId: verification.id, ...updates },
      update: updates,
    });
    return NextResponse.json({
      ok: true,
      preferences: {
        newVideos: pref.newVideos,
        comments: pref.comments,
        subscribers: pref.subscribers,
        tips: pref.tips,
        mentions: pref.mentions,
        emailEnabled: pref.emailEnabled,
        pushEnabled: pref.pushEnabled,
      },
    });
  } catch {
    return NextResponse.json({ error: "failed to save preferences" }, { status: 500 });
  }
}
