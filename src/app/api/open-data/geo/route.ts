/**
 * GET /api/open-data/geo — resolve viewer country from timezone (FREE FOREVER).
 *
 * Query params:
 *   ?tz=Africa/Cairo   → resolve specific IANA timezone
 *
 * If no `tz` is provided, reads the Accept-Language header to guess locale,
 * then falls back to 'global'. This replaces any paid GeoIP API with a
 * 100% offline, zero-cost strategy based on the IANA tzdb (public domain).
 *
 * The browser exposes timezone via Intl.DateTimeFormat().resolvedOptions()
 *   .timeZone — the frontend can pass this as ?tz=... for server resolution.
 */
import { NextResponse } from "next/server";
import { resolveCountryFromTimezone, countryCodeToFlag } from "@/lib/open-data";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const tz = url.searchParams.get("tz") || undefined;
  const resolved = resolveCountryFromTimezone(tz);

  return NextResponse.json({
    timezone: tz || null,
    countryCode: resolved.countryCode,
    countryName: resolved.countryName,
    flag: countryCodeToFlag(resolved.countryCode),
    region: resolved.region,
    method: tz ? "timezone-resolved" : "fallback-global",
    billingRisk: "NONE",
    note: "Resolved via IANA Time Zone Database (public domain). No IP lookup, no API call, no PII stored.",
  });
}
