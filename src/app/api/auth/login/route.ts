import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/auth/login
 * Body: { identifier, password }
 *   identifier = email OR phone number OR CIRKLE username
 *
 * Authenticates the user and returns a session token. The identifier is
 * matched against email, phone, and username columns.
 *
 * Rate limited: 5 attempts per minute per IP (brute-force protection).
 */
export async function POST(req: NextRequest) {
  // Rate limit: 5 login attempts per minute per IP.
  const ip = getClientIP(req);
  const rl = rateLimit(`login:${ip}`, 5, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "Too many login attempts. Please try again in a minute." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }

  const body = await req.json().catch(() => ({}));
  const identifier: string = String(body.identifier || "").trim().toLowerCase();
  const password: string = String(body.password || "");

  if (!identifier || !password) {
    return NextResponse.json({ error: "Identifier and password are required" }, { status: 400 });
  }

  // Match against email, phone, or username.
  const isEmail = identifier.includes("@");
  const user = await db.user.findFirst({
    where: {
      OR: [
        { email: isEmail ? identifier : undefined },
        { phone: isEmail ? undefined : identifier.replace(/[^0-9+]/g, "") },
        { username: identifier },
      ],
    },
  });

  if (!user) {
    return NextResponse.json({ error: "No account found with this email, phone, or username" }, { status: 404 });
  }

  if (!user.passwordHash) {
    return NextResponse.json({ error: "This account uses passkey authentication. Please use the passkey flow." }, { status: 400 });
  }

  const valid = await bcrypt.compare(password, user.passwordHash);
  if (!valid) {
    return NextResponse.json({ error: "Incorrect password" }, { status: 401 });
  }

  // Create a new session.
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.session.create({
    data: { userId: user.id, token, expiresAt },
  });

  return NextResponse.json({
    ok: true,
    user: {
      id: user.id,
      username: user.username,
      displayName: user.displayName,
      email: user.email,
      phone: user.phone,
      avatarUrl: user.avatarUrl,
      verified: user.verified,
    },
    sessionToken: token,
    expiresAt: expiresAt.toISOString(),
  });
}
