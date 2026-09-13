/**
 * Storage Replication Policy — decides which storage tier an object should
 * live in, and when to replicate/archive/delete copies.
 *
 * Phase 18 of v6 spec:
 *   - R2 is the PRIMARY HOT MEDIA STORE (zero egress)
 *   - Filebase is the OPTIONAL COLD/ARCHIVE tier (5GB free, IPFS pinning)
 *   - Self-hosted local is the COMPUTE/TEMP tier
 *
 * Replication decisions:
 *   KEEP_R2_ONLY          — hot media, doesn't justify a backup
 *   REPLICATE_FILEBASE    — important media, justify a secondary copy
 *   ARCHIVE_FILEBASE      — cold media, move from R2 to Filebase to save R2 storage
 *   DELETE_FILEBASE_REPLICA — no longer worth keeping the Filebase copy
 */

export type ReplicationDecision =
  | "KEEP_R2_ONLY"
  | "REPLICATE_FILEBASE"
  | "ARCHIVE_FILEBASE"
  | "DELETE_FILEBASE_REPLICA";

export interface ReplicationContext {
  // Content heat: 0 (cold) to 1 (superhot)
  heat: number;
  // How many times this object has been requested in the last 24h
  requestCount24h: number;
  // Object size in bytes
  sizeBytes: number;
  // Is this the source/original file? (vs a transcoded rendition)
  isSource: boolean;
  // Is this the only copy? (no R2 backup exists)
  r2Exists: boolean;
  // Does a Filebase copy already exist?
  filebaseExists: boolean;
  // Days since last access
  daysSinceAccess: number;
  // R2 storage pressure (0-1, 1 = near full)
  r2StoragePressure: number;
}

/**
 * Decide the replication action for a media object.
 *
 * Logic (per §17-18 of v6 spec):
 *   - Source files: always replicate to Filebase (backup value)
 *   - HOT media (heat > 0.7): KEEP_R2_ONLY (fast access, no archive needed)
 *   - WARM media (heat 0.3-0.7): KEEP_R2_ONLY
 *   - COLD media (heat < 0.3, not accessed in 30+ days):
 *     ARCHIVE_FILEBASE (move to Filebase to save R2 storage)
 *   - If Filebase copy exists but media is HOT again: DELETE_FILEBASE_REPLICA
 *     (no longer needs the cold backup — R2 is sufficient)
 *   - If R2 is under storage pressure: aggressively archive cold media
 */
export function decideReplication(ctx: ReplicationContext): ReplicationDecision {
  const { heat, isSource, r2Exists, filebaseExists, daysSinceAccess, r2StoragePressure } = ctx;

  // Source files always get a Filebase backup (disaster recovery).
  if (isSource && !filebaseExists) {
    return "REPLICATE_FILEBASE";
  }

  // If R2 doesn't exist but Filebase does, we need to restore.
  if (!r2Exists && filebaseExists) {
    return "KEEP_R2_ONLY"; // signals: restore to R2 from Filebase
  }

  // HOT media — keep on R2, delete Filebase copy if it exists
  // (the Filebase copy is wasted storage for hot content).
  if (heat > 0.7) {
    if (filebaseExists && !isSource) {
      return "DELETE_FILEBASE_REPLICA";
    }
    return "KEEP_R2_ONLY";
  }

  // WARM media — keep on R2, no Filebase needed.
  if (heat > 0.3) {
    return "KEEP_R2_ONLY";
  }

  // COLD media — archive to Filebase to save R2 storage.
  // But only if it hasn't been accessed recently (30+ days) OR R2 is under pressure.
  const shouldArchive = daysSinceAccess > 30 || r2StoragePressure > 0.8;

  if (shouldArchive && !filebaseExists) {
    return "ARCHIVE_FILEBASE";
  }

  // If already archived and still cold, keep the Filebase copy.
  if (shouldArchive && filebaseExists) {
    return "KEEP_R2_ONLY"; // R2 copy can be deleted by GC, Filebase remains
  }

  return "KEEP_R2_ONLY";
}

/**
 * Calculate the storage value of an object — used to decide retention.
 *
 * ObjectValue = Demand × FutureReuse × Scarcity × PlaybackProximity × CostAvoidance
 *
 * Higher value = more worth keeping in hot storage (R2).
 * Lower value = candidate for archival to Filebase or deletion.
 */
export function calculateObjectValue(ctx: {
  requestCount24h: number;
  heat: number;
  sizeBytes: number;
  daysSinceAccess: number;
  peerAvailability: number; // 0-1, how many peers have this object
}): number {
  const demand = Math.log1p(ctx.requestCount24h); // log scale — 100 requests ≠ 100x value of 1
  const futureReuse = Math.max(0, 1 - ctx.daysSinceAccess / 90); // decays over 90 days
  const scarcity = 1 / (ctx.peerAvailability + 1); // scarce = more valuable to keep
  const costAvoidance = ctx.sizeBytes > 0 ? 1 : 0; // bigger objects = more cost to re-fetch

  return demand * futureReuse * scarcity * costAvoidance;
}
