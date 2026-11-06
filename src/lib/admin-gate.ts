import { NextRequest, NextResponse } from "next/server";

/**
 * Admin Gate — protects operational/admin endpoints from public access.
 *
 * In PRODUCTION: requires an `x-admin-token` header (or `?adminToken=`
 * query param) matching the ADMIN_TOKEN env var. Returns 403 if missing.
 * In DEVELOPMENT: allows access without a token (for local testing).
 *
 * If ADMIN_TOKEN is not set in production, ALL admin endpoints are locked
 * (fail-closed) — this prevents accidental exposure if the env var is
 * forgotten during deployment.
 *
 * Usage in a route handler:
 *   import { requireAdmin } from "@/lib/admin-gate";
 *   export async function GET(req: NextRequest) {
 *     const gate = requireAdmin(req);
 *     if (gate) return gate;  // 403 response
 *     // ... handler logic
 *   }
 */
export function requireAdmin(req: NextRequest): NextResponse | null {
  // Development mode — allow without token for local testing.
  if (process.env.NODE_ENV !== "production") {
    return null;
  }

  const expected = process.env.ADMIN_TOKEN;
  if (!expected) {
    // Fail-closed: no token configured in production → deny everything.
    return NextResponse.json(
      { error: "admin endpoints locked — ADMIN_TOKEN not configured" },
      { status: 403 }
    );
  }

  const provided = req.headers.get("x-admin-token") || req.nextUrl.searchParams.get("adminToken");
  if (!provided || provided !== expected) {
    return NextResponse.json(
      { error: "unauthorized — admin token required" },
      { status: 403 }
    );
  }

  return null;
}
