"use client";

/**
 * LocalMediaCache — browser-side media segment cache using Cache Storage API.
 *
 * Implements:
 *   - S24: Local browser cache
 *   - S25: Browser cache budget
 *   - S26: Cache policy (LRU, TTL, heat, peer demand)
 *   - S27: Cache value algorithm
 *   - S63: Cache promotion (when heavily requested → increase priority)
 *   - S64: Cache demotion (disk pressure → evict cold)
 */

const CACHE_NAME = "mashahd-media-cache";
const DEFAULT_BUDGET_WIFI = 250 * 1024 * 1024; // 250 MB on Wi-Fi
const DEFAULT_BUDGET_LIMITED = 50 * 1024 * 1024; // 50 MB on limited
const DEFAULT_TTL = 30 * 60 * 1000; // 30 minutes
const EVICTION_BATCH = 5; // evict 5 items at a time when over budget

type CacheEntry = {
  url: string;
  size: number;
  cachedAt: number;
  lastAccessed: number;
  accessCount: number;
  heat: "HOT" | "WARM" | "COLD";
};

// In-memory index of cached entries (backed by Cache Storage)
const cacheIndex = new Map<string, CacheEntry>();
let totalCacheSize = 0;
let initialized = false;

async function ensureInit() {
  if (initialized) return;
  initialized = true;
  // Try to restore the index from IndexedDB
  try {
    const db = await openDB();
    const tx = db.transaction("cache-index", "readonly");
    const store = tx.objectStore("cache-index");
    const all = await store.getAll() as unknown as any[];
    for (const entry of all) {
      cacheIndex.set(entry.url, entry);
      totalCacheSize += entry.size;
    }
  } catch {
    // IndexedDB not available — cache works in-memory only
  }
}

function openDB(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open("mashahd-cache-db", 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains("cache-index")) {
        db.createObjectStore("cache-index", { keyPath: "url" });
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

async function persistEntry(entry: CacheEntry) {
  try {
    const db = await openDB();
    const tx = db.transaction("cache-index", "readwrite");
    tx.objectStore("cache-index").put(entry);
  } catch {
    // best-effort
  }
}

async function deleteEntry(url: string) {
  try {
    const db = await openDB();
    const tx = db.transaction("cache-index", "readwrite");
    tx.objectStore("cache-index").delete(url);
  } catch {
    // best-effort
  }
}

/**
 * Get the cache budget based on network conditions.
 */
export function getCacheBudget(networkType: string, saveData: boolean): number {
  if (saveData) return 0;
  if (networkType === "cellular" || networkType === "unknown") return 0;
  return networkType === "wifi" || networkType === "ethernet"
    ? DEFAULT_BUDGET_WIFI
    : DEFAULT_BUDGET_LIMITED;
}

/**
 * Try to get a segment from the local cache.
 */
export async function getCachedSegment(url: string): Promise<Response | null> {
  await ensureInit();
  const entry = cacheIndex.get(url);
  if (!entry) return null;

  // Check TTL
  if (Date.now() - entry.cachedAt > DEFAULT_TTL) {
    await evict(url);
    return null;
  }

  // Update access metadata
  entry.lastAccessed = Date.now();
  entry.accessCount++;
  if (entry.accessCount > 10) entry.heat = "HOT";
  else if (entry.accessCount > 3) entry.heat = "WARM";

  // Fetch from Cache Storage
  try {
    const cache = await caches.open(CACHE_NAME);
    const response = await cache.match(url);
    return response || null;
  } catch {
    return null;
  }
}

/**
 * Store a segment in the local cache.
 */
export async function setCachedSegment(url: string, response: Response): Promise<void> {
  await ensureInit();

  const size = Number(response.headers.get("Content-Length")) || 0;
  const budget = getCacheBudget(
    (navigator as any)?.connection?.type || "unknown",
    (navigator as any)?.connection?.saveData || false
  );

  if (budget === 0) return; // caching disabled

  // Evict if over budget
  while (totalCacheSize + size > budget && cacheIndex.size > 0) {
    await evictColdest();
  }

  // Store in Cache Storage
  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.put(url, response.clone());
  } catch {
    return;
  }

  const entry: CacheEntry = {
    url,
    size,
    cachedAt: Date.now(),
    lastAccessed: Date.now(),
    accessCount: 1,
    heat: "COLD",
  };

  cacheIndex.set(url, entry);
  totalCacheSize += size;
  await persistEntry(entry);
}

/**
 * Evict a specific URL from the cache.
 */
async function evict(url: string): Promise<void> {
  const entry = cacheIndex.get(url);
  if (!entry) return;

  try {
    const cache = await caches.open(CACHE_NAME);
    await cache.delete(url);
  } catch {
    // best-effort
  }

  cacheIndex.delete(url);
  totalCacheSize -= entry.size;
  await deleteEntry(url);
}

/**
 * Evict the coldest entries (LRU + heat-based eviction).
 * COLD entries are evicted first, then WARM, then HOT.
 */
async function evictColdest(): Promise<void> {
  const entries = Array.from(cacheIndex.entries()).sort((a, b) => {
    // Sort by heat (COLD first) then by lastAccessed (oldest first)
    const heatOrder = { COLD: 0, WARM: 1, HOT: 2 };
    const heatDiff = heatOrder[a[1].heat] - heatOrder[b[1].heat];
    if (heatDiff !== 0) return heatDiff;
    return a[1].lastAccessed - b[1].lastAccessed;
  });

  for (let i = 0; i < EVICTION_BATCH && i < entries.length; i++) {
    await evict(entries[i][0]);
  }
}

/**
 * Promote a segment's cache priority (S63).
 * Called when a segment is heavily requested.
 */
export function promoteCacheEntry(url: string): void {
  const entry = cacheIndex.get(url);
  if (!entry) return;
  if (entry.heat === "WARM") entry.heat = "HOT";
  else if (entry.heat === "COLD") entry.heat = "WARM";
  persistEntry(entry);
}

/**
 * Demote cold entries when disk pressure is high (S64).
 */
export async function evictColdEntries(): Promise<number> {
  let evicted = 0;
  for (const [url, entry] of cacheIndex) {
    if (entry.heat === "COLD" && Date.now() - entry.lastAccessed > 5 * 60 * 1000) {
      await evict(url);
      evicted++;
    }
  }
  return evicted;
}

/**
 * Cache value algorithm (S27):
 * CacheValue = FutureRequestProbability × PeerDemand × OriginCostAvoidance × ReuseProbability − StorageCost
 */
export function calculateCacheValue(
  futureRequestProbability: number,
  peerDemand: number,
  originCostAvoidance: number,
  reuseProbability: number,
  storageCost: number
): number {
  return (
    futureRequestProbability *
    peerDemand *
    originCostAvoidance *
    reuseProbability -
    storageCost
  );
}

/**
 * Get cache statistics for the HUD.
 */
export function getCacheStats() {
  return {
    entries: cacheIndex.size,
    totalBytes: totalCacheSize,
    hot: Array.from(cacheIndex.values()).filter((e) => e.heat === "HOT").length,
    warm: Array.from(cacheIndex.values()).filter((e) => e.heat === "WARM").length,
    cold: Array.from(cacheIndex.values()).filter((e) => e.heat === "COLD").length,
  };
}

/**
 * Clear the entire cache.
 */
export async function clearCache(): Promise<void> {
  try {
    await caches.delete(CACHE_NAME);
  } catch {
    // best-effort
  }
  cacheIndex.clear();
  totalCacheSize = 0;

  try {
    const db = await openDB();
    const tx = db.transaction("cache-index", "readwrite");
    tx.objectStore("cache-index").clear();
  } catch {
    // best-effort
  }
}
