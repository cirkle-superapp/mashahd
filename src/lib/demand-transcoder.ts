/**
 * DemandDrivenTranscoder — measures demand and triggers additional
 * renditions only when justified.
 *
 * Implements:
 *   - S12: Demand-driven transcoding
 *   - S13: Transcoding economics (EncodingValue scoring)
 *   - S16: CPU-aware worker concurrency
 */

export type RenditionId = "1080p" | "720p" | "480p" | "360p";

export interface DemandSignal {
  videoId: string;
  renditionId: RenditionId;
  requestCount: number; // how many viewers requested this rendition
  uniqueViewers: number; // unique viewers who switched to this rendition
  fallbackCount: number; // viewers who fell back because this rendition didn't exist
  lastRequestedAt: number;
}

export interface SystemResources {
  cpuLoad: number; // 0-1
  ramUsage: number; // 0-1
  diskFree: number; // bytes
  queueSize: number; // pending transcoding jobs
  activeJobs: number; // currently transcoding
}

const RENDITION_THRESHOLDS: Record<RenditionId, number> = {
  "1080p": 5, // need 5 unique requests to justify 1080p
  "720p": 2, // need 2 unique requests (baseline + 1)
  "480p": 0, // always generate (baseline)
  "360p": 0, // always generate (baseline)
};

const MAX_CONCURRENT_BY_PROFILE = {
  "cpu-safe": 1,
  balanced: 2,
  "high-quality": 1,
};

const demandSignals = new Map<string, DemandSignal>();

/**
 * Record a demand signal for a rendition.
 */
export function recordDemand(
  videoId: string,
  renditionId: RenditionId,
  isFallback: boolean = false
): void {
  const key = `${videoId}:${renditionId}`;
  let signal = demandSignals.get(key);
  if (!signal) {
    signal = {
      videoId,
      renditionId,
      requestCount: 0,
      uniqueViewers: 0,
      fallbackCount: 0,
      lastRequestedAt: Date.now(),
    };
    demandSignals.set(key, signal);
  }
  signal.requestCount++;
  signal.lastRequestedAt = Date.now();
  if (isFallback) signal.fallbackCount++;
}

/**
 * Record a unique viewer requesting a rendition.
 */
export function recordUniqueViewer(
  videoId: string,
  renditionId: RenditionId,
  viewerId: string
): void {
  // In production this would use a set. For the in-memory version, we
  // just increment uniqueViewers when a new browserId requests.
  recordDemand(videoId, renditionId);
  const key = `${videoId}:${renditionId}`;
  const signal = demandSignals.get(key);
  if (signal) signal.uniqueViewers++;
}

/**
 * Check if a rendition should be generated based on demand.
 *
 * EncodingValue = ExpectedViewerDemand × PlaybackValue × StorageReuse − CPUCost − StorageCost
 */
export function shouldGenerateRendition(
  videoId: string,
  renditionId: RenditionId,
  resources: SystemResources
): { generate: boolean; reason: string; score: number } {
  const key = `${videoId}:${renditionId}`;
  const signal = demandSignals.get(key);

  // Baseline renditions are always generated
  if (RENDITION_THRESHOLDS[renditionId] === 0) {
    return { generate: true, reason: "baseline rendition (always generated)", score: 1.0 };
  }

  if (!signal || signal.uniqueViewers < RENDITION_THRESHOLDS[renditionId]) {
    return {
      generate: false,
      reason: `demand too low (${signal?.uniqueViewers || 0}/${RENDITION_THRESHOLDS[renditionId]} unique viewers)`,
      score: 0,
    };
  }

  // Check system resources
  if (resources.cpuLoad > 0.85) {
    return { generate: false, reason: `CPU overloaded (${Math.round(resources.cpuLoad * 100)}%)`, score: 0.1 };
  }
  if (resources.diskFree < 1_000_000_000) {
    return { generate: false, reason: `disk space critical (< 1GB)`, score: 0.1 };
  }
  if (resources.activeJobs >= 3) {
    return { generate: false, reason: `too many active jobs (${resources.activeJobs})`, score: 0.3 };
  }

  // Calculate encoding value
  const expectedDemand = signal.uniqueViewers;
  const playbackValue = Math.min(1, signal.requestCount / 20); // 20 requests = max value
  const storageReuse = 0.5; // reuse probability for this rendition
  const cpuCost = resources.cpuLoad * 0.5;
  const storageCost = renditionId === "1080p" ? 0.3 : 0.1;
  const score = expectedDemand * playbackValue * storageReuse - cpuCost - storageCost;

  if (score > 0.5) {
    return { generate: true, reason: `demand-driven (score=${score.toFixed(2)}, ${signal.uniqueViewers} viewers)`, score };
  }

  return { generate: false, reason: `encoding value too low (score=${score.toFixed(2)})`, score };
}

/**
 * Get dynamic worker concurrency based on system resources (S16).
 */
export function getDynamicConcurrency(
  profile: "cpu-safe" | "balanced" | "high-quality",
  resources: SystemResources
): number {
  const maxConcurrent = MAX_CONCURRENT_BY_PROFILE[profile];

  // Reduce concurrency if CPU is heavily loaded
  if (resources.cpuLoad > 0.8) return 1;
  if (resources.cpuLoad > 0.6) return Math.min(maxConcurrent, 1);
  if (resources.ramUsage > 0.85) return 1;

  // Increase if underutilized (but never exceed profile max)
  return maxConcurrent;
}

/**
 * Request coalescing (S19, S62, S91) — single-flight for identical requests.
 */
const inflightRequests = new Map<string, Promise<Buffer>>();

export async function coalesceRequest(
  key: string,
  fetcher: () => Promise<Buffer>
): Promise<Buffer> {
  const existing = inflightRequests.get(key);
  if (existing) return existing;

  const promise = fetcher().finally(() => {
    inflightRequests.delete(key);
  });
  inflightRequests.set(key, promise);
  return promise;
}
