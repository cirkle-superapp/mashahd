/**
 * IntelligentDeliveryScheduler — the core "delivery brain" of the
 * Autonomous Distributed Media Fabric v3.
 *
 * Implements:
 *   - Multi-source delivery scheduling (S20)
 *   - Source score formula (S21)
 *   - Adaptive hedging (S22, S61)
 *   - Playback-aware source selection (S23)
 *   - Cost-aware routing (S59)
 *   - Reliability-aware routing (S60)
 *   - Delivery decision loop (S58)
 *   - Playback deadline (S106)
 *   - Object availability awareness (S92)
 *
 * The scheduler continuously executes:
 *   OBSERVE → MEASURE → SCORE → SELECT → DELIVER → CACHE → MEASURE RESULT → UPDATE SCORES
 */

export type SourceTier = "local_cache" | "p2p" | "edge" | "webtransport" | "origin";

export interface SourceInfo {
  tier: SourceTier;
  available: boolean;
  throughput: number; // estimated Mbps
  latency: number; // estimated ms
  reliability: number; // 0-1, based on historical success rate
  costScore: number; // 0-1, lower = cheaper for operator
  availability: number; // 0-1, probability this source has the object
}

export interface PlaybackContext {
  bufferDepth: number; // seconds of buffer remaining
  currentPosition: number; // seconds into the video
  segmentDuration: number; // seconds (default 6)
  rendition: string; // e.g. "720p"
  networkType: string;
}

export interface SourceScore {
  tier: SourceTier;
  score: number;
  effectiveValue: number;
  reason: string;
}

export interface DeliveryDecision {
  primary: SourceTier;
  hedge?: SourceTier;
  cancelAfter?: number; // ms — cancel the primary if not done by then
  reason: string;
}

/** Cost scores per tier (lower = cheaper for the operator). */
const TIER_COSTS: Record<SourceTier, number> = {
  local_cache: 0.01, // essentially free — no network
  p2p: 0.1, // low operator cost
  edge: 0.3, // self-hosted edge bandwidth
  webtransport: 0.4, // medium operator cost
  origin: 1.0, // highest — direct origin bandwidth
};

/**
 * Score a single source for a given playback context.
 *
 * SourceScore = Reliability + Throughput + LowLatency + Availability + CostAvoidance + BufferSafety
 *               − FailurePenalty − DataRisk − BatteryRisk
 */
export function scoreSource(source: SourceInfo, ctx: PlaybackContext): SourceScore {
  // Buffer safety — if buffer is low, penalize unreliable/slow sources
  const bufferSafety = source.reliability * Math.min(1, source.throughput / 2);
  const failurePenalty = (1 - source.reliability) * 2;
  const dataRisk = source.tier === "p2p" ? 0.1 : 0; // P2P data is untrusted until validated
  const batteryRisk = source.tier === "p2p" ? 0.05 : 0; // P2P uses more battery

  const costAvoidance = 1 - TIER_COSTS[source.tier]; // cheaper = higher avoidance

  // Throughput score — normalized to ~2 Mbps being "good enough"
  const throughputScore = Math.min(1, source.throughput / 2);

  // Latency score — lower is better
  const latencyScore = source.latency > 0 ? Math.max(0, 1 - source.latency / 1000) : 0.5;

  const score =
    source.reliability +
    throughputScore +
    latencyScore +
    source.availability +
    costAvoidance +
    bufferSafety -
    failurePenalty -
    dataRisk -
    batteryRisk;

  // Effective value = cost efficiency + reliability + latency + buffer safety
  const effectiveValue = costAvoidance + source.reliability + latencyScore + bufferSafety;

  return {
    tier: source.tier,
    score: Math.max(0, score),
    effectiveValue,
    reason: `${source.tier}: rel=${source.reliability.toFixed(2)} thr=${source.throughput.toFixed(1)}Mbps cost=${costAvoidance.toFixed(2)} buf=${bufferSafety.toFixed(2)}`,
  };
}

/**
 * Select the best source(s) for a media object given the current state.
 *
 * Implements adaptive hedging (S22, S61):
 *   - buffer > 20s → strongly favor P2P (cheap)
 *   - buffer 10-20s → normal hedge (P2P + delayed HTTP)
 *   - buffer 5-10s → aggressive HTTP fallback
 *   - buffer < 5s → reliability-first (HTTP/edge)
 */
export function selectSource(
  sources: SourceInfo[],
  ctx: PlaybackContext
): DeliveryDecision {
  // Score all available sources
  const scored = sources
    .filter((s) => s.available)
    .map((s) => scoreSource(s, ctx))
    .sort((a, b) => b.effectiveValue - a.effectiveValue);

  if (scored.length === 0) {
    return { primary: "origin", reason: "no sources available — HTTP fallback" };
  }

  // Calculate playback deadline
  const deadline = ctx.bufferDepth; // seconds until playback stalls
  const isCritical = deadline < 5;
  const isLow = deadline < 10;
  const isModerate = deadline < 20;
  const isHealthy = deadline >= 20;

  // Buffer-aware source selection
  if (isCritical) {
    // Reliability-first: pick the most reliable source
    const best = scored[0];
    return {
      primary: best.tier,
      reason: `critical buffer (${deadline.toFixed(1)}s) — reliability-first: ${best.reason}`,
    };
  }

  if (isLow) {
    // Aggressive HTTP fallback — pick HTTP/edge, hedge with P2P
    const http = scored.find((s) => s.tier === "origin" || s.tier === "edge");
    const p2p = scored.find((s) => s.tier === "p2p");
    return {
      primary: http?.tier || scored[0].tier,
      hedge: p2p?.tier,
      cancelAfter: 2000, // cancel P2P if not done in 2s
      reason: `low buffer (${deadline.toFixed(1)}s) — HTTP-first with P2P hedge`,
    };
  }

  if (isModerate) {
    // Normal hedge — pick cheapest reliable, hedge with HTTP
    const best = scored[0];
    const http = scored.find((s) => s.tier === "origin" || s.tier === "edge");
    return {
      primary: best.tier,
      hedge: http?.tier,
      cancelAfter: 5000,
      reason: `moderate buffer (${deadline.toFixed(1)}s) — cost-first with HTTP hedge`,
    };
  }

  // Healthy buffer — strongly favor P2P/cheap sources
  const p2p = scored.find((s) => s.tier === "p2p");
  const cache = scored.find((s) => s.tier === "local_cache");
  const best = cache || p2p || scored[0];
  return {
    primary: best.tier,
    reason: `healthy buffer (${deadline.toFixed(1)}s) — cost-optimized: ${best.reason}`,
  };
}

/**
 * Calculate the playback deadline for a segment.
 * How urgently does the player need this segment?
 */
export function calculateDeadline(
  currentPosition: number,
  bufferDepth: number,
  segmentTime: number
): "critical" | "low" | "moderate" | "healthy" {
  if (bufferDepth < 5) return "critical";
  if (bufferDepth < 10) return "low";
  if (bufferDepth < 20) return "moderate";
  return "healthy";
}
