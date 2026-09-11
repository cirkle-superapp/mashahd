/**
 * Simple in-memory rate limiter for API routes.
 *
 * Tracks requests per IP (or per key) in a sliding window. No external
 * dependencies (no Redis needed) — suitable for single-instance deployments.
 * For multi-instance deployments, replace with a Redis-backed limiter.
 */

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 60s.
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 60_000);

/**
 * Check if a request is rate-limited.
 * Returns { limited: boolean, remaining: number, resetAt: number }
 *
 * @param key     — the rate-limit key (typically the IP address)
 * @param limit   — max requests in the window (default 5)
 * @param windowMs — the window in milliseconds (default 60_000 = 1 min)
 */
export function rateLimit(
  key: string,
  limit = 5,
  windowMs = 60_000
): { limited: boolean; remaining: number; resetAt: number } {
  const now = Date.now();
  const entry = store.get(key);

  if (!entry || entry.resetAt < now) {
    // First request or window expired — start fresh.
    store.set(key, { count: 1, resetAt: now + windowMs });
    return { limited: false, remaining: limit - 1, resetAt: now + windowMs };
  }

  entry.count++;
  if (entry.count > limit) {
    return { limited: true, remaining: 0, resetAt: entry.resetAt };
  }

  return { limited: false, remaining: limit - entry.count, resetAt: entry.resetAt };
}

/** Extract the client IP from a Next.js request. */
export function getClientIP(req: Request): string {
  const forwarded = req.headers.get("x-forwarded-for");
  if (forwarded) return forwarded.split(",")[0].trim();
  const real = req.headers.get("x-real-ip");
  if (real) return real;
  return "unknown";
}
