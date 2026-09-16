/**
 * Storage Quota Governor — protects the Filebase 5 GB free-tier allocation.
 *
 * Per master spec §16:
 *   70% = monitoring
 *   80% = warning
 *   90% = restrict noncritical uploads
 *   95% = emergency storage mode
 *   100% = hard stop for noncritical uploads
 *
 * Per §42: "Filebase is NOT unlimited free storage." (5 GB free, no payment card.)
 * Per §18: "Before accepting large uploads: estimate size + check quota."
 *
 * At the hard limit: reject nonessential uploads. Do not create billable usage.
 * Filebase has no billing surface (no payment card required), but exceeding the
 * 5 GB free tier would still cause write failures — so we protect the boundary.
 */

import { getBlobStorage, type StorageQuotaStatus } from "./blob-storage";

export type QuotaState = "MONITORING" | "WARNING" | "RESTRICT" | "EMERGENCY" | "HARD_STOP";

export interface QuotaCheckResult {
  allowed: boolean;
  state: QuotaState;
  reason: string;
  currentUsage: StorageQuotaStatus | null;
}

/**
 * Check if an upload is allowed under the current quota.
 *
 * @param sizeBytes — the size of the object to upload
 * @param critical — is this a SYSTEM_CRITICAL upload? (bypasses restrict/emergency)
 */
export function checkStorageQuota(sizeBytes: number, critical: boolean = false): QuotaCheckResult {
  const blob = getBlobStorage();
  if (!blob) {
    // No blob storage configured — allow (using local filesystem only).
    return { allowed: true, state: "MONITORING", reason: "blob not configured", currentUsage: null };
  }

  const status = blob.getQuotaStatus();

  // Per §18: if the object would exceed the free allowance, reject.
  if (status.usedBytes + sizeBytes > status.limitBytes && !critical) {
    return {
      allowed: false,
      state: "HARD_STOP",
      reason: `upload would exceed Filebase free tier (${status.usedBytes + sizeBytes} > ${status.limitBytes} bytes)`,
      currentUsage: status,
    };
  }

  // At 100%: hard stop for noncritical (§16).
  if (status.usagePercent >= 100 && !critical) {
    return { allowed: false, state: "HARD_STOP", reason: "quota exhausted (100%)", currentUsage: status };
  }

  // At 95%: emergency — only critical uploads (§16).
  if (status.usagePercent >= 95 && !critical) {
    return { allowed: false, state: "EMERGENCY", reason: "emergency storage mode (95%+)", currentUsage: status };
  }

  // At 90%: restrict noncritical (§16).
  if (status.usagePercent >= 90 && !critical) {
    return { allowed: false, state: "RESTRICT", reason: "noncritical uploads restricted (90%+)", currentUsage: status };
  }

  return { allowed: true, state: status.state, reason: "within quota", currentUsage: status };
}

/**
 * Get current quota status for the cost dashboard (§40).
 */
export function getStorageQuotaStatus(): StorageQuotaStatus | null {
  const blob = getBlobStorage();
  if (!blob) return null;
  return blob.getQuotaStatus();
}
