/**
 * GET /api/open-data/countries — 250 countries with computed flag emojis.
 *
 * Query params:
 *   ?format=selector   → [{code, label, region}] for UI <select> elements
 *                        (label = "🇪🇬 Egypt" computed via Regional Indicators)
 *   ?limit=N           → cap result count (default: 250)
 *   ?includeGlobal=true → prepend a {code:'global'} entry (default: true)
 *   ?region=Africa     → filter by region name (case-insensitive)
 *   ?q=egy             → search by country name (case-insensitive substring)
 *
 * Default format: raw country records (mledoze/countries schema).
 */
import { NextResponse } from "next/server";
import {
  countries,
  countriesForSelector,
  countryCodeToFlag,
} from "@/lib/open-data";

export async function GET(req: Request) {
  const url = new URL(req.url);
  const format = url.searchParams.get("format");
  const limit = parseInt(url.searchParams.get("limit") || "250", 10);
  const includeGlobal = url.searchParams.get("includeGlobal") !== "false";
  const region = url.searchParams.get("region") || undefined;
  const q = url.searchParams.get("q")?.toLowerCase() || undefined;

  if (format === "selector") {
    let list = countriesForSelector({ limit: 1000, includeGlobal });
    if (region && region !== "Global") {
      list = list.filter((c) => c.region.toLowerCase() === region.toLowerCase());
    }
    if (q) {
      list = list.filter((c) => c.label.toLowerCase().includes(q));
    }
    return NextResponse.json({
      count: Math.min(list.length, limit),
      countries: list.slice(0, limit),
    });
  }

  let data = countries();
  if (region) {
    data = data.filter((c) => c.region.toLowerCase() === region.toLowerCase());
  }
  if (q) {
    data = data.filter(
      (c) =>
        c.name.common.toLowerCase().includes(q) ||
        c.name.official.toLowerCase().includes(q) ||
        c.cca2.toLowerCase().includes(q) ||
        c.cca3.toLowerCase().includes(q)
    );
  }

  const out = data.slice(0, limit).map((c) => ({
    code: c.cca2,
    cca3: c.cca3,
    name: c.name.common,
    officialName: c.name.official,
    flag: countryCodeToFlag(c.cca2),
    region: c.region,
    subregion: c.subregion,
    capital: c.capital?.[0] || null,
    languages: c.languages ? Object.keys(c.languages) : [],
    currencies: c.currencies ? Object.keys(c.currencies) : [],
    latlng: c.latlng || null,
    area: c.area || null,
    callingCode: c.callingCodes?.[0] || null,
    borders: c.borders || [],
  }));

  return NextResponse.json({
    count: out.length,
    totalAvailable: countries().length,
    countries: out,
  });
}
