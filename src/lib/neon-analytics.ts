import { Client } from "pg";

/**
 * Neon Postgres — analytics/telemetry warehouse.
 *
 * Turso remains the primary control-plane DB (users, videos, metadata).
 * Neon Postgres is used for:
 *   - Aggregated telemetry analytics (complex queries, GROUP BY, window functions)
 *   - QoE dashboards (startup time percentiles, rebuffer rates over time)
 *   - Content heat history (time-series viewer counts)
 *   - Cost analytics (R2 operations, origin bytes over time)
 *
 * Why Neon for analytics (not Turso):
 *   - Postgres has superior query engine for complex aggregations
 *   - Neon has a free tier (0.5 GB storage, unlimited reads)
 *   - Neon supports the Data API (REST) for serverless queries
 *   - Turso's SQLite has limited analytics query support
 *
 * Per v6 §79: "Aggregate before persistence."
 * We write aggregated batches to Neon, not every telemetry event.
 */

const NEON_URL = process.env.NEON_DATABASE_URL || "";
let _client: Client | null = null;

/**
 * Get the Neon Postgres client (lazy singleton).
 * Returns null if NEON_DATABASE_URL is not configured.
 */
export async function getNeonClient(): Promise<Client | null> {
  if (!NEON_URL) return null;

  if (!_client) {
    _client = new Client({ connectionString: NEON_URL });
    try {
      await _client.connect();
      console.log("[neon] Connected to Neon Postgres");
      await ensureSchema(_client);
    } catch (e) {
      console.warn("[neon] Connection failed:", e);
      _client = null;
      return null;
    }
  }
  return _client;
}

/**
 * Ensure the analytics schema exists.
 * Tables are created on first connect (idempotent).
 */
async function ensureSchema(client: Client): Promise<void> {
  await client.query(`
    CREATE TABLE IF NOT EXISTS telemetry_daily (
      date DATE NOT NULL,
      video_id TEXT NOT NULL,
      total_views INTEGER DEFAULT 0,
      total_watch_time_sec REAL DEFAULT 0,
      avg_startup_time_sec REAL DEFAULT 0,
      avg_rebuffer_count REAL DEFAULT 0,
      p2p_bytes BIGINT DEFAULT 0,
      cdn_bytes BIGINT DEFAULT 0,
      origin_reduction_pct REAL DEFAULT 0,
      PRIMARY KEY (date, video_id)
    );

    CREATE TABLE IF NOT EXISTS content_heat_history (
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      video_id TEXT NOT NULL,
      viewer_count INTEGER DEFAULT 0,
      heat_class TEXT DEFAULT 'COLD',
      swarm_count INTEGER DEFAULT 0,
      peer_count INTEGER DEFAULT 0
    );

    CREATE TABLE IF NOT EXISTS ai_usage (
      timestamp TIMESTAMPTZ NOT NULL DEFAULT NOW(),
      provider TEXT NOT NULL,
      feature TEXT NOT NULL,
      tokens_used INTEGER DEFAULT 0,
      latency_ms INTEGER DEFAULT 0,
      success BOOLEAN DEFAULT true
    );

    CREATE INDEX IF NOT EXISTS idx_telemetry_daily_date ON telemetry_daily(date);
    CREATE INDEX IF NOT EXISTS idx_heat_history_ts ON content_heat_history(timestamp);
    CREATE INDEX IF NOT EXISTS idx_ai_usage_ts ON ai_usage(timestamp);
  `);
}

/**
 * Write a daily telemetry aggregate.
 * Called by the telemetry batch flush (every 5 minutes).
 */
export async function writeTelemetryDaily(opts: {
  videoId: string;
  views: number;
  watchTimeSec: number;
  avgStartupSec: number;
  avgRebuffer: number;
  p2pBytes: number;
  cdnBytes: number;
}): Promise<void> {
  const client = await getNeonClient();
  if (!client) return;

  const date = new Date().toISOString().slice(0, 10);
  const originReduction = (opts.p2pBytes + opts.cdnBytes) > 0
    ? (opts.p2pBytes / (opts.p2pBytes + opts.cdnBytes)) * 100
    : 0;

  try {
    await client.query(
      `INSERT INTO telemetry_daily (date, video_id, total_views, total_watch_time_sec, avg_startup_time_sec, avg_rebuffer_count, p2p_bytes, cdn_bytes, origin_reduction_pct)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       ON CONFLICT (date, video_id)
       DO UPDATE SET total_views = total_views + EXCLUDED.total_views,
                     total_watch_time_sec = total_watch_time_sec + EXCLUDED.total_watch_time_sec,
                     avg_startup_time_sec = EXCLUDED.avg_startup_time_sec,
                     avg_rebuffer_count = EXCLUDED.avg_rebuffer_count,
                     p2p_bytes = p2p_bytes + EXCLUDED.p2p_bytes,
                     cdn_bytes = cdn_bytes + EXCLUDED.cdn_bytes,
                     origin_reduction_pct = EXCLUDED.origin_reduction_pct`,
      [date, opts.videoId, opts.views, opts.watchTimeSec, opts.avgStartupSec, opts.avgRebuffer, opts.p2pBytes, opts.cdnBytes, originReduction]
    );
  } catch (e) {
    console.warn("[neon] writeTelemetryDaily failed:", e);
  }
}

/**
 * Record AI usage for cost tracking (§180).
 */
export async function recordAIUsage(opts: {
  provider: string;
  feature: string;
  tokensUsed?: number;
  latencyMs: number;
  success: boolean;
}): Promise<void> {
  const client = await getNeonClient();
  if (!client) return;

  try {
    await client.query(
      `INSERT INTO ai_usage (provider, feature, tokens_used, latency_ms, success)
       VALUES ($1, $2, $3, $4, $5)`,
      [opts.provider, opts.feature, opts.tokensUsed || 0, opts.latencyMs, opts.success]
    );
  } catch (e) {
    console.warn("[neon] recordAIUsage failed:", e);
  }
}

/**
 * Get analytics dashboard data.
 */
export async function getAnalytics(days: number = 7): Promise<any> {
  const client = await getNeonClient();
  if (!client) return null;

  try {
    const [telemetry, heat, ai] = await Promise.all([
      client.query(
        `SELECT date, SUM(total_views) as views, SUM(total_watch_time_sec) as watch_time,
                AVG(avg_startup_time_sec) as avg_startup, AVG(avg_rebuffer_count) as avg_rebuffer,
                SUM(p2p_bytes) as p2p_bytes, SUM(cdn_bytes) as cdn_bytes,
                AVG(origin_reduction_pct) as origin_reduction
         FROM telemetry_daily
         WHERE date >= CURRENT_DATE - INTERVAL '${days} days'
         GROUP BY date ORDER BY date DESC`
      ),
      client.query(
        `SELECT video_id, MAX(viewer_count) as peak_viewers, heat_class
         FROM content_heat_history
         WHERE timestamp >= NOW() - INTERVAL '${days} days'
         GROUP BY video_id, heat_class
         ORDER BY peak_viewers DESC LIMIT 20`
      ),
      client.query(
        `SELECT provider, feature, COUNT(*) as requests,
                AVG(latency_ms) as avg_latency, SUM(CASE WHEN success THEN 1 ELSE 0 END) as successes
         FROM ai_usage
         WHERE timestamp >= NOW() - INTERVAL '${days} days'
         GROUP BY provider, feature ORDER BY requests DESC`
      ),
    ]);

    return {
      telemetry: telemetry.rows,
      heat: heat.rows,
      ai: ai.rows,
    };
  } catch (e) {
    console.warn("[neon] getAnalytics failed:", e);
    return null;
  }
}
