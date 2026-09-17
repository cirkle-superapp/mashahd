import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/sessions?bid=<browserId>
 * Returns all active sessions for the user (§57 — device management).
 *
 * POST /api/sessions
 * Body: { browserId, deviceName?, userAgent? }
 * Creates or updates the current session (called on page load to track activity).
 *
 * DELETE /api/sessions
 * Body: { browserId, sessionId }
 * Revokes a session (sign out from a specific device).
 *
 * Per spec §57: "Audit and strengthen: MFA, passkeys, active sessions,
 * device management, login detection, account recovery, API key management, audit logs."
 */

// Generate a device fingerprint from the user agent + screen size.
function fingerprint(userAgent: string): string {
  // Simple hash — not cryptographic, just for deduplication.
  let hash = 0;
  for (let i = 0; i < userAgent.length; i++) {
    const char = userAgent.charCodeAt(i);
    hash = ((hash << 5) - hash) + char;
    hash = hash & hash;
  }
  return `fp_${Math.abs(hash).toString(36)}`;
}

// Parse a human-readable device name from the user agent.
function parseDeviceName(userAgent: string): string {
  const ua = userAgent.toLowerCase();
  let browser = "Unknown browser";
  if (ua.includes("edg/")) browser = "Edge";
  else if (ua.includes("chrome/")) browser = "Chrome";
  else if (ua.includes("firefox/")) browser = "Firefox";
  else if (ua.includes("safari/")) browser = "Safari";

  let os = "Unknown OS";
  if (ua.includes("windows")) os = "Windows";
  else if (ua.includes("mac os")) os = "macOS";
  else if (ua.includes("linux")) os = "Linux";
  else if (ua.includes("android")) os = "Android";
  else if (ua.includes("iphone") || ua.includes("ipad")) os = "iOS";

  return `${browser} on ${os}`;
}

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  if (!bid) return NextResponse.json({ sessions: [] });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const sessions = await db.activeSession.findMany({
    where: { userId: verification.id },
    orderBy: { lastSeenAt: "desc" },
  });

  return NextResponse.json({
    sessions: sessions.map((s: any) => ({
      id: s.id,
      deviceName: s.deviceName,
      ipAddress: s.ipAddress,
      lastSeenAt: s.lastSeenAt?.toISOString(),
      isCurrent: !!s.isCurrent,
      createdAt: s.createdAt?.toISOString(),
    })),
  });
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
  const rl = await rateLimit(`sessions:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const userAgent = (body.userAgent || req.headers.get("user-agent") || "").slice(0, 500);
  const fp = fingerprint(userAgent);
  const deviceName = body.deviceName || parseDeviceName(userAgent);
  const ipAddress = getClientIP(req);

  // Mark all existing sessions as not current.
  await db.activeSession.updateMany({
    where: { userId: verification.id, isCurrent: true },
    data: { isCurrent: false },
  }).catch(() => {});

  // Upsert the session (one per device fingerprint).
  const existing = await db.activeSession.findFirst({
    where: { userId: verification.id, deviceFingerprint: fp },
  });

  let session: any;
  if (existing) {
    session = await db.activeSession.update({
      where: { id: existing.id },
      data: {
        deviceName,
        ipAddress,
        userAgent,
        lastSeenAt: new Date(),
        isCurrent: true,
      },
    });
  } else {
    session = await db.activeSession.create({
      data: {
        userId: verification.id,
        deviceFingerprint: fp,
        deviceName,
        ipAddress,
        userAgent,
        isCurrent: true,
      },
    });
  }

  return NextResponse.json({
    ok: true,
    sessionId: session.id,
    deviceName: session.deviceName,
  });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const sessionId: string = body.sessionId || "";

  if (!bid || !sessionId) {
    return NextResponse.json({ error: "browserId+sessionId required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const session = await db.activeSession.findUnique({ where: { id: sessionId } });
  if (!session || session.userId !== verification.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.activeSession.delete({ where: { id: sessionId } });

  return NextResponse.json({ ok: true });
}
