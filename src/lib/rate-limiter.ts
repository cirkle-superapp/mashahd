/**
 * Rate limiter with dual-backend support.
 *
 * - In production (Vercel serverless): uses Turso (libSQL) so the rate limit
 *   state is shared across all function invocations. Without this, each
 *   serverless instance has its own in-memory Map and the limit is never
 *   enforced.
 * - In local dev: uses the in-memory Map (faster, no DB round-trip).
 *
 * The Turso-backed limiter uses an atomic UPSERT + increment via SQL, so it's
 * safe under concurrent requests. A `RateLimit` table stores (key, count,
 * windowStart). Entries older than the window are reset.
 */

import { createClient, type Client } from "@libsql/client";

interface RateLimitEntry {
  count: number;
  resetAt: number;
}

const store = new Map<string, RateLimitEntry>();

// Clean up expired entries every 60s (local dev only).
setInterval(() => {
  const now = Date.now();
  for (const [key, entry] of store) {
    if (entry.resetAt < now) store.delete(key);
  }
}, 60_000);

// Lazy-init the Turso client (only when needed, only in production).
let _tursoClient: Client | null = null;
let _tursoInitTried = false;

function getTursoClient(): Client | null {
  if (_tursoInitTried) return _tursoClient;
  _tursoInitTried = true;
  const url = process.env.TURSO_URL;
  const token = process.env.TURSO_AUTH_TOKEN;
  if (!url || !token) return null;
  try {
    // Convert libsql:// to https:// for the @libsql/client (it accepts both,
    // but https is more reliable in serverless environments).
    const httpsUrl = url.startsWith("libsql://") ? url.replace("libsql://", "https://") : url;
    _tursoClient = createClient({ url: httpsUrl, authToken: token });
    console.log("[rate-limiter] Using Turso-backed rate limiting");
  } catch (e) {
    console.warn("[rate-limiter] Turso init failed, falling back to in-memory:", e);
  }
  return _tursoClient;
}

// Ensure the RateLimit table exists (once per client).
let _tableEnsured = false;
async function ensureTable(client: Client): Promise<void> {
  if (_tableEnsured) return;
  try {
    await client.execute(
      `CREATE TABLE IF NOT EXISTS RateLimit (
        key TEXT PRIMARY KEY NOT NULL,
        count INTEGER NOT NULL DEFAULT 0,
        windowStart INTEGER NOT NULL
      )`
    );
    _tableEnsured = true;
  } catch {
    /* table may already exist — ignore */
  }
}

/**
 * Check if a request is rate-limited.
 *
 * In production (Turso available), uses an atomic SQL increment so the limit
 * is enforced across all serverless instances. In local dev, uses the
 * in-memory Map.
 */
export async function rateLimit(
  key: string,
  limit = 5,
  windowMs = 60_000
): Promise<{ limited: boolean; remaining: number; resetAt: number }> {
  const now = Date.now();
  const client = getTursoClient();

  // ── Turso-backed (production) ──
  if (client) {
    try {
      await ensureTable(client);
      const windowStart = now - (now % windowMs);
      const resetAt = windowStart + windowMs;

      // Pass 93: ATOMIC UPSERT — eliminates the race condition where
      // concurrent requests all read the same count via SELECT before
      // any of them writes the UPDATE. Now a single SQL statement:
      //   1. INSERT the row with count=1 if it doesn't exist
      //   2. On conflict (key exists), atomically:
      //      - If window is still current: increment count
      //      - If window expired: reset count to 1
      //   3. RETURNING count gives us the new value in one round-trip
      //
      // This is safe under concurrent requests because SQLite/libSQL
      // serializes writes — the UPSERT is atomic.
      const result = await client.execute({
        sql: `INSERT INTO RateLimit (key, count, windowStart) VALUES (?, 1, ?)
              ON CONFLICT(key) DO UPDATE SET
                count = CASE WHEN RateLimit.windowStart = excluded.windowStart
                  THEN RateLimit.count + 1
                  ELSE 1 END,
                windowStart = excluded.windowStart
              RETURNING count`,
        args: [key, windowStart],
      });

      let newCount = 1;
      if (result.rows && result.rows.length > 0) {
        newCount = Number((result.rows[0] as any).count);
      }

      if (newCount > limit) {
        return { limited: true, remaining: 0, resetAt };
      }
      return { limited: false, remaining: limit - newCount, resetAt };
    } catch (e) {
      // If Turso fails, fall through to in-memory (don't block the request).
      console.warn("[rate-limiter] Turso error, falling back to in-memory:", e);
    }
  }

  // ── In-memory (local dev) ──
  const entry = store.get(key);
  if (!entry || entry.resetAt < now) {
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
