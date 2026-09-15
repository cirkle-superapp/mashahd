/**
 * Storage Replication Policy — decides which storage tier an object should
 * live in, and when to replicate/archive/delete copies.
 *
 * ARCHITECTURE UPDATE (no R2 — R2 requires payment card):
 *   - Filebase is the PRIMARY HOT MEDIA STORE (5GB free, no payment card)
 *   - Self-hosted local is the COMPUTE/TEMP tier
 *   - R2 is OPTIONAL (only when explicitly configured + payment card on file)
 *
 * When R2 is not available, Filebase serves as both hot + cold store.
 * The replication policy still works — it just treats Filebase as the
 * primary instead of R2.
 *
 * Replication decisions:
 *   KEEP_PRIMARY_ONLY      — hot media, doesn't justify a backup
 *   REPLICATE_BACKUP       — important media, justify a secondary copy
 *   ARCHIVE_COLD           — cold media, archive to save primary storage
 *   DELETE_BACKUP_REPLICA  — no longer worth keeping the backup copy
 */

export type ReplicationDecision =
  | "KEEP_PRIMARY_ONLY"
  | "REPLICATE_BACKUP"
  | "ARCHIVE_COLD"
  | "DELETE_BACKUP_REPLICA";

export interface ReplicationContext {
  // Content heat: 0 (cold) to 1 (superhot)
  heat: number;
  // How many times this object has been requested in the last 24h
  requestCount24h: number;
  // Object size in bytes
  sizeBytes: number;
  // Is this the source/original file? (vs a transcoded rendition)
  isSource: boolean;
  // Does a primary copy exist? (Filebase or local)
  primaryExists: boolean;
  // Does a backup copy exist? (local if Filebase is primary)
  backupExists: boolean;
  // Days since last access
  daysSinceAccess: number;
  // Primary storage pressure (0-1, 1 = near full)
  storagePressure: number;
}

/**
 * Decide the replication action for a media object.
 *
 * Logic (per §17-18 of v6 spec, updated for Filebase-as-primary):
 *   - Source files: always replicate to a backup (disaster recovery)
 *   - HOT media (heat > 0.7): KEEP_PRIMARY_ONLY (fast access, no archive needed)
 *   - WARM media (heat 0.3-0.7): KEEP_PRIMARY_ONLY
 *   - COLD media (heat < 0.3, not accessed in 30+ days):
 *     ARCHIVE_COLD (consider moving to cheaper storage)
 *   - If backup exists but media is HOT again: DELETE_BACKUP_REPLICA
 *     (no longer needs the cold backup — primary is sufficient)
 *   - If storage is under pressure: aggressively archive cold media
 */
export function decideReplication(ctx: ReplicationContext): ReplicationDecision {
  const { heat, isSource, primaryExists, backupExists, daysSinceAccess, storagePressure } = ctx;

  // Source files always get a backup (disaster recovery).
  if (isSource && !backupExists) {
    return "REPLICATE_BACKUP";
  }

  // If primary doesn't exist but backup does, we need to restore.
  if (!primaryExists && backupExists) {
    return "KEEP_PRIMARY_ONLY"; // signals: restore from backup
  }

  // HOT media — keep on primary, delete backup if it exists
  if (heat > 0.7) {
    if (backupExists && !isSource) {
      return "DELETE_BACKUP_REPLICA";
    }
    return "KEEP_PRIMARY_ONLY";
  }

  // WARM media — keep on primary, no backup needed.
  if (heat > 0.3) {
    return "KEEP_PRIMARY_ONLY";
  }

  // COLD media — archive to save primary storage.
  const shouldArchive = daysSinceAccess > 30 || storagePressure > 0.8;

  if (shouldArchive && !backupExists) {
    return "ARCHIVE_COLD";
  }

  if (shouldArchive && backupExists) {
    return "KEEP_PRIMARY_ONLY"; // primary copy can be deleted by GC, backup remains
  }

  return "KEEP_PRIMARY_ONLY";
}

/**
 * Calculate the storage value of an object — used to decide retention.
 *
 * ObjectValue = Demand × FutureReuse × Scarcity × PlaybackProximity × CostAvoidance
 *
 * Higher value = more worth keeping in hot storage.
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
