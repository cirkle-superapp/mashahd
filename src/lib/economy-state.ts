/**
 * EconomyState — tracks and manages the three economy state machines.
 *
 * Implements v4 sections:
 *   S68: Origin pressure mode
 *   S69: Peer pressure mode
 *   S132: Self-adaptive workload balancing
 *   S165: Media economy state machine
 *   S166: Origin economy state
 *   S167: P2P economy state
 */

import type { MediaState, OriginState, P2PState } from "./placement-engine";

export interface SystemMetrics {
  cpuLoad: number; // 0-1
  ramUsage: number; // 0-1
  diskPressure: number; // 0-1
  originBandwidth: number; // bytes/sec
  originRequestRate: number; // requests/sec
  peerCount: number;
  peerFailureRate: number; // 0-1
  p2pThroughput: number; // Mbps average
  viewerCount: number;
  activeSwarms: number;
  transcodeQueueDepth: number;
}

export interface EconomySnapshot {
  media: MediaState;
  origin: OriginState;
  p2p: P2PState;
  recommendations: string[];
}

/**
 * Self-adaptive workload balancing (S132).
 *
 * If CPU overloaded → reduce encoding concurrency
 * If origin overloaded → favor cache/P2P/edge
 * If P2P weak → favor HTTP/edge/WebTransport
 * If disk pressure → reduce disposable cache
 */
export function getAdaptiveRecommendations(metrics: SystemMetrics): string[] {
  const recs: string[] = [];

  // Origin pressure mode (S68)
  if (metrics.originRequestRate > 100 || metrics.originBandwidth > 10_000_000) {
    recs.push("ORIGIN_PRESSURE: increase cache/P2P/seed preference, enable request coalescing");
  }

  // Peer pressure mode (S69)
  if (metrics.peerCount < 3 || metrics.peerFailureRate > 0.3 || metrics.p2pThroughput < 0.5) {
    recs.push("PEER_PRESSURE: favor local cache, edge, WebTransport, HTTP fallback");
  }

  // CPU overload
  if (metrics.cpuLoad > 0.85) {
    recs.push("CPU_OVERLOAD: reduce transcode concurrency to 1, defer non-critical encoding");
  }

  // Disk pressure
  if (metrics.diskPressure > 0.9) {
    recs.push("DISK_CRITICAL: pause new media processing, aggressively evict cold cache");
  } else if (metrics.diskPressure > 0.8) {
    recs.push("DISK_WARNING: reduce disposable cache, defer encoding");
  }

  // RAM pressure
  if (metrics.ramUsage > 0.9) {
    recs.push("RAM_CRITICAL: reduce active peer connections, limit prefetch window");
  }

  return recs;
}

/**
 * Classify the full economy state from system metrics.
 */
export function classifyEconomy(metrics: SystemMetrics): EconomySnapshot {
  // Origin state (S166)
  let origin: OriginState = "NORMAL";
  if (metrics.cpuLoad > 0.9 || metrics.originRequestRate > 200) {
    origin = "CRITICAL_ORIGIN_PRESSURE";
  } else if (metrics.cpuLoad > 0.75 || metrics.originRequestRate > 100) {
    origin = "ORIGIN_PRESSURE";
  } else if (origin !== "NORMAL" && metrics.cpuLoad < 0.5) {
    origin = "RECOVERY";
  }

  // P2P state (S167)
  let p2p: P2PState = "NO_PEERS";
  if (metrics.peerCount === 0) {
    p2p = "NO_PEERS";
  } else if (metrics.peerFailureRate > 0.4 || metrics.p2pThroughput < 0.2) {
    p2p = "UNSTABLE";
  } else if (metrics.peerCount > 20) {
    p2p = "HIGH_DENSITY";
  } else if (metrics.peerCount >= 3) {
    p2p = "HEALTHY";
  } else {
    p2p = "LOW_DENSITY";
  }

  // Media state (S165) — simplified from viewer count
  let media: MediaState = "COLD";
  if (metrics.viewerCount > 100) media = "SUPERHOT";
  else if (metrics.viewerCount > 20) media = "HOT";
  else if (metrics.viewerCount > 3) media = "WARM";

  return {
    media,
    origin,
    p2p,
    recommendations: getAdaptiveRecommendations(metrics),
  };
}

/**
 * Viral preheat detection (S103).
 * Returns true when rapid demand growth is detected.
 */
export function detectViralGrowth(
  currentViewers: number,
  viewers1MinAgo: number,
  viewers5MinAgo: number
): boolean {
  const recentGrowthRate = viewers1MinAgo > 0 ? (currentViewers - viewers1MinAgo) / viewers1MinAgo : 0;
  const sustainedGrowthRate = viewers5MinAgo > 0 ? (currentViewers - viewers5MinAgo) / viewers5MinAgo : 0;
  // Viral if: >50% growth in 1 min AND >100% growth in 5 min
  return recentGrowthRate > 0.5 && sustainedGrowthRate > 1.0;
}

/**
 * Origin thundering-herd protection (S104).
 * When demand suddenly explodes, coalesce + promote before origin fan-out.
 */
export function shouldActivateThunderingHerdProtection(metrics: SystemMetrics): boolean {
  return (
    metrics.originRequestRate > 500 || // >500 req/s
    metrics.originBandwidth > 50_000_000 || // >50 MB/s
    (metrics.viewerCount > 50 && metrics.peerCount < 3)
  );
}

/**
 * Viewer exit behavior (S163).
 * When a viewer stops watching, clean up resources.
 */
export function getViewerExitActions(): string[] {
  return [
    "cancel unnecessary prefetch",
    "reduce upload contribution",
    "close unnecessary peer connections",
    "retain high-value cache according to policy",
  ];
}

/**
 * Swarm exit (S164).
 * When swarm activity drops below threshold, reduce resources.
 */
export function shouldExitSwarm(viewerCount: number, peerCount: number): boolean {
  return viewerCount === 0 && peerCount === 0;
}
