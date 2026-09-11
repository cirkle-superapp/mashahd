import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/auth/session?token=<sessionToken>
 * Validates a session token and returns the user profile if valid.
 * Used by the client to restore the session on page reload.
 *
 * POST /api/auth/session
 * Body: { token } — same as GET but via POST (for clients that can't set
 * query params on GET). Returns the user if the session is still valid.
 */
export async function GET(req: NextRequest) {
  const token = new URL(req.url).searchParams.get("token") || "";
  return verifySession(token);
}

export async function POST(req: NextRequest) {
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
