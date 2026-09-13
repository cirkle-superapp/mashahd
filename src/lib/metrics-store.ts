/**
 * In-memory metrics store — shared across all API routes.
 *
 * Per v6 §79: aggregate before persistence. These counters are in-memory
 * only (reset on restart). They're read by /api/metrics and written to
 * by /api/media/telemetry, /api/ai/*, and the manifest route.
 *
 * This avoids writing every telemetry event to Turso (which would exhaust
 * the free-tier write quota). The DB is only used for durable session
 * records + batched telemetry, not for every metric increment.
 */

interface MetricStore {
  // Delivery (§174)
  originBytesServed: number;
  p2pBytesServed: number;
  cacheHits: number;
  cacheMisses: number;
  p2pHits: number;
  p2pMisses: number;
  duplicateBytes: number;
  // QoE (§175)
  totalStartupTime: number;
  startupCount: number;
  totalRebufferCount: number;
  rebufferSessions: number;
  // AI (§180)
  aiRequests: number;
  aiFallbacks: number;
}

const _store: MetricStore = {
  originBytesServed: 0,
  p2pBytesServed: 0,
  cacheHits: 0,
  cacheMisses: 0,
  p2pHits: 0,
  p2pMisses: 0,
  duplicateBytes: 0,
  totalStartupTime: 0,
  startupCount: 0,
  totalRebufferCount: 0,
  rebufferSessions: 0,
  aiRequests: 0,
  aiFallbacks: 0,
};

export type MetricKey = keyof MetricStore;

/**
 * Increment a metric counter by a value (default 1).
 */
export function incrementMetric(key: MetricKey, value: number = 1): void {
  _store[key] += value;
}

/**
 * Get a snapshot of all metrics (for /api/metrics).
 */
export function getMetrics(): Readonly<MetricStore> {
  return { ..._store };
}

/**
 * Reset all metrics (for testing — not called in production).
 */
export function resetMetrics(): void {
  for (const key of Object.keys(_store) as MetricKey[]) {
    _store[key] = 0;
  }
}
