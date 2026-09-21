import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/auth/session?token=<sessionToken>
 * Validates a session token and returns the user profile if valid.
 * Used by the client to restore the session on page reload.
 *
 * POST /api/auth/session
 * Body: { token } — same as GET but via POST (for clients that can't set
 * query params on GET). Returns the user if the session is still valid.
 *
 * Pass 57: added rate limiting (30/min/IP) to prevent session-spam.
 */
export async function GET(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`session:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const token = new URL(req.url).searchParams.get("token") || "";
  return verifySession(token);
}

export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`session:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const { token } = await req.json().catch(() => ({ token: "" }));
  return verifySession(token);
}

async function verifySession(token: string) {
  if (!token) {
    return NextResponse.json({ authenticated: false });
  }
  const session = await db.session.findUnique({
    where: { token },
    include: { user: true },
  });
  if (!session || session.expiresAt < new Date()) {
    return NextResponse.json({ authenticated: false });
  }
  return NextResponse.json({
    authenticated: true,
    user: {
      id: session.user.id,
      username: session.user.username,
      displayName: session.user.displayName,
      email: session.user.email,
      phone: session.user.phone,
      avatarUrl: session.user.avatarUrl,
      verified: session.user.verified,
    },
    expiresAt: session.expiresAt.toISOString(),
  });
}
