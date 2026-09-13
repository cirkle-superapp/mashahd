/**
 * LAN Optimization — prefer strong local peer connections based on RTT,
 * throughput, and connection quality, without exposing precise location.
 *
 * Per v6 spec §58-59:
 *   - Multiple compatible devices on the same local network may exchange
 *     media directly through WebRTC.
 *   - Prefer strong local peer connections based on RTT, throughput, and
 *     connection quality — without exposing precise location.
 *
 * Implementation:
 *   - Detect LAN peers by their low RTT (< 5ms = likely same LAN)
 *   - Boost their peer score so the scheduler prefers them
 *   - Don't expose IP addresses or precise location to the application
 *   - Only use RTT + throughput as proxies for "local-ness"
 */

export interface PeerConnectionMetrics {
  peerId: string;
  rttMs: number;
  throughputMbps: number;
  failureCount: number;
  successCount: number;
}

export interface LANPeerGroup {
  /** Peers that are likely on the same LAN (RTT < LAN_RTT_THRESHOLD_MS). */
  localPeers: PeerConnectionMetrics[];
  /** Peers that are remote (RTT >= threshold). */
  remotePeers: PeerConnectionMetrics[];
  /** Whether LAN optimization is active. */
  enabled: boolean;
}

const LAN_RTT_THRESHOLD_MS = 5; // < 5ms = likely same LAN
const LAN_THROUGHPUT_THRESHOLD_MBPS = 50; // > 50 Mbps = likely same LAN
const LAN_BOOST_MULTIPLIER = 1.5; // 50% score boost for LAN peers

/**
 * Classify peers into local (LAN) and remote groups based on RTT + throughput.
 *
 * This doesn't expose IP addresses or precise location — it only uses RTT
 * and throughput as proxies for "this peer is probably on my local network."
 */
export function classifyLANPeers(
  peers: PeerConnectionMetrics[],
  enabled: boolean = true
): LANPeerGroup {
  if (!enabled) {
    return {
      localPeers: [],
      remotePeers: peers,
      enabled: false,
    };
  }

  const localPeers: PeerConnectionMetrics[] = [];
  const remotePeers: PeerConnectionMetrics[] = [];

  for (const peer of peers) {
    // A peer is "local" if BOTH conditions are met:
    // 1. Very low RTT (suggests same network segment)
    // 2. High throughput (suggests no WAN bottleneck)
    //
    // We require BOTH to avoid false positives — a nearby CDN edge could
    // have low RTT but wouldn't have LAN-level throughput.
    const isLocal =
      peer.rttMs > 0 &&
      peer.rttMs < LAN_RTT_THRESHOLD_MS &&
      peer.throughputMbps > LAN_THROUGHPUT_THRESHOLD_MBPS;

    if (isLocal) {
      localPeers.push(peer);
    } else {
      remotePeers.push(peer);
    }
  }

  return { localPeers, remotePeers, enabled: true };
}

/**
 * Boost the peer score for LAN peers.
 *
 * Per §58: "Prefer strong local peer connections based on RTT, throughput,
 * connection quality — without exposing precise location."
 *
 * This doesn't change the peer's identity or expose location — it just
 * makes the scheduler prefer peers that happen to have LAN-level latency.
 */
export function applyLANBoost(
  baseScore: number,
  peer: PeerConnectionMetrics,
  lanGroup: LANPeerGroup
): number {
  if (!lanGroup.enabled) return baseScore;

  const isLocal = lanGroup.localPeers.some((p) => p.peerId === peer.peerId);
  if (isLocal) {
    return baseScore * LAN_BOOST_MULTIPLIER;
  }
  return baseScore;
}

/**
 * Suggest peer specialization for LAN groups.
 *
 * When multiple LAN peers exist, they can specialize:
 *   - Peer A → current playback window (lowest latency)
 *   - Peer B → next window (prefetch)
 *   - Peer C → scarce pieces
 *
 * This reduces duplicate retrievals within a household (§59).
 */
export function suggestLANSpecialization(
  lanPeers: PeerConnectionMetrics[]
): Array<{ peerId: string; role: string }> {
  if (lanPeers.length <= 1) {
    return lanPeers.map((p) => ({ peerId: p.peerId, role: "all" }));
  }

  const roles = ["current", "prefetch", "scarce", "upcoming"];
  return lanPeers.slice(0, roles.length).map((peer, i) => ({
    peerId: peer.peerId,
    role: roles[i] || "all",
  }));
}
