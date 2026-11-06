/**
 * GET /api/open-data/languages — 153 languages with speaker countries.
 *
 * Query params:
 *   ?q=ara   → search by code or name (case-insensitive)
 */
import { NextResponse } from "next/server";
import { languages } from "@/lib/open-data";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const q = url.searchParams.get("q")?.toLowerCase();
  let data = languages();
  if (q) {
    data = data.filter(
      (l) => l.code.toLowerCase().includes(q) || l.name.toLowerCase().includes(q)
    );
  }
  return NextResponse.json({ count: data.length, languages: data });
}
