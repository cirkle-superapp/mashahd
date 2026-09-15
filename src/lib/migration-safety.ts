/**
 * Migration Safety — checksum verification for data/file migrations.
 *
 * Per master spec §46-47:
 *   "Before migrating stored files:
 *      source object → checksum → destination upload → destination checksum
 *      → verification → only then mark migration complete
 *    Do not silently lose files."
 *
 * Used when migrating objects between storage providers
 * (e.g. local → Filebase, Filebase → Vercel Blob).
 */

import { createHash } from "node:crypto";
import type { StorageProvider } from "./storage";

export interface MigrationResult {
  ok: boolean;
  sourcePath: string;
  destinationPath: string;
  sourceChecksum: string;
  destinationChecksum: string;
  verified: boolean;
  sizeBytes: number;
  error?: string;
}

/**
 * Compute SHA-256 checksum of a Buffer.
 */
export function computeChecksum(data: Buffer): string {
  return createHash("sha256").update(data).digest("hex");
}

/**
 * Migrate a single object from one storage provider to another with
 * checksum verification.
 *
 * Flow (per §47):
 *   1. Read source object → compute source checksum
 *   2. Write to destination
 *   3. Read destination object → compute destination checksum
 *   4. Verify checksums match
 *   5. Only if verified, return success
 *
 * If checksums don't match, the destination is deleted (rollback).
 */
export async function migrateWithVerification(
  source: StorageProvider,
  destination: StorageProvider,
  sourcePath: string,
  destinationPath: string
): Promise<MigrationResult> {
  let sourceData: Buffer;
  let sourceChecksum: string;

  // 1. Read source + compute checksum.
  try {
    sourceData = await source.read(sourcePath);
    sourceChecksum = computeChecksum(sourceData);
  } catch (e) {
    return {
      ok: false,
      sourcePath,
      destinationPath,
      sourceChecksum: "",
      destinationChecksum: "",
      verified: false,
      sizeBytes: 0,
      error: `source read failed: ${String(e).slice(0, 200)}`,
    };
  }

  // 2. Write to destination.
  try {
    await destination.write(destinationPath, sourceData);
  } catch (e) {
    return {
      ok: false,
      sourcePath,
      destinationPath,
      sourceChecksum,
      destinationChecksum: "",
      verified: false,
      sizeBytes: sourceData.length,
      error: `destination write failed: ${String(e).slice(0, 200)}`,
    };
  }

  // 3. Read destination back + compute checksum.
  let destinationChecksum: string;
  try {
    const destData = await destination.read(destinationPath);
    destinationChecksum = computeChecksum(destData);
  } catch (e) {
    // Can't verify — delete the destination (rollback).
    await destination.delete(destinationPath).catch(() => {});
    return {
      ok: false,
      sourcePath,
      destinationPath,
      sourceChecksum,
      destinationChecksum: "",
      verified: false,
      sizeBytes: sourceData.length,
      error: `destination read-back failed: ${String(e).slice(0, 200)}`,
    };
  }

  // 4. Verify checksums match.
  const verified = sourceChecksum === destinationChecksum;

  if (!verified) {
    // Checksum mismatch — delete the destination (rollback).
    await destination.delete(destinationPath).catch(() => {});
    return {
      ok: false,
      sourcePath,
      destinationPath,
      sourceChecksum,
      destinationChecksum,
      verified: false,
      sizeBytes: sourceData.length,
      error: "checksum mismatch — destination deleted (rollback)",
    };
  }

  // 5. Success — migration verified.
  return {
    ok: true,
    sourcePath,
    destinationPath,
    sourceChecksum,
    destinationChecksum,
    verified: true,
    sizeBytes: sourceData.length,
  };
}

/**
 * Batch-migrate multiple objects with verification.
 * Returns a summary of successful/failed migrations.
 */
export async function batchMigrateWithVerification(
  source: StorageProvider,
  destination: StorageProvider,
  paths: Array<{ source: string; destination: string }>
): Promise<{ total: number; succeeded: number; failed: number; results: MigrationResult[] }> {
  const results: MigrationResult[] = [];

  for (const { source: srcPath, destination: destPath } of paths) {
    const result = await migrateWithVerification(source, destination, srcPath, destPath);
    results.push(result);
  }

  const succeeded = results.filter(r => r.ok).length;
  const failed = results.filter(r => !r.ok).length;

  return { total: paths.length, succeeded, failed, results };
}
