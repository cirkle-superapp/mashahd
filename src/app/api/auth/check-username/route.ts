import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import bcrypt from "bcryptjs";
import { randomBytes } from "node:crypto";

/**
 * POST /api/auth/check-username
 * Body: { username }
 *
 * Live username availability checker. Returns whether the username is
 * available, plus auto-suggested alternatives if taken.
 *
 * Called in real-time (debounced) as the user types their desired CIRKLE
 * username on the registration form.
 */
export async function POST(req: NextRequest) {
  const { username } = await req.json().catch(() => ({ username: "" }));
  const cleaned = String(username || "")
    .toLowerCase()
    .replace(/[^a-z0-9_]/g, "")
    .slice(0, 30);

  if (!cleaned || cleaned.length < 3) {
    return NextResponse.json({
      available: false,
      reason: "Username must be at least 3 characters (letters, numbers, underscores)",
      suggestions: [],
    });
  }

  const existing = await db.user.findUnique({ where: { username: cleaned } });
  if (!existing) {
    return NextResponse.json({
      available: true,
      username: cleaned,
      suggestions: [],
    });
  }

  // Generate available alternatives.
  const suggestions: string[] = [];
  const bases = [
    `${cleaned}_${Math.floor(Math.random() * 999)}`,
    `${cleaned}${new Date().getFullYear()}`,
    `the_${cleaned}`,
    `${cleaned}_official`,
  ];
  for (const s of bases) {
    if (suggestions.length >= 3) break;
    const taken = await db.user.findUnique({ where: { username: s } });
    if (!taken) suggestions.push(s);
  }

  return NextResponse.json({
    available: false,
    reason: "This username is already taken",
    username: cleaned,
    suggestions,
  });
}
