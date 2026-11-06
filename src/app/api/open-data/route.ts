/**
 * GET /api/open-data — manifest of every open-source dataset shipped in-repo.
 *
 * Returns the full manifest (dataset count, records, license, source) plus
 * the zero-cost billing-risk declaration. This is the audit/transparency
 * endpoint that proves the platform is free-forever with no billing
 * exposure on its data layer.
 */
import { NextResponse } from "next/server";
import { openDataManifest } from "@/lib/open-data";

export async function GET() {
  return NextResponse.json(openDataManifest());
}
