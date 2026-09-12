/**
 * ScarcityEngine — calculates piece scarcity and prioritizes rare pieces.
 *
 * Implements:
 *   - S39: Piece availability index
 *   - S40: Scarcity engine
 *   - S41: Rarest-piece scheduling
 *   - S42: Cooperative prefetch (coordinator)
 *   - S43: Prefetch score
 *   - S44: Playback frontier model
 *   - S45: Swarm heat
 */

export interface PieceAvailability {
  segmentIndex: number;
  peerCount: number; // how many peers have this segment
  originAvailable: boolean;
  edgeAvailable: boolean;
  localCached: boolean;
}

export type HeatClass = "COLD" | "WARM" | "HOT" | "SUPERHOT";

export interface SwarmHeat {
  viewerCount: number;
  watchVelocity: number; // views per minute
  retention: number; // 0-1, avg watch percentage
  peerDensity: number; // peers per active viewer
  heatClass: HeatClass;
}

/**
 * Scarcity = 1 / ReliablePeerAvailability
 * A segment with 0 peers has infinite scarcity (origin-only).
 * A segment with 10 peers has low scarcity (well-distributed).
 */
export function calculateScarcity(avail: PieceAvailability): number {
  if (avail.peerCount === 0) return 1.0; // maximum scarcity — origin only
  return 1 / (avail.peerCount + 1); // more peers = lower scarcity
}

/**
 * PiecePriority = Scarcity × PlaybackProbability × OriginCostAvoidance
 *
 * Higher priority = more important to acquire/cache/replicate.
 */
export function calculatePiecePriority(
  scarcity: number,
  playbackProbability: number,
  originCostAvoidance: number
): number {
  return scarcity * playbackProbability * originCostAvoidance;
}

/**
 * PrefetchScore = PlaybackProbability × PeerAvailability × OriginCostAvoidance × BufferSafety
 *                 − DataRisk − BatteryRisk − StorageCost
 */
export function calculatePrefetchScore(
  playbackProbability: number,
  peerAvailability: number,
  originCostAvoidance: number,
  bufferSafety: number,
  dataRisk: number = 0.1,
  batteryRisk: number = 0.05,
  storageCost: number = 0.01
): number {
  return (
    playbackProbability *
      peerAvailability *
      originCostAvoidance *
      bufferSafety -
    dataRisk -
    batteryRisk -
    storageCost
  );
}

/**
 * Classify swarm heat based on viewer activity.
 * HeatScore = viewerCount × watchVelocity × retention × peerDensity
 */
export function classifySwarmHeat(
  viewerCount: number,
  watchVelocity: number,
  retention: number,
  peerDensity: number
): SwarmHeat {
  const heatScore = viewerCount * watchVelocity * retention * Math.max(0.1, peerDensity);

  let heatClass: HeatClass;
  if (heatScore === 0) heatClass = "COLD";
  else if (heatScore < 5) heatClass = "COLD";
  else if (heatScore < 20) heatClass = "WARM";
  else if (heatScore < 100) heatClass = "HOT";
  else heatClass = "SUPERHOT";

  return { viewerCount, watchVelocity, retention, peerDensity, heatClass };
}

/**
 * Dynamic resource allocation by heat (S46).
 * Returns the recommended aggressiveness for each optimization.
 */
export function getHeatAllocation(heat: HeatClass) {
  switch (heat) {
    case "COLD":
      return {
        cache: 0.1, // minimal cache
        prefetch: 0, // no prefetch
        seeding: 0, // no seeding
        peerBoost: 0, // normal
        edgeReplication: 0,
      };
    case "WARM":
      return {
        cache: 0.4,
        prefetch: 0.3,
        seeding: 0.2,
        peerBoost: 0,
        edgeReplication: 0.1,
      };
    case "HOT":
      return {
        cache: 0.8,
        prefetch: 0.7,
        seeding: 0.6,
        peerBoost: 0.3,
        edgeReplication: 0.5,
      };
    case "SUPERHOT":
      return {
        cache: 1.0,
        prefetch: 0.9,
        seeding: 1.0,
        peerBoost: 0.5,
        edgeReplication: 1.0,
      };
  }
}

/**
 * Playback frontier model (S44).
 * Classifies peers based on their position relative to the current playback window.
 */
export type FrontierPosition = "leading" | "middle" | "trailing";

export function classifyPeerPosition(
  peerPlaybackPosition: number,
  currentPlaybackPosition: number,
  segmentDuration: number = 6
): FrontierPosition {
  const diff = peerPlaybackPosition - currentPlaybackPosition;
  if (diff > segmentDuration * 5) return "leading"; // ahead by 5+ segments
  if (diff < -segmentDuration * 5) return "trailing"; // behind by 5+ segments
  return "middle";
}

/**
 * Cooperative prefetch assignment (S42).
 * Distributes future segment downloads across peers to avoid duplicates.
 */
export function assignCooperativePrefetch(
  peerIds: string[],
  startSegment: number,
  count: number
): Record<string, number[]> {
  const assignments: Record<string, number[]> = {};
  for (let i = 0; i < count; i++) {
    const peerIdx = i % peerIds.length;
    const peerId = peerIds[peerIdx];
    if (!assignments[peerId]) assignments[peerId] = [];
    assignments[peerId].push(startSegment + i);
  }
  return assignments;
}
