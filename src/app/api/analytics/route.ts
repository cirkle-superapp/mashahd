import { NextRequest, NextResponse } from "next/server";
import { getAnalytics } from "@/lib/neon-analytics";

/**
 * GET /api/analytics?days=7
 *
 * Returns aggregated analytics data from Neon Postgres.
 * Per v6 §179: "Economic Dashboard" — admin diagnostics showing
 * origin traffic, P2P traffic, cache traffic, etc.
 *
 * Query params:
 *   days — number of days to look back (default 7)
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const days = parseInt(url.searchParams.get("days") || "7", 10);

  const analytics = await getAnalytics(days);

  if (!analytics) {
    return NextResponse.json(
      { error: "Analytics not available (Neon Postgres not configured)" },
      { status: 501 }
    );
  }

  return NextResponse.json({
    ok: true,
    days,
    ...analytics,
  });
}
