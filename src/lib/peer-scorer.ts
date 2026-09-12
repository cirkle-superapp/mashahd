/**
 * PeerQualityScorer — scores, tracks, and quarantines peers.
 *
 * Implements:
 *   - S35: Peer quality score
 *   - S36: Peer quarantine
 *   - S7: Dynamic node roles (SUPER_PEER, NORMAL_PEER, CLIENT_ONLY)
 *   - S107: Peer utility
 *   - S108: Swarm-level optimization (role assignment)
 */

export type NodeRole = "ORIGIN" | "TRUSTED_SEED" | "EDGE_CACHE" | "SUPER_PEER" | "NORMAL_PEER" | "CLIENT_ONLY";

export interface PeerMetrics {
  peerId: string;
  throughput: number; // Mbps (rolling average)
  rtt: number; // ms (rolling average)
  successRate: number; // 0-1 (successful transfers / total)
  stability: number; // 0-1 (low = frequent disconnects)
  segmentCoverage: number; // 0-1 (fraction of segments this peer has)
  recentFailures: number; // count of failures in recent window
  connectionAge: number; // seconds since connection
  remainingUploadBudget: number; // bytes remaining for upload
  totalUploaded: number; // bytes uploaded this session
  lastSeen: number; // timestamp
}

export interface PeerScore {
  peerId: string;
  score: number; // PeerScore = Throughput × Stability × SegmentCoverage × LowRTT × RemainingBudget
  role: NodeRole;
  quarantined: boolean;
  quarantineReason?: string;
}

const QUARANTINE_THRESHOLD = 3; // failures before quarantine
const QUARANTINE_DURATION = 60_000; // 60s before retry

const quarantinedPeers = new Map<string, { until: number; reason: string }>();

/**
 * Calculate the PeerScore.
 *
 * PeerScore = Throughput × Stability × SegmentCoverage × LowRTT × RemainingBudget
 */
export function scorePeer(m: PeerMetrics): PeerScore {
  const throughputScore = Math.min(1, m.throughput / 5); // normalize to 5 Mbps
  const lowRttScore = m.rtt > 0 ? Math.max(0, 1 - m.rtt / 500) : 0.5;
  const budgetScore = Math.min(1, m.remainingUploadBudget / 262_144_000); // normalize to 250MB
  const coverageScore = m.segmentCoverage;

  const score = throughputScore * m.stability * coverageScore * lowRttScore * budgetScore;

  // Determine role
  let role: NodeRole = "NORMAL_PEER";
  if (m.recentFailures >= QUARANTINE_THRESHOLD) {
    role = "CLIENT_ONLY";
  } else if (m.throughput > 5 && m.stability > 0.9 && m.successRate > 0.95 && m.remainingUploadBudget > 100_000_000) {
    role = "SUPER_PEER";
  } else if (m.connectionAge > 300 && m.stability > 0.8) {
    // Stable for 5+ minutes → consider trusted seed candidate
    role = "NORMAL_PEER"; // upgrade to TRUSTED_SEED requires server-side config
  }

  // Check quarantine
  const quarantine = quarantinedPeers.get(m.peerId);
  const isQuarantined = quarantine ? quarantine.until > Date.now() : false;

  return {
    peerId: m.peerId,
    score,
    role,
    quarantined: isQuarantined,
    quarantineReason: quarantine?.reason,
  };
}

/**
 * Quarantine a peer after repeated failures.
 */
export function quarantinePeer(peerId: string, reason: string): void {
  quarantinedPeers.set(peerId, {
    until: Date.now() + QUARANTINE_DURATION,
    reason,
  });
}

/**
 * Record a failure for a peer and quarantine if threshold is reached.
 */
export function recordPeerFailure(
  peerId: string,
  failureMap: Map<string, number>,
  reason: string = "repeated failures"
): boolean {
  const count = (failureMap.get(peerId) || 0) + 1;
  failureMap.set(peerId, count);
  if (count >= QUARANTINE_THRESHOLD) {
    quarantinePeer(peerId, `${reason} (${count} failures)`);
    return true; // quarantined
  }
  return false;
}

/**
 * Clear failures when a peer succeeds.
 */
export function recordPeerSuccess(peerId: string, failureMap: Map<string, number>): void {
  failureMap.delete(peerId);
  quarantinedPeers.delete(peerId);
}

/**
 * PeerUtility = Reliability × Throughput × Availability × ScarcityContribution × RemainingBudget × PlaybackValue
 *
 * Used for selecting which peers to use for specific pieces.
 */
export function calculatePeerUtility(
  reliability: number,
  throughput: number,
  availability: number,
  scarcityContribution: number,
  remainingBudget: number,
  playbackValue: number
): number {
  return (
    reliability *
    Math.min(1, throughput / 5) *
    availability *
    scarcityContribution *
    Math.min(1, remainingBudget / 262_144_000) *
    playbackValue
  );
}

/**
 * Assign roles to peers for swarm-level optimization (S108).
 * Example: Peer A → bulk pieces, Peer B → rare pieces, Peer C → upcoming pieces.
 */
export function assignSwarmRoles(
  peers: PeerScore[],
  videoSegments: number
): Record<string, "bulk" | "rare" | "upcoming" | "disabled"> {
  const assignments: Record<string, "bulk" | "rare" | "upcoming" | "disabled"> = {};
  const activePeers = peers
    .filter((p) => !p.quarantined && p.role !== "CLIENT_ONLY")
    .sort((a, b) => b.score - a.score);

  if (activePeers.length === 0) return assignments;

  // Best peer → rare pieces (needs highest reliability)
  if (activePeers[0]) {
    assignments[activePeers[0].peerId] = "rare";
  }
  // Second best → upcoming/prefetch
  if (activePeers[1]) {
    assignments[activePeers[1].peerId] = "upcoming";
  }
  // Rest → bulk or disabled based on score
  for (let i = 2; i < activePeers.length; i++) {
    const p = activePeers[i];
    assignments[p.peerId] = p.score > 0.3 ? "bulk" : "disabled";
  }

  // Quarantined peers
  for (const p of peers) {
    if (p.quarantined) {
      assignments[p.peerId] = "disabled";
    }
  }

  return assignments;
}
