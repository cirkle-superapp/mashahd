/**
 * Shared formatting helpers for the YouTube-like app.
 */

/** Format a view count like 1234567 -> "1.2M views". */
export function formatViews(n: number): string {
  if (n < 1000) return `${n} view${n === 1 ? "" : "s"}`;
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}K views`;
  }
  if (n < 1_000_000_000) {
    const v = n / 1_000_000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}M views`;
  }
  const v = n / 1_000_000_000;
  return `${v.toFixed(1).replace(/\.0$/, "")}B views`;
}

/** Compact subscriber count: 1234567 -> "1.2M subscribers". */
export function formatSubs(n: number): string {
  if (n < 1000) return `${n} subscriber${n === 1 ? "" : "s"}`;
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}K subscribers`;
  }
  if (n < 1_000_000_000) {
    const v = n / 1_000_000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}M subscribers`;
  }
  const v = n / 1_000_000_000;
  return `${v.toFixed(1).replace(/\.0$/, "")}B subscribers`;
}

/** Compact count for like buttons: 12345 -> "12K". */
export function formatCount(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) {
    const v = n / 1000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}K`;
  }
  if (n < 1_000_000_000) {
    const v = n / 1_000_000;
    return `${v >= 100 ? Math.round(v) : v.toFixed(1).replace(/\.0$/, "")}M`;
  }
  const v = n / 1_000_000_000;
  return `${v.toFixed(1).replace(/\.0$/, "")}B`;
}

/** Duration in seconds -> "M:SS" or "H:MM:SS". */
export function formatDuration(sec: number): string {
  const s = Math.max(0, Math.floor(sec));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec2 = s % 60;
  if (h > 0) {
    return `${h}:${String(m).padStart(2, "0")}:${String(sec2).padStart(2, "0")}`;
  }
  return `${m}:${String(sec2).padStart(2, "0")}`;
}

/** Relative time like "3 days ago". */
export function timeAgo(d: Date | string): string {
  const date = typeof d === "string" ? new Date(d) : d;
  const diffMs = Date.now() - date.getTime();
  const sec = Math.floor(diffMs / 1000);
  if (sec < 60) return "just now";
  const min = Math.floor(sec / 60);
  if (min < 60) return `${min} minute${min === 1 ? "" : "s"} ago`;
  const hr = Math.floor(min / 60);
  if (hr < 24) return `${hr} hour${hr === 1 ? "" : "s"} ago`;
  const day = Math.floor(hr / 24);
  if (day < 30) return `${day} day${day === 1 ? "" : "s"} ago`;
  const month = Math.floor(day / 30);
  if (month < 12) return `${month} month${month === 1 ? "" : "s"} ago`;
  const year = Math.floor(month / 12);
  return `${year} year${year === 1 ? "" : "s"} ago`;
}

/** Deterministic pseudo-random integer in [0, max) seeded by a string. */
export function seededRandom(seed: string, max: number): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return Math.abs(h) % max;
}

/**
 * Returns a non-empty image URL for a video thumbnail or avatar. If the
 * provided URL is empty/undefined, returns a DiceBear placeholder generated
 * from the seed text (usually the video title or channel name).
 *
 * This prevents the browser console error:
 *   "An empty string ('') was passed to the src attribute. This may cause
 *    the browser to download the whole page again over the network."
 *
 * The placeholder is deterministic (same seed → same image) so it's stable
 * across re-renders.
 */
/**
 * getImageUrl — returns the URL if non-empty, otherwise generates a
 * from-scratch CustomAvatar data: URL (Pass 89).
 *
 * Previously: fell back to DiceBear HTTP API (https://api.dicebear.com/...).
 * Per user request Pass 89 ("we build everything from scratch"), this
 * is replaced with our own procedural SVG avatar generator. The fallback
 * is now a self-contained data: URL — no external HTTP dependency.
 *
 * The seed determines the avatar's geometric composition (3-circle motif
 * + constellation dots + monogram) + color palette (4 brand-tuned
 * variants). Same seed = same avatar, forever.
 *
 * Pass 89 addendum: also sanitizes any EXISTING DiceBear URLs in the
 * database (legacy from before Pass 89). If a stored URL points to
 * api.dicebear.com, it's converted at read-time to a CustomAvatar
 * data URL using the seed from the URL query string. This way, old
 * DB rows don't require a migration — they're transparently upgraded
 * on read.
 */
import { customAvatarDataUrl } from "./custom-avatar";

// Sanitize: if the URL is a legacy DiceBear URL, extract the seed + return a CustomAvatar.
function sanitizeLegacyExternalUrls(url: string): string {
  if (!url) return url;
  // DiceBear URL pattern: https://api.dicebear.com/7.x/<style>/svg?seed=<seed>&...
  const dicebearMatch = url.match(/api\.dicebear\.com\/[^?]+\?seed=([^&]+)/);
  if (dicebearMatch) {
    const seed = decodeURIComponent(dicebearMatch[1]);
    try { return customAvatarDataUrl(seed, 48); } catch { /* fall through */ }
  }
  // image-search URL pattern (legacy): https://z-cdn.chatglm.cn/...
  if (url.includes("z-cdn.chatglm.cn") || url.includes("image-search-mcp")) {
    // Can't recover the original title/category from the URL, so use a generic thumbnail.
    // The caller can pass a better seed if available.
    try { return customAvatarDataUrl("legacy-thumbnail", 48); } catch { /* fall through */ }
  }
  // Google Cloud Storage sample MP4s (legacy)
  if (url.includes("commondatastorage.googleapis.com")) {
    // Replace with local path — operator should drop the file at /public/samples/
    return url.replace(/https?:\/\/[^/]+\/[^/]+\/([^/]+\.mp4)/, "/samples/$1");
  }
  return url;
}

export function getImageUrl(url: string | undefined | null, seed: string): string {
  // Pass 89: sanitize any legacy external URLs first.
  const sanitized = url ? sanitizeLegacyExternalUrls(url) : "";
  if (sanitized && sanitized.trim().length > 0) return sanitized;
  try {
    return customAvatarDataUrl(seed || "mashahd", 48);
  } catch {
    // Fallback: a tiny inline SVG data URL (no dependency on custom-avatar module).
    // This is the absolute last-resort fallback.
    const safe = (seed || "M").slice(0, 1).toUpperCase();
    return `data:image/svg+xml;utf8,${encodeURIComponent(
      `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 48 48" width="48" height="48"><rect width="48" height="48" rx="24" fill="#FDFCF9"/><text x="24" y="30" text-anchor="middle" font-family="sans-serif" font-size="20" font-weight="700" fill="#1A4A5A">${safe}</text></svg>`
    )}`;
  }
}

/**
 * sanitizeUrl — Pass 89: converts any legacy external URL to a from-scratch
 * equivalent. Use this on any URL read from the DB to ensure no external
 * HTTP dependency leaks through (even for rows written before Pass 89).
 */
export function sanitizeUrl(url: string | undefined | null, seed?: string): string {
  if (!url) return seed ? getImageUrl(url, seed) : "";
  return sanitizeLegacyExternalUrls(url);
}
