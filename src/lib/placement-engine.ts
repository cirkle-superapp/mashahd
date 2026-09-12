/**
 * MediaPlacementEngine — the "WHERE should this object exist?" brain.
 *
 * Separate from the DeliveryScheduler (which answers "WHERE should this
 * come from RIGHT NOW?"). The Placement Engine proactively decides where
 * media objects should be replicated, cached, and seeded based on demand,
 * heat, scarcity, and resource availability.
 *
 * Implements v4 sections:
 *   S55: Dynamic replication factor
 *   S95: Object placement brain
 *   S96: Placement loop
 *   S103: Viral preheat
 *   S104: Origin thundering-herd protection
 *   S106: Media object reuse
 *   S107: Don't move bytes unnecessarily
 *   S108: Zero-copy preference
 *   S165: Media economy state machine
 *   S166: Origin economy state
 *   S167: P2P economy state
 */

import { classifySwarmHeat, type HeatClass } from "./scarcity-engine";

export type MediaState = "COLD" | "WARM" | "HOT" | "SUPERHOT";
export type OriginState = "NORMAL" | "ORIGIN_PRESSURE" | "CRITICAL_ORIGIN_PRESSURE" | "RECOVERY";
export type P2PState = "NO_PEERS" | "LOW_DENSITY" | "HEALTHY" | "HIGH_DENSITY" | "UNSTABLE";

export interface PlacementContext {
  heatClass: HeatClass;
  scarcity: number; // 0-1, higher = more scarce
  peerDensity: number; // peers per viewer
  originLoad: number; // 0-1 CPU/bandwidth utilization
  diskPressure: number; // 0-1
  viewerCount: number;
  watchVelocity: number; // views per minute
  retention: number; // 0-1
}

export interface PlacementDecision {
  action: "REPLICATE" | "CACHE" | "SEED" | "PREFETCH" | "EVICT" | "MAINTAIN" | "PROMOTE";
  target: "origin" | "edge" | "trusted_seed" | "browser_cache" | "peer";
  replicationTarget: number; // desired number of copies
  reason: string;
  priority: "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";
}

export interface MediaEconomyState {
  mediaState: MediaState;
  originState: OriginState;
  p2pState: P2PState;
}

/**
 * Classify the media economy state (S165, S166, S167).
 */
export function classifyEconomyState(ctx: PlacementContext): MediaEconomyState {
  // Media state (S165)
  const heat = classifySwarmHeat(
    ctx.viewerCount,
    ctx.watchVelocity,
    ctx.retention,
    ctx.peerDensity
  );
  let mediaState: MediaState = "COLD";
  if (heat.heatClass === "WARM") mediaState = "WARM";
  else if (heat.heatClass === "HOT") mediaState = "HOT";
  else if (heat.heatClass === "SUPERHOT") mediaState = "SUPERHOT";

  // Origin state (S166)
  let originState: OriginState = "NORMAL";
  if (ctx.originLoad > 0.9) originState = "CRITICAL_ORIGIN_PRESSURE";
  else if (ctx.originLoad > 0.75) originState = "ORIGIN_PRESSURE";
  else if (ctx.originLoad < 0.5 && originState !== "NORMAL") originState = "RECOVERY";

  // P2P state (S167)
  let p2pState: P2PState = "NO_PEERS";
  if (ctx.peerDensity === 0) p2pState = "NO_PEERS";
  else if (ctx.peerDensity < 0.5) p2pState = "LOW_DENSITY";
  else if (ctx.peerDensity > 3) p2pState = "HIGH_DENSITY";
  else if (ctx.retention < 0.3) p2pState = "UNSTABLE";
  else p2pState = "HEALTHY";

  return { mediaState, originState, p2pState };
}

/**
 * Dynamic replication factor (S55).
 * SUPERHOT + scarce → high replication
 * HOT → moderate replication
 * WARM → low replication
 * COLD → minimal/no replication
 */
export function getReplicationTarget(state: MediaState, scarcity: number): number {
  const base = {
    COLD: 0,
    WARM: 1,
    HOT: 3,
    SUPERHOT: 5,
  }[state];

  // Increase target for scarce objects
  const scarcityBoost = Math.ceil(scarcity * 3);
  return base + (state === "HOT" || state === "SUPERHOT" ? scarcityBoost : 0);
}

/**
 * Placement loop (S96):
 * DEMAND → PREDICT → CALCULATE VALUE → SELECT REPLICATION LEVEL → PLACE OBJECT → OBSERVE REUSE → ADJUST
 */
export function decidePlacement(ctx: PlacementContext, currentReplicas: number): PlacementDecision {
  const state = classifyEconomyState(ctx);
  const targetReplicas = getReplicationTarget(state.mediaState, ctx.scarcity);

  // Origin under pressure → promote to cache/P2P/seed
  if (state.originState === "CRITICAL_ORIGIN_PRESSURE" || state.originState === "ORIGIN_PRESSURE") {
    // Viral preheat (S103) + thundering-herd protection (S104)
    if (ctx.watchVelocity > 10) {
      return {
        action: "PROMOTE",
        target: "trusted_seed",
        replicationTarget: Math.max(targetReplicas, 7),
        reason: `viral preheat: origin pressure + high velocity (${ctx.watchVelocity}/min)`,
        priority: "CRITICAL",
      };
    }
    return {
      action: "REPLICATE",
      target: "edge",
      replicationTarget: Math.max(targetReplicas, 5),
      reason: `origin pressure (${Math.round(ctx.originLoad * 100)}%) — replicate to edge`,
      priority: "HIGH",
    };
  }

  // No peers → seed needed
  if (state.p2pState === "NO_PEERS" && state.mediaState !== "COLD") {
    return {
      action: "SEED",
      target: "trusted_seed",
      replicationTarget: 1,
      reason: "no peers available — seed to guarantee availability",
      priority: "HIGH",
    };
  }

  // Unstable P2P → prefer edge/cache
  if (state.p2pState === "UNSTABLE") {
    return {
      action: "CACHE",
      target: "edge",
      replicationTarget: Math.max(targetReplicas, 2),
      reason: "P2P unstable — cache on edge for reliability",
      priority: "MEDIUM",
    };
  }

  // Over-replicated → evict
  if (currentReplicas > targetReplicas + 3 && ctx.scarcity < 0.2) {
    return {
      action: "EVICT",
      target: "browser_cache",
      replicationTarget: targetReplicas,
      reason: `over-replicated (${currentReplicas} > ${targetReplicas}) and low scarcity`,
      priority: "LOW",
    };
  }

  // Under-replicated → replicate
  if (currentReplicas < targetReplicas) {
    return {
      action: "REPLICATE",
      target: state.mediaState === "SUPERHOT" ? "trusted_seed" : "peer",
      replicationTarget: targetReplicas,
      reason: `under-replicated (${currentReplicas}/${targetReplicas})`,
      priority: state.mediaState === "SUPERHOT" ? "CRITICAL" : "HIGH",
    };
  }

  // Disk pressure → evict cold
  if (ctx.diskPressure > 0.85) {
    return {
      action: "EVICT",
      target: "browser_cache",
      replicationTarget: Math.max(1, targetReplicas - 2),
      reason: `disk pressure (${Math.round(ctx.diskPressure * 100)}%) — evict cold objects`,
      priority: "HIGH",
    };
  }

  return {
    action: "MAINTAIN",
    target: "origin",
    replicationTarget: targetReplicas,
    reason: `replication adequate (${currentReplicas}/${targetReplicas})`,
    priority: "LOW",
  };
}

/**
 * Zero-copy preference (S108):
 * Prefer sources in this order (subject to playback deadline + reliability):
 * same-process/cache → browser cache → local/near peer → trusted peer →
 * self-hosted edge → WebTransport edge → origin
 */
export const SOURCE_PREFERENCE_ORDER = [
  "local_cache",
  "p2p_local", // LAN/nearby peer
  "p2p_trusted", // known reliable peer
  "p2p",
  "edge",
  "webtransport",
  "origin",
] as const;

/**
 * Don't move bytes unnecessarily (S107).
 * If the object already exists at a useful location, don't move it.
 */
export function shouldMoveObject(
  currentLocation: string,
  targetLocation: string,
  scarcity: number,
  demand: number
): boolean {
  // Don't move if the current location is already a good source
  if (currentLocation === "origin" && demand < 5) return false;
  if (currentLocation === "edge" && demand < 20) return false;
  if (currentLocation === "browser_cache" && scarcity < 0.3) return false;

  // Don't move just to increase P2P percentage
  if (targetLocation === "peer" && scarcity < 0.5 && demand < 10) return false;

  return true;
}
