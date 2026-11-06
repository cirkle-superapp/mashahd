/**
 * GET /api/open-data/taxonomy — video categories, content ratings, moods.
 *
 * Returns the curated Mashahd video taxonomy (CC0, public domain):
 *   - 19 primary categories with icon + color
 *   - 5 content ratings (G, PG, T, MA, RP)
 *   - 6 mood presets (energetic, calm, focus, inspire, learn, laugh)
 */
import { NextResponse } from "next/server";
import { videoTaxonomy } from "@/lib/open-data";

export async function GET() {
  return NextResponse.json(videoTaxonomy());
}
