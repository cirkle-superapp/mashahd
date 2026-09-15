/**
 * StoragePort — provider-agnostic storage abstraction.
 *
 * Per master spec §15: "Implement StoragePort with VercelBlobStorageAdapter.
 * Keep business logic provider-independent."
 *
 * Vercel Blob is used for SMALL objects only (§14):
 *   - avatars, thumbnails, profile images, documents, small exports
 *
 * Per §13: Vercel Blob Hobby limits:
 *   - 1 GB/month storage
 *   - 10,000 simple operations/month
 *   - 2,000 advanced operations/month
 *   - 10 GB/month data transfer
 *
 * Large video files go to Filebase or local filesystem, NOT Vercel Blob.
 *
 * Per §42: "Vercel Blob is NOT unlimited free storage."
 * The quota governor (§16) enforces hard limits.
 */

export type StorageClass =
  | "FREE_PLATFORM_STORAGE"
  | "CUSTOMER_FUNDED_STORAGE"
  | "TEMPORARY_STORAGE"
  | "SYSTEM_CRITICAL"
  | "NONCRITICAL";

export interface StorageObjectMetadata {
  object_id: string;
  tenant_id: string;
  owner_id: string;
  object_type: string; // avatar, thumbnail, document, etc.
  size_bytes: number;
  content_type: string;
  storage_provider: string;
  storage_class: StorageClass;
  created_at: string;
  retention_policy: string;
  deletable: boolean;
  customer_funded: boolean;
}

export interface StoragePort {
  upload(path: string, data: Buffer, contentType: string): Promise<{ url: string; metadata: StorageObjectMetadata }>;
  download(path: string): Promise<Buffer>;
  delete(path: string): Promise<void>;
  exists(path: string): Promise<boolean>;
  getQuotaStatus(): StorageQuotaStatus;
}

export interface StorageQuotaStatus {
  provider: string;
  usedBytes: number;
  limitBytes: number;
  usagePercent: number;
  state: "MONITORING" | "WARNING" | "RESTRICT" | "EMERGENCY" | "HARD_STOP";
  canUpload: boolean;
}

// ── Vercel Blob Adapter ──
// Uses the Vercel Blob REST API (no SDK needed — keeps bundle lean).
// Per §13: Hobby = 1GB storage, 10K simple ops, 2K advanced ops, 10GB transfer.

const BLOB_BASE_URL = "https://blob.vercel-storage.com";
const BLOB_TOKEN = process.env.BLOB_READ_WRITE_TOKEN || "";

export class VercelBlobStorageAdapter implements StoragePort {
  private usedBytes: number = 0; // tracked in-memory (reset on restart)

  async upload(path: string, data: Buffer, contentType: string): Promise<{ url: string; metadata: StorageObjectMetadata }> {
    if (!BLOB_TOKEN) {
      throw new Error("BLOB_READ_WRITE_TOKEN not configured");
    }

    const response = await fetch(`${BLOB_BASE_URL}/${path}`, {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${BLOB_TOKEN}`,
        "Content-Type": contentType,
        "x-content-length": String(data.length),
      },
      body: new Uint8Array(data),
    });

    if (!response.ok) {
      throw new Error(`Vercel Blob upload failed: ${response.status}`);
    }

    const result = await response.json();
    this.usedBytes += data.length;

    return {
      url: result.url,
      metadata: {
        object_id: result.pathname || path,
        tenant_id: "default",
        owner_id: "system",
        object_type: path.split("/")[0] || "unknown",
        size_bytes: data.length,
        content_type: contentType,
        storage_provider: "vercel-blob",
        storage_class: "FREE_PLATFORM_STORAGE",
        created_at: new Date().toISOString(),
        retention_policy: "30d",
        deletable: true,
        customer_funded: false,
      },
    };
  }

  async download(path: string): Promise<Buffer> {
    const response = await fetch(`${BLOB_BASE_URL}/${path}`, {
      headers: { "Authorization": `Bearer ${BLOB_TOKEN}` },
    });
    if (!response.ok) throw new Error(`Vercel Blob download failed: ${response.status}`);
    return Buffer.from(await response.arrayBuffer());
  }

  async delete(path: string): Promise<void> {
    await fetch(`${BLOB_BASE_URL}/${path}?_method=DELETE`, {
      method: "POST",
      headers: { "Authorization": `Bearer ${BLOB_TOKEN}` },
    });
  }

  async exists(path: string): Promise<boolean> {
    try {
      const r = await fetch(`${BLOB_BASE_URL}/${path}`, {
        method: "HEAD",
        headers: { "Authorization": `Bearer ${BLOB_TOKEN}` },
      });
      return r.ok;
    } catch {
      return false;
    }
  }

  getQuotaStatus(): StorageQuotaStatus {
    const limitBytes = 1024 * 1024 * 1024; // 1 GB Hobby limit
    const usagePercent = Math.round((this.usedBytes / limitBytes) * 100);
    let state: StorageQuotaStatus["state"] = "MONITORING";
    let canUpload = true;

    if (usagePercent >= 100) { state = "HARD_STOP"; canUpload = false; }
    else if (usagePercent >= 95) { state = "EMERGENCY"; canUpload = false; }
    else if (usagePercent >= 90) { state = "RESTRICT"; }
    else if (usagePercent >= 80) { state = "WARNING"; }
    else if (usagePercent >= 70) { state = "MONITORING"; }

    return { provider: "vercel-blob", usedBytes: this.usedBytes, limitBytes, usagePercent, state, canUpload };
  }
}

// ── Singleton ──
let _blobAdapter: VercelBlobStorageAdapter | null = null;

export function getBlobStorage(): VercelBlobStorageAdapter | null {
  if (!BLOB_TOKEN) return null;
  if (!_blobAdapter) {
    _blobAdapter = new VercelBlobStorageAdapter();
    console.log("[storage] Vercel Blob adapter ready (small objects only)");
  }
  return _blobAdapter;
}

export function isBlobConfigured(): boolean {
  return !!BLOB_TOKEN;
}
