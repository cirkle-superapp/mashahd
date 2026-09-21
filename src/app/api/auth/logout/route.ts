import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/auth/logout
 * Body: { token }
 * Deletes the session, effectively logging the user out.
 *
 * Pass 57: added rate limiting (30/min/IP) to prevent logout-spam.
 */
export async function POST(req: NextRequest) {
  const ip = getClientIP(req);
  const rl = await rateLimit(`logout:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }
  const { token } = await req.json().catch(() => ({ token: "" }));
  if (token) {
    await db.session.deleteMany({ where: { token } });
  }
  return NextResponse.json({ ok: true });
}
