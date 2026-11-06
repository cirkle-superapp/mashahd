/**
 * Mashahd — Open Data Loader (FREE FOREVER, zero-cost, fully offline)
 * ------------------------------------------------------------------
 * Loads curated open-source datasets that ship inside the repo under
 * `data/open-data/`. Every dataset is public-domain, CC0, CC-BY, or MIT
 * licensed — no API keys, no rate limits, no billing, no network calls
 * at runtime. Data is read once from disk and cached in-memory for the
 * lifetime of the process (Node module cache + local Map).
 *
 * Datasets included
 * ─────────────────
 *   countries/countries.json       250 countries (mledoze/countries, MIT)
 *   countries/regions.json           6 regions derived from countries
 *   languages/iso-639-derived.json 153 languages derived from countries
 *   currencies/iso-4217-derived.json 162 ISO-4217 currencies derived
 *   emoji/emoji.json              1,870 emoji (github/gemoji, MIT)
 *   geoip/country-coordinates.json  250 country lat/lng pairs
 *   geoip/timezone-to-country.json 312 IANA timezones → country (IANA tzdb, public domain)
 *   taxonomy/video-taxonomy.json    19 categories, 5 ratings, 6 moods (curated, CC0)
 *
 * This is the "outsmart competitors" data layer: every video platform
 * competitor either hardcodes a 5-country list, calls a paid GeoIP API,
 * or ships without i18n. Mashahd ships 250 countries / 153 languages /
 * 162 currencies / 312 timezones — fully offline, zero recurring cost.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";

const DATA_ROOT = join(process.cwd(), "data", "open-data");

// ── types ───────────────────────────────────────────────────────────────
export interface CountryRecord {
  cca2: string;
  cca3: string;
  name: { common: string; official: string };
  region: string;
  subregion: string;
  capital?: string[];
  currencies?: Record<string, { name: string; symbol: string }>;
  languages?: Record<string, string>;
  latlng?: [number, number];
  area?: number;
  flag?: string; // emoji flag
  callingCodes?: string[];
  borders?: string[];
}

export interface RegionRecord {
  name: string;
  countries: string[];
}

export interface LanguageRecord {
  code: string;
  name: string;
  nativeName: string;
  countries: string[];
}

export interface CurrencyRecord {
  code: string;
  name: string;
  symbol: string;
  countries: string[];
}

export interface EmojiRecord {
  emoji: string;
  description: string;
  category: string;
  aliases: string[];
  tags: string[];
  unicode_version: string;
  ios_version: string;
}

export interface CountryCoordinates {
  cca2: string;
  name: string;
  lat: number;
  lng: number;
  region: string;
  subregion: string;
}

export interface TimezoneCountryRecord {
  timezone: string;
  countryCode: string;
  countryName: string;
  region: string | null;
  subregion: string | null;
  coords: string;
}

export interface VideoTaxonomy {
  meta: { name: string; version: string; license: string; source: string };
  primaryCategories: Array<{ id: string; name: string; icon: string; color: string }>;
  contentRatings: Array<{ code: string; name: string; desc: string }>;
  moods: Array<{ id: string; name: string; emoji?: string; icon?: string; color: string }>;
}

// ── internal cache (loaded once) ────────────────────────────────────────
const cache = new Map<string, unknown>();

function load<T>(rel: string): T {
  if (cache.has(rel)) return cache.get(rel) as T;
  try {
    const raw = readFileSync(join(DATA_ROOT, rel), "utf8");
    const parsed = JSON.parse(raw) as T;
    cache.set(rel, parsed);
    return parsed;
  } catch (e) {
    const msg = e instanceof Error ? e.message : String(e);
    throw new Error(`[open-data] failed to load "${rel}": ${msg}`);
  }
}

// ── public API ──────────────────────────────────────────────────────────

/** All 250 countries (mledoze/countries format). */
export function countries(): CountryRecord[] {
  return load<CountryRecord[]>("countries/countries.json");
}

/** Lookup a single country by ISO 3166-1 alpha-2 code (e.g. "US", "EG"). */
export function countryByCode(cca2: string): CountryRecord | undefined {
  const upper = cca2.toUpperCase();
  return countries().find((c) => c.cca2 === upper);
}

/** 6 regions with member country codes. */
export function regions(): RegionRecord[] {
  return load<RegionRecord[]>("countries/regions.json");
}

/** 153 languages with the countries that speak each one. */
export function languages(): LanguageRecord[] {
  return load<LanguageRecord[]>("languages/iso-639-derived.json");
}

/** 162 ISO-4217 currencies with symbol + member countries. */
export function currencies(): CurrencyRecord[] {
  return load<CurrencyRecord[]>("currencies/iso-4217-derived.json");
}

/** 1,870 emoji with categories, descriptions, and tags. */
export function emoji(): EmojiRecord[] {
  return load<EmojiRecord[]>("emoji/emoji.json");
}

/** 250 countries with lat/lng for geo-distance matching. */
export function countryCoordinates(): CountryCoordinates[] {
  return load<CountryCoordinates[]>("geoip/country-coordinates.json");
}

/** 312 IANA timezones mapped to country codes (IANA tzdb, public domain). */
export function timezoneToCountry(): TimezoneCountryRecord[] {
  return load<TimezoneCountryRecord[]>("geoip/timezone-to-country.json");
}

/** Curated video taxonomy: 19 categories, 5 ratings, 6 moods (CC0). */
export function videoTaxonomy(): VideoTaxonomy {
  return load<VideoTaxonomy>("taxonomy/video-taxonomy.json");
}

// ── derived helpers ─────────────────────────────────────────────────────

/**
 * Resolve the viewer's country from their IANA timezone.
 *
 * Browsers expose timezone via `Intl.DateTimeFormat().resolvedOptions().timeZone`
 * — no IP-lookup API call required. This is the FREE FOREVER geo-localization
 * strategy: zero cost, zero rate-limits, zero PII storage, works offline.
 *
 * @returns country code (cca2) + name, or `{ countryCode: 'global' }` if unknown.
 */
export function resolveCountryFromTimezone(
  timezone: string | undefined | null
): { countryCode: string; countryName: string; region: string | null } {
  if (!timezone) return { countryCode: "global", countryName: "Global", region: null };
  const map = timezoneToCountry();
  const hit = map.find((t) => t.timezone === timezone);
  if (hit) {
    return {
      countryCode: hit.countryCode,
      countryName: hit.countryName,
      region: hit.region,
    };
  }
  return { countryCode: "global", countryName: "Global", region: null };
}

/**
 * Convert an ISO 3166-1 alpha-2 country code to its emoji flag
 * using Regional Indicator Symbol pairs. Pure computation — no data
 * lookup required.
 *
 *   "EG" → "🇪🇬"   "US" → "🇺🇸"   "JP" → "🇯🇵"
 */
export function countryCodeToFlag(cca2: string): string {
  if (!cca2 || cca2.length !== 2 || !/^[A-Za-z]{2}$/.test(cca2)) return "🌍";
  const A = 0x1f1e6; // REGIONAL INDICATOR SYMBOL LETTER A
  const upper = cca2.toUpperCase();
  return String.fromCodePoint(A + (upper.charCodeAt(0) - 65)) +
         String.fromCodePoint(A + (upper.charCodeAt(1) - 65));
}

/**
 * Countries formatted for UI selectors: grouped by region with computed
 * flag emojis. Pass a `limit` to cap the result count (default: all 250).
 */
export function countriesForSelector(opts?: {
  limit?: number;
  includeGlobal?: boolean;
}): Array<{ code: string; label: string; region: string }> {
  const limit = opts?.limit ?? 250;
  const includeGlobal = opts?.includeGlobal ?? true;
  const out: Array<{ code: string; label: string; region: string }> = [];
  if (includeGlobal) {
    out.push({ code: "global", label: "🌍 Global", region: "Global" });
  }
  for (const c of countries()) {
    if (out.length >= limit + (includeGlobal ? 1 : 0)) break;
    out.push({
      code: c.cca2,
      label: `${countryCodeToFlag(c.cca2)} ${c.name.common}`,
      region: c.region,
    });
  }
  return out;
}

/**
 * Find the nearest country to a given lat/lng using the country coordinates
 * database. Useful as a fallback when timezone alone is ambiguous (e.g.,
 * the US spans many timezones; the user may be in any of them).
 *
 * @returns nearest country code + name, or null if input invalid.
 */
export function nearestCountry(lat: number, lng: number): {
  countryCode: string;
  countryName: string;
  distanceKm: number;
} | null {
  const coords = countryCoordinates();
  if (!coords.length) return null;
  let best = { countryCode: "", countryName: "", distanceKm: Infinity };
  for (const c of coords) {
    const d = haversineKm(lat, lng, c.lat, c.lng);
    if (d < best.distanceKm) {
      best = { countryCode: c.cca2, countryName: c.name, distanceKm: Math.round(d) };
    }
  }
  return best.distanceKm === Infinity ? null : best;
}

function haversineKm(lat1: number, lng1: number, lat2: number, lng2: number): number {
  const R = 6371; // Earth radius (km)
  const toRad = (deg: number) => (deg * Math.PI) / 180;
  const dLat = toRad(lat2 - lat1);
  const dLng = toRad(lng2 - lng1);
  const a =
    Math.sin(dLat / 2) ** 2 +
    Math.cos(toRad(lat1)) * Math.cos(toRad(lat2)) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

/**
 * Manifest of all datasets — exposed at /api/open-data for transparency.
 * Proves the zero-cost, free-forever stack to operators and auditors.
 */
export function openDataManifest() {
  return {
    datasets: [
      {
        id: "countries",
        path: "countries/countries.json",
        records: countries().length,
        license: "MIT",
        source: "mledoze/countries (github.com/mledoze/countries)",
        sourceType: "downloaded-once, served-locally",
      },
      {
        id: "regions",
        path: "countries/regions.json",
        records: regions().length,
        license: "MIT (derived)",
        source: "derived from countries.json",
        sourceType: "locally-derived",
      },
      {
        id: "languages",
        path: "languages/iso-639-derived.json",
        records: languages().length,
        license: "MIT (derived)",
        source: "derived from countries.json language fields",
        sourceType: "locally-derived",
      },
      {
        id: "currencies",
        path: "currencies/iso-4217-derived.json",
        records: currencies().length,
        license: "MIT (derived)",
        source: "derived from countries.json currency fields",
        sourceType: "locally-derived",
      },
      {
        id: "emoji",
        path: "emoji/emoji.json",
        records: emoji().length,
        license: "MIT",
        source: "github/gemoji (github.com/github/gemoji)",
        sourceType: "downloaded-once, served-locally",
      },
      {
        id: "geoip-coordinates",
        path: "geoip/country-coordinates.json",
        records: countryCoordinates().length,
        license: "MIT (derived)",
        source: "derived from countries.json latlng fields",
        sourceType: "locally-derived",
      },
      {
        id: "timezone-to-country",
        path: "geoip/timezone-to-country.json",
        records: timezoneToCountry().length,
        license: "Public domain",
        source: "IANA Time Zone Database (data.iana.org/time-zones)",
        sourceType: "downloaded-once, served-locally",
      },
      {
        id: "video-taxonomy",
        path: "taxonomy/video-taxonomy.json",
        records: videoTaxonomy().primaryCategories.length,
        license: "CC0 (public domain)",
        source: "curated from iTunes/YouTube conventions",
        sourceType: "locally-curated",
      },
    ],
    totalRecords:
      countries().length +
      regions().length +
      languages().length +
      currencies().length +
      emoji().length +
      countryCoordinates().length +
      timezoneToCountry().length +
      videoTaxonomy().primaryCategories.length,
    billingRisk: "NONE — every dataset is downloaded once and served from disk. No API keys, no rate limits, no network calls at runtime.",
    costPerMonth: "$0",
  };
}
