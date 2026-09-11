import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/auth/logout
 * Body: { token }
 * Deletes the session, effectively logging the user out.
 */
export async function POST(req: NextRequest) {
  const { token } = await req.json().catch(() => ({ token: "" }));
  if (token) {
    await db.session.deleteMany({ where: { token } });
  }
  return NextResponse.json({ ok: true });
}
