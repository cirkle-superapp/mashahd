/**
 * StoragePort — provider-agnostic storage abstraction for SMALL objects.
 *
 * ZERO-COST, NO BILLING DETAILS:
 *   Filebase (S3-compatible + IPFS pinning, 5GB free, NO payment card required)
 *   replaces the previous Vercel Blob adapter.
 *
 * Why Filebase as the blob alternative?
 *   - $0/month, no credit card, no billing surface at all
 *   - 5 GB free tier (5x the previous 1 GB Vercel Blob Hobby allocation)
 *   - S3-compatible API (same SDK as the media pipeline)
 *   - IPFS pinning included (content-addressed, durable, verifiable)
 *
 * Filebase is used for SMALL objects only (per master spec §14):
 *   - avatars, thumbnails, profile images, documents, small exports
 *
 * Large video files also go to Filebase (via StorageProvider in storage.ts),
 * using the same credentials and bucket. Small objects are namespaced under
 * a `blob/` key prefix to keep them separated from media assets.
 *
 * The quota governor (storage-quota-governor.ts) enforces the 5 GB free-tier
 * hard limit so the platform never creates billable usage.
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

// ── Filebase Blob Adapter ──
// Uses the Filebase S3-compatible API with IPFS pinning.
// Zero-cost: 5 GB free tier, no payment card, no billing details required.

const FILEBASE_ENDPOINT = "https://s3.filebase.io";
const FILEBASE_FREE_TIER_BYTES = 5 * 1024 * 1024 * 1024; // 5 GB

export class FilebaseBlobAdapter implements StoragePort {
  private client: any = null;
  private bucket: string;
  private accessKeyId: string;
  private secretAccessKey: string;
  private publicBaseUrl?: string;
  // In-memory usage tracking (reset on restart). Soft protection only —
  // the authoritative quota source is Filebase itself; this prevents runaway
  // uploads within a single process lifetime.
  private usedBytes: number = 0;

  constructor() {
    this.accessKeyId = process.env.FILEBASE_ACCESS_KEY_ID || "";
    this.secretAccessKey = process.env.FILEBASE_SECRET_ACCESS_KEY || "";
    this.bucket = process.env.FILEBASE_BUCKET || "mashahd-media";
    this.publicBaseUrl = process.env.FILEBASE_PUBLIC_BASE_URL;
  }

  private async getClient() {
    if (!this.accessKeyId || !this.secretAccessKey) {
      throw new Error(
        "Filebase credentials not configured. Set FILEBASE_ACCESS_KEY_ID and FILEBASE_SECRET_ACCESS_KEY (5GB free, no payment card)."
      );
    }
    if (!this.client) {
      const { S3Client } = await import("@aws-sdk/client-s3");
      this.client = new S3Client({
        region: "auto",
        endpoint: FILEBASE_ENDPOINT,
        credentials: {
          accessKeyId: this.accessKeyId,
          secretAccessKey: this.secretAccessKey,
        },
        forcePathStyle: true,
      });
    }
    return this.client;
  }

  /**
   * Namespaces small objects under `blob/` so they never collide with media
   * pipeline assets (which live under `videos/` etc. in the same bucket).
   * Also strips path-traversal segments.
   */
  private toKey(p: string): string {
    const cleaned = p.replace(/^\/+/, "").replace(/\.\.+/g, "");
    return cleaned.startsWith("blob/") ? cleaned : `blob/${cleaned}`;
  }

  async upload(
    path: string,
    data: Buffer,
    contentType: string
  ): Promise<{ url: string; metadata: StorageObjectMetadata }> {
    const client = await this.getClient();
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const key = this.toKey(path);

    await client.send(
      new PutObjectCommand({
        Bucket: this.bucket,
        Key: key,
        Body: data,
        ContentType: contentType,
      })
    );

    this.usedBytes += data.length;

    const url = this.publicBaseUrl
      ? `${this.publicBaseUrl}/${key}`
      : `${FILEBASE_ENDPOINT}/${this.bucket}/${key}`;

    return {
      url,
      metadata: {
        object_id: key,
        tenant_id: "default",
        owner_id: "system",
        object_type: path.split("/")[0] || "unknown",
        size_bytes: data.length,
        content_type: contentType,
        storage_provider: "filebase",
        storage_class: "FREE_PLATFORM_STORAGE",
        created_at: new Date().toISOString(),
        retention_policy: "30d",
        deletable: true,
        customer_funded: false,
      },
    };
  }

  async download(path: string): Promise<Buffer> {
    const client = await this.getClient();
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const r = await client.send(
      new GetObjectCommand({
        Bucket: this.bucket,
        Key: this.toKey(path),
      })
    );
    const chunks: Buffer[] = [];
    for await (const chunk of r.Body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  async delete(path: string): Promise<void> {
    const client = await this.getClient();
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      await client.send(
        new DeleteObjectCommand({
          Bucket: this.bucket,
          Key: this.toKey(path),
        })
      );
    } catch {
      /* already gone */
    }
  }

  async exists(path: string): Promise<boolean> {
    const client = await this.getClient();
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    try {
      await client.send(
        new HeadObjectCommand({
          Bucket: this.bucket,
          Key: this.toKey(path),
        })
      );
      return true;
    } catch {
      return false;
    }
  }

  getQuotaStatus(): StorageQuotaStatus {
    const limitBytes = FILEBASE_FREE_TIER_BYTES;
    const usagePercent = Math.round((this.usedBytes / limitBytes) * 100);
    let state: StorageQuotaStatus["state"] = "MONITORING";
    let canUpload = true;

    if (usagePercent >= 100) { state = "HARD_STOP"; canUpload = false; }
    else if (usagePercent >= 95) { state = "EMERGENCY"; canUpload = false; }
    else if (usagePercent >= 90) { state = "RESTRICT"; }
    else if (usagePercent >= 80) { state = "WARNING"; }
    else if (usagePercent >= 70) { state = "MONITORING"; }

    return {
      provider: "filebase",
      usedBytes: this.usedBytes,
      limitBytes,
      usagePercent,
      state,
      canUpload,
    };
  }
}

// ── Singleton ──
let _blobAdapter: FilebaseBlobAdapter | null = null;

export function getBlobStorage(): FilebaseBlobAdapter | null {
  const accessKeyId = process.env.FILEBASE_ACCESS_KEY_ID;
  const secretAccessKey = process.env.FILEBASE_SECRET_ACCESS_KEY;
  if (!accessKeyId || !secretAccessKey) return null;
  if (!_blobAdapter) {
    _blobAdapter = new FilebaseBlobAdapter();
    console.log(
      "[storage] Filebase blob adapter ready (small objects, zero-cost, no billing details)"
    );
  }
  return _blobAdapter;
}

export function isBlobConfigured(): boolean {
  return !!(process.env.FILEBASE_ACCESS_KEY_ID && process.env.FILEBASE_SECRET_ACCESS_KEY);
}

export function getBlobProviderName(): string {
  return "filebase";
}
