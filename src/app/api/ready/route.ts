import { NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/ready
 * Readiness probe — verifies the DB is reachable. Returns 200 if ready,
 * 503 if the DB is down. Used by load balancers + orchestration to
 * determine if the app should receive traffic.
 *
 * Separated from /api/media/health (liveness) so the two can be checked
 * independently. Liveness = "the process is up". Readiness = "the app can
 * serve requests".
 */
export async function GET() {
  try {
    await db.$queryRaw`SELECT 1`;
    return NextResponse.json({ status: "ready" });
  } catch (err) {
    return NextResponse.json(
      { status: "not_ready", error: String(err).slice(0, 200) },
      { status: 503 }
    );
  }
}
