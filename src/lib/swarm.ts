import { createHash } from "node:crypto";

/**
 * Swarm ID architecture — every compatible representation has a deterministic
 * swarm so peers watching the same video+rendition+manifest join the same mesh.
 *
 *   swarmId = sha256(videoId + renditionId + manifestVersion)
 *
 * This prevents peers from exchanging incompatible media.
 */

export function computeSwarmId(videoId: string, renditionId: string, manifestVersion: string): string {
  return createHash("sha256")
    .update(`${videoId}:${renditionId}:${manifestVersion}`)
    .digest("hex")
    .slice(0, 32); // 32 hex chars = 128 bits, enough to avoid collisions
}

/**
 * Validate that a swarm request matches a known video+rendition+manifest.
 * Prevents swarm poisoning where a peer claims a different swarm than their
 * video actually maps to.
 */
export function validateSwarm(
  videoId: string,
  renditionId: string,
  manifestVersion: string,
  expectedSwarmId: string
): boolean {
  return computeSwarmId(videoId, renditionId, manifestVersion) === expectedSwarmId;
}
