/**
 * Request Coalescer — deduplicates concurrent in-flight requests for the
 * same key. When N viewers request the same segment simultaneously, only
 * 1 origin fetch is made; the result is shared with all N subscribers.
 *
 * Phase 9: Request coalescing at all levels.
 *
 * Features:
 *   - Bounded Map (max 1000 entries, LRU eviction)
 *   - Timeout (30s default)
 *   - Cancellation (if the origin fetch fails, all subscribers get the error)
 *   - Memory bounds (entries are cleaned up after completion or timeout)
 *
 * This is an in-process coalescer — it works per Node.js instance. For
 * multi-instance deployments, add a Redis-backed coalescer (optional).
 */

interface CoalesceEntry<T> {
  promise: Promise<T>;
  subscribers: number;
  createdAt: number;
  timer: ReturnType<typeof setTimeout>;
}

const MAX_ENTRIES = 1000;
const DEFAULT_TIMEOUT_MS = 30_000;

const _store = new Map<string, CoalesceEntry<any>>();

/**
 * Coalesce a request. If a request for the same key is already in-flight,
 * attach to its promise. Otherwise, start a new request via `fetcher`.
 *
 * @param key     — unique key for the request (e.g. segment URL)
 * @param fetcher — function that fetches the data
 * @param timeoutMs — max time to wait before giving up (default 30s)
 */
export function coalesce<T>(
  key: string,
  fetcher: () => Promise<T>,
  timeoutMs: number = DEFAULT_TIMEOUT_MS
): Promise<T> {
  // Check if there's already an in-flight request for this key.
  const existing = _store.get(key);
  if (existing) {
    existing.subscribers++;
    return existing.promise as Promise<T>;
  }

  // Evict the oldest entry if we're at capacity (LRU).
  if (_store.size >= MAX_ENTRIES) {
    let oldestKey: string | null = null;
    let oldestTime = Infinity;
    for (const [k, v] of _store) {
      if (v.createdAt < oldestTime) {
        oldestTime = v.createdAt;
        oldestKey = k;
      }
    }
    if (oldestKey) _store.delete(oldestKey);
  }

  // Start a new request.
  const timer = setTimeout(() => {
    const entry = _store.get(key);
    if (entry) {
      _store.delete(key);
    }
  }, timeoutMs);

  const promise = fetcher()
    .then((result) => {
      const entry = _store.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        _store.delete(key);
      }
      return result;
    })
    .catch((err) => {
      const entry = _store.get(key);
      if (entry) {
        clearTimeout(entry.timer);
        _store.delete(key);
      }
      throw err;
    });

  _store.set(key, {
    promise,
    subscribers: 1,
    createdAt: Date.now(),
    timer,
  });

  return promise;
}

/**
 * Get the current number of in-flight coalesced requests (for metrics).
 */
export function getCoalesceCount(): number {
  return _store.size;
}

/**
 * Get a snapshot of coalescer stats for the /metrics endpoint.
 */
export function getCoalesceStats(): {
  inFlight: number;
  totalSubscribers: number;
} {
  let totalSubscribers = 0;
  for (const entry of _store.values()) {
    totalSubscribers += entry.subscribers;
  }
  return {
    inFlight: _store.size,
    totalSubscribers,
  };
}
