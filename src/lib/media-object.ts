/**
 * Media Object Identity — the canonical identity of every media object
 * in the Mashahd platform.
 *
 * Per v6 spec §27: every media object must have an identity equivalent to:
 *   videoId, contentId, renditionId, manifestVersion, generation,
 *   segmentIndex, objectHash, length, duration
 *
 * Per v6 spec §28: content hashing for deduplication, integrity, cache
 * identity, and replication.
 *
 * This type is transport-independent — it doesn't know about storage,
 * P2P, or HTTP. It's the pure identity of a piece of media.
 */

import { createHash } from "node:crypto";

export interface MediaObject {
  /** The video this object belongs to. */
  videoId: string;
  /** Content identifier — groups all renditions of the same source. */
  contentId: string;
  /** Which rendition (e.g. "360p", "720p", "1080p", "source"). */
  renditionId: string;
  /** Manifest version (e.g. "v1", "v2") — immutable per version. */
  manifestVersion: string;
  /** Swarm generation (1, 2, 3...) — for live/long-running. */
  generation: number;
  /** Segment index (0-based). -1 for non-segment objects (init.mp4, master.m3u8). */
  segmentIndex: number;
  /** SHA-256 hash of the object content (for dedup + integrity). */
  objectHash: string;
  /** Object size in bytes. */
  length: number;
  /** Duration of this segment in seconds (0 for non-media objects). */
  duration: number;
  /** Object type: manifest, init, segment, poster, source. */
  type: "manifest" | "init" | "segment" | "poster" | "source";
}

/**
 * Build the canonical object key used in storage paths.
 *
 * Format: videos/{videoId}/{manifestVersion}/{renditionId}/{filename}
 *
 * Examples:
 *   videos/abc/v1/master.m3u8
 *   videos/abc/v1/360p/init.mp4
 *   videos/abc/v1/360p/segment-00001.m4s
 *   videos/abc/v1/poster.jpg
 */
export function objectKey(
  videoId: string,
  manifestVersion: string,
  renditionId: string,
  filename: string
): string {
  return `videos/${videoId}/${manifestVersion}/${renditionId === "root" ? "" : renditionId + "/"}${filename}`;
}

/**
 * Compute the SHA-256 hash of a Buffer (for content addressing).
 *
 * Per §28: hash source/media objects for deduplication, integrity,
 * cache identity, and replication.
 */
export function hashContent(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Compute a content ID from the source hash.
 *
 * The contentId groups all renditions of the same source together,
 * enabling deduplication: if two users upload the same file, they
 * share the same contentId and don't need duplicate renditions.
 */
export function computeContentId(sourceHash: string): string {
  return sourceHash.slice(0, 16); // 16 hex chars = 64 bits, enough for dedup
}

/**
 * Parse a segment filename to extract the segment index.
 * e.g. "segment-00001.m4s" → 1
 */
export function parseSegmentIndex(filename: string): number {
  const match = filename.match(/segment-(\d+)\.m4s/);
  return match ? parseInt(match[1], 10) : -1;
}

/**
 * Check if two MediaObjects are the same (same identity, not same content).
 */
export function sameObjectIdentity(a: MediaObject, b: MediaObject): boolean {
  return (
    a.videoId === b.videoId &&
    a.renditionId === b.renditionId &&
    a.manifestVersion === b.manifestVersion &&
    a.segmentIndex === b.segmentIndex
  );
}

/**
 * Verify the integrity of received P2P data.
 * Per §134: an object received through P2P must be checked before consumption.
 *
 * Returns true if the hash matches, false if corrupted/tampered.
 */
export function verifyObjectIntegrity(data: Buffer, expectedHash: string): boolean {
  const actualHash = hashContent(data);
  return actualHash === expectedHash;
}
