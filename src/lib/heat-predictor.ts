/**
 * ContentHeatPredictor — predicts future content demand and pre-positions
 * high-value objects before peak demand arrives.
 *
 * Implements v4 sections:
 *   S102: Content heat prediction
 *   S103: Viral preheat
 *   S104: Origin thundering-herd protection
 *   S162: Viral start behavior
 */

export interface HeatPrediction {
  videoId: string;
  currentViewers: number;
  predictedViewers: number; // next 5 min
  growthRate: number; // per minute
  predictedHeatClass: "COLD" | "WARM" | "HOT" | "SUPERHOT";
  shouldPreheat: boolean;
  recommendedActions: string[];
}

interface ViewerHistory {
  videoId: string;
  timestamps: number[];
  counts: number[];
  sessionStartsPerMinute: number[];
  watchVelocities: number[];
  retention: number;
}

const histories = new Map<string, ViewerHistory>();

/**
 * Record a viewer count observation.
 */
export function recordViewerCount(
  videoId: string,
  count: number,
  sessionStarts: number = 0,
  watchVelocity: number = 0,
  retention: number = 0.5
): void {
  let hist = histories.get(videoId);
  if (!hist) {
    hist = {
      videoId,
      timestamps: [],
      counts: [],
      sessionStartsPerMinute: [],
      watchVelocities: [],
      retention,
    };
    histories.set(videoId, hist);
  }

  const now = Date.now();
  hist.timestamps.push(now);
  hist.counts.push(count);
  hist.sessionStartsPerMinute.push(sessionStarts);
  hist.watchVelocities.push(watchVelocity);
  if (retention > 0) hist.retention = retention;

  // Keep only last 30 minutes of data
  const cutoff = now - 30 * 60 * 1000;
  while (hist.timestamps.length > 0 && hist.timestamps[0] < cutoff) {
    hist.timestamps.shift();
    hist.counts.shift();
    hist.sessionStartsPerMinute.shift();
    hist.watchVelocities.shift();
  }
}

/**
 * Predict future heat based on historical data (S102).
 */
export function predictHeat(videoId: string): HeatPrediction | null {
  const hist = histories.get(videoId);
  if (!hist || hist.counts.length < 3) return null;

  const current = hist.counts[hist.counts.length - 1];
  const avgGrowthRate = calculateGrowthRate(hist.counts, hist.timestamps);
  const predictedViewers = Math.max(current, Math.round(current * (1 + avgGrowthRate * 5)));

  // Predict heat class
  let predictedHeatClass: "COLD" | "WARM" | "HOT" | "SUPERHOT" = "COLD";
  if (predictedViewers > 100) predictedHeatClass = "SUPERHOT";
  else if (predictedViewers > 20) predictedHeatClass = "HOT";
  else if (predictedViewers > 3) predictedHeatClass = "WARM";

  // Viral detection (S103)
  const recentGrowth = hist.counts.length >= 2
    ? (hist.counts[hist.counts.length - 1] - hist.counts[hist.counts.length - 2])
    : 0;
  const isViral = recentGrowth > 0 && (recentGrowth / Math.max(1, hist.counts[hist.counts.length - 2])) > 0.5;

  const shouldPreheat = isViral || (avgGrowthRate > 0.2 && predictedViewers > 5);

  const recommendedActions: string[] = [];
  if (isViral) {
    recommendedActions.push("VIRAL_PREHEAT: increase seed preparation");
    recommendedActions.push("VIRAL_PREHEAT: increase edge cache priority");
    recommendedActions.push("VIRAL_PREHEAT: increase replication factor");
    recommendedActions.push("VIRAL_PREHEAT: acquire scarce objects proactively");
  }
  if (predictedViewers > 50 && predictedHeatClass === "SUPERHOT") {
    recommendedActions.push("THUNDERING_HERD: enable request coalescing");
    recommendedActions.push("THUNDERING_HERD: promote to trusted seed");
    recommendedActions.push("THUNDERING_HERD: activate multiple edge caches");
  }
  if (predictedHeatClass === "HOT" && !shouldPreheat) {
    recommendedActions.push("HOT_CONTENT: normal P2P + moderate cache");
  }

  return {
    videoId,
    currentViewers: current,
    predictedViewers,
    growthRate: avgGrowthRate,
    predictedHeatClass,
    shouldPreheat,
    recommendedActions,
  };
}

/**
 * Calculate the growth rate from viewer count history.
 */
function calculateGrowthRate(counts: number[], timestamps: number[]): number {
  if (counts.length < 2) return 0;

  const n = counts.length;
  const recent = counts.slice(-Math.min(5, n));
  const older = counts.slice(0, Math.min(5, n));

  const avgRecent = recent.reduce((a, b) => a + b, 0) / recent.length;
  const avgOlder = older.reduce((a, b) => a + b, 0) / older.length;

  if (avgOlder === 0) return avgRecent > 0 ? 1 : 0;

  return (avgRecent - avgOlder) / avgOlder;
}

/**
 * Viral start behavior (S162).
 * When viewer growth accelerates, trigger preheat.
 */
export function detectViralStart(
  videoId: string,
  currentViewers: number,
  viewers1MinAgo: number
): boolean {
  if (viewers1MinAgo === 0 && currentViewers >= 5) return true; // sudden appearance
  if (viewers1MinAgo > 0 && currentViewers / viewers1MinAgo > 1.5) return true; // 50%+ growth
  return false;
}
