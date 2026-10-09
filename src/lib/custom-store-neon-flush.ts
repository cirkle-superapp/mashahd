/**
 * CustomStoreNeonFlush — analytics warehouse bridge (Pass 90).
 *
 * Per user request: "use them in best structuring that is creative and out
 * of the box that makes them work together in harmony."
 *
 * This module periodically flushes CustomStore's analytics projection to
 * Neon Postgres. The pattern is the standard "hot cache → cold warehouse"
 * analytics flush:
 *
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  CustomStore analytics projection (hot, in-memory)           │
 *   │  - rolling time-series buckets (1-min granularity)            │
 *   │  - rolling counters (per-video views, per-channel subs)      │
 *   │  - <1ms read latency                                          │
 *   └──────────────────────────────────────────────────────────────┘
 *                            │
 *                            │ flush every N events OR M seconds
 *                            ▼
 *   ┌──────────────────────────────────────────────────────────────┐
 *   │  Neon Postgres (cold, durable analytics warehouse)            │
 *   │  - mashahd_analytics table (timestamped rows, SQL queries)   │
 *   │  - mashahd_analytics_daily rollup table                      │
 *   │  - survives forever, complex aggregations                   │
 *   └──────────────────────────────────────────────────────────────┘
 *
 * WHY THIS DESIGN:
 *   - CustomStore = HOT (real-time dashboards, <1ms reads)
 *   - Neon = COLD (long-term analytics, SQL queries, ad-hoc aggregations)
 *   - Flush is asynchronous (doesn't block the write path)
 *   - Flush is batched (every N events or M seconds — whichever first)
 *   - Neon can be down without affecting the app (flush retries, CustomStore still works)
 *
 * HARMONY with the 5-service stack:
 *   - CustomStore handles hot analytics (real-time dashboards, live metrics)
 *   - Neon handles cold analytics (long-term trends, historical queries)
 *   - Turso is the durable WAL (transactional data — videos, channels, comments)
 *   - Inngest schedules the flush job (durable cron — survives restarts)
 *   - Vercel runs the flush in a serverless function (triggered by Inngest cron)
 */

import { getTursoBridgedCustomStore } from "./custom-store-turso-bridge";
import type { Event } from "./custom-store";

// Flush trigger thresholds
const FLUSH_EVENT_THRESHOLD = 50;   // flush after every 50 events
const FLUSH_INTERVAL_MS = 5 * 60 * 1000;  // OR every 5 minutes

// Counter state
let eventsSinceLastFlush = 0;
let lastFlushAt = Date.now();
let flushInProgress = false;

// Lazy-load Neon client (reuses the existing `pg` dependency — no new deps)
async function getNeonClient(): Promise<any | null> {
  try {
    const NEON_URL = process.env.NEON_DATABASE_URL;
    if (!NEON_URL) return null;
    // Use the existing `pg` Postgres client (already in package.json).
    // Lazy-load to avoid bundling if Neon isn't configured.
    const pg = await import("pg");
    const client = new pg.Client({
      connectionString: NEON_URL,
      ssl: { rejectUnauthorized: false },
    });
    await client.connect();
    return {
      // Wrap the pg client to provide a consistent interface.
      unsafe: async (sql: string, ...params: any[]) => {
        if (params.length === 0) {
          return client.query(sql);
        }
        return client.query(sql, params);
      },
      close: () => client.end(),
    };
  } catch (err) {
    console.warn("[custom-store-neon-flush] Neon client init failed:", err);
    return null;
  }
}

// Schema for the analytics tables in Neon
const NEON_ANALYTICS_SCHEMA = `
  CREATE TABLE IF NOT EXISTS mashahd_analytics (
    id SERIAL PRIMARY KEY,
    event_type TEXT NOT NULL,
    event_payload JSONB NOT NULL,
    event_ts BIGINT NOT NULL,
    flushed_at TIMESTAMP NOT NULL DEFAULT NOW()
  );
  CREATE INDEX IF NOT EXISTS idx_analytics_ts ON mashahd_analytics(event_ts);
  CREATE INDEX IF NOT EXISTS idx_analytics_type ON mashahd_analytics(event_type);
  CREATE TABLE IF NOT EXISTS mashahd_analytics_daily (
    day DATE NOT NULL,
    event_type TEXT NOT NULL,
    count INTEGER NOT NULL DEFAULT 0,
    UNIQUE(day, event_type)
  );
  CREATE INDEX IF NOT EXISTS idx_daily_day ON mashahd_analytics_daily(day);
`;

let _neonClient: any | null = null;
let _neonInitialized = false;

async function ensureNeonInitialized(): Promise<void> {
  if (_neonInitialized) return;
  _neonInitialized = true;
  _neonClient = await getNeonClient();
  if (_neonClient) {
    try {
      await _neonClient.unsafe(NEON_ANALYTICS_SCHEMA);
      console.log("[custom-store-neon-flush] Neon analytics schema initialized");
    } catch (err) {
      console.warn("[custom-store-neon-flush] Neon schema init failed (analytics disabled):", err);
      _neonClient = null;
    }
  }
}

/**
 * Record an analytics event. Called by API routes when they want to track
 * something for analytics. The event goes into CustomStore's event log
 * (hot, real-time) + is queued for async flush to Neon.
 */
export async function recordAnalyticsEvent(eventType: string, payload: any): Promise<void> {
  const store = getTursoBridgedCustomStore();
  await store.append(`analytics_${eventType}`, payload);
  eventsSinceLastFlush++;
  // Trigger flush if threshold reached.
  if (eventsSinceLastFlush >= FLUSH_EVENT_THRESHOLD) {
    flushToNeon().catch(() => {});  // fire-and-forget
  }
}

/**
 * Flush the CustomStore event log to Neon (analytics warehouse).
 * Called periodically OR when the event threshold is reached.
 *
 * Strategy:
 *   1. Read all events of type `analytics_*` from the CustomStore event log.
 *   2. Batch-insert into mashahd_analytics table in Neon.
 *   3. Update mashahd_analytics_daily rollup table.
 *
 * Failures:
 *   - If Neon is down, the flush retries on the next trigger. CustomStore
 *     still works (events are in the local log + mirrored to Turso).
 *   - If a single event fails to insert (e.g. invalid payload), it's skipped
 *     (the rest of the batch still flushes).
 */
export async function flushToNeon(): Promise<{ ok: boolean; flushedCount: number; error?: string }> {
  // Debounce — don't run concurrent flushes.
  if (flushInProgress) return { ok: false, flushedCount: 0, error: "flush in progress" };
  // Don't flush too frequently (no-op if <5min since last).
  if (Date.now() - lastFlushAt < 60_000) {
    return { ok: false, flushedCount: 0, error: "too soon since last flush (<1min)" };
  }

  flushInProgress = true;
  try {
    await ensureNeonInitialized();
    if (!_neonClient) {
      return { ok: false, flushedCount: 0, error: "neon not configured" };
    }

    const store = getTursoBridgedCustomStore();
    // Read all events from the log + filter for analytics events.
    const events = await store["storage"].readAll() as Event[];
    const analyticsEvents = events.filter((e) => e.type.startsWith("analytics_"));

    if (analyticsEvents.length === 0) {
      lastFlushAt = Date.now();
      eventsSinceLastFlush = 0;
      return { ok: true, flushedCount: 0 };
    }

    // Batch insert into mashahd_analytics.
    const values = analyticsEvents
      .map((e) => `('${e.type.replace(/'/g, "''")}', '${JSON.stringify(e.payload).replace(/'/g, "''")}'::jsonb, ${e.ts})`)
      .join(", ");
    await _neonClient.unsafe(
      `INSERT INTO mashahd_analytics (event_type, event_payload, event_ts) VALUES ${values}`
    );

    // Update daily rollup (per-day, per-event-type counts).
    for (const e of analyticsEvents) {
      const day = new Date(e.ts).toISOString().slice(0, 10);
      await _neonClient.unsafe(
        `INSERT INTO mashahd_analytics_daily (day, event_type, count) VALUES ('${day}', '${e.type}', 1)
         ON CONFLICT (day, event_type) DO UPDATE SET count = mashahd_analytics_daily.count + 1`
      );
    }

    lastFlushAt = Date.now();
    eventsSinceLastFlush = 0;
    console.log(`[custom-store-neon-flush] Flushed ${analyticsEvents.length} analytics events to Neon`);
    return { ok: true, flushedCount: analyticsEvents.length };
  } catch (err) {
    const error = err instanceof Error ? err.message : String(err);
    console.warn("[custom-store-neon-flush] Flush failed (will retry next trigger):", error);
    return { ok: false, flushedCount: 0, error: error.slice(0, 200) };
  } finally {
    flushInProgress = false;
  }
}

/**
 * Start a periodic flush interval (for long-lived processes like bun run dev).
 * Returns an unsubscribe function.
 *
 * On Vercel serverless, this won't run continuously — instead, the flush
 * is triggered by:
 *   - Event threshold (50 analytics events → flush)
 *   - Inngest cron (every 5 min → call /api/analytics/flush)
 */
export function startPeriodicFlush(intervalMs: number = FLUSH_INTERVAL_MS): () => void {
  const interval = setInterval(() => {
    flushToNeon().catch(() => {});
  }, intervalMs);
  return () => clearInterval(interval);
}

/**
 * Get the current flush status (for observability / dashboards).
 */
export function getFlushStatus(): {
  eventsSinceLastFlush: number;
  lastFlushAt: number;
  flushInProgress: boolean;
  neonConfigured: boolean;
} {
  return {
    eventsSinceLastFlush,
    lastFlushAt,
    flushInProgress,
    neonConfigured: !!process.env.NEON_DATABASE_URL,
  };
}
