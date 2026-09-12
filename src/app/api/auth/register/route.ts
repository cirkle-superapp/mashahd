import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/auth/register
 * Body: { identifier, password, username, displayName }
 *   identifier = email OR phone number
 *
 * Creates a new User with a unique CIRKLE username, hashes the password,
 * creates a Session, and returns the session token + user profile.
 *
 * The username is validated for availability server-side (double-check).
 * Rate limited: 3 registrations per minute per IP.
 */
export async function POST(req: NextRequest) {
  // Rate limit: 3 registrations per minute per IP.
  const ip = getClientIP(req);
  const rl = await rateLimit(`register:${ip}`, 3, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "Too many registration attempts. Please try again in a minute." },
      {
        status: 429,
        headers: { "Retry-After": String(Math.ceil((rl.resetAt - Date.now()) / 1000)) },
      }
    );
  }
  const body = await req.json().catch(() => ({}));
  const identifier: string = String(body.identifier || "").trim();
  const password: string = String(body.password || "");
  const username: string = String(body.username || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 30);
  const displayName: string = String(body.displayName || username).slice(0, 60);

  // Validate inputs.
  if (!identifier) {
    return NextResponse.json({ error: "Email or phone number is required" }, { status: 400 });
  }
  if (password.length < 6) {
    return NextResponse.json({ error: "Password must be at least 6 characters" }, { status: 400 });
  }
  if (username.length < 3) {
    return NextResponse.json({ error: "Username must be at least 3 characters" }, { status: 400 });
  }

  // Detect whether the identifier is an email or phone.
  const isEmail = identifier.includes("@");
  const email = isEmail ? identifier : null;
  const phone = isEmail ? null : identifier.replace(/[^0-9+]/g, "");

  if (isEmail && !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(identifier)) {
    return NextResponse.json({ error: "Invalid email address" }, { status: 400 });
  }
  if (!isEmail && phone.length < 7) {
    return NextResponse.json({ error: "Invalid phone number" }, { status: 400 });
  }

  // Check if the identifier is already registered.
  const existing = await db.user.findFirst({
    where: { OR: [{ email: email || undefined }, { phone: phone || undefined }] },
  });
  if (existing) {
    return NextResponse.json({ error: "An account with this email/phone already exists" }, { status: 409 });
  }

  // Double-check username availability (the client also checks live).
  const usernameTaken = await db.user.findUnique({ where: { username } });
  if (usernameTaken) {
    return NextResponse.json({ error: "This username is already taken. Please choose another." }, { status: 409 });
  }

  // Create the user.
  const passwordHash = await bcrypt.hash(password, 10);
  const user = await db.user.create({
    data: {
      email,
      phone,
      username,
      displayName,
      passwordHash,
      verified: false, // would be set true after email/SMS verification
    },
  });

  // Create a session (valid for 30 days).
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000);
  await db.session.create({
    data: {
      userId: user.id,
      token,
      expiresAt,
    },
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
