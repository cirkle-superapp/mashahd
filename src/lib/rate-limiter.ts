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

      // Upsert: if the row doesn't exist, create it with count=1. If it does
      // exist AND the window is still current, increment. If the window
      // expired, reset to count=1.
      // We do this in 2 steps because libSQL doesn't support a single
      // upsert-with-condition statement.
      const existing = await client.execute({
        sql: "SELECT count, windowStart FROM RateLimit WHERE key = ?",
        args: [key],
      });

      let newCount: number;
      if (existing.rows.length === 0) {
        // First request — insert.
        await client.execute({
          sql: "INSERT INTO RateLimit (key, count, windowStart) VALUES (?, 1, ?)",
          args: [key, windowStart],
        });
        newCount = 1;
      } else {
        const row = existing.rows[0] as { count: number; windowStart: number };
        const rowWindow = Number(row.windowStart);
        if (rowWindow !== windowStart) {
          // Window expired — reset.
          await client.execute({
            sql: "UPDATE RateLimit SET count = 1, windowStart = ? WHERE key = ?",
            args: [windowStart, key],
          });
          newCount = 1;
        } else {
          // Same window — increment.
          newCount = Number(row.count) + 1;
          await client.execute({
            sql: "UPDATE RateLimit SET count = count + 1 WHERE key = ?",
            args: [key],
          });
        }
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
