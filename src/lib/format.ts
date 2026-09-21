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
export function getImageUrl(url: string | undefined | null, seed: string): string {
  if (url && url.trim().length > 0) return url;
  return `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(seed || "mashahd")}&radius=50`;
}
