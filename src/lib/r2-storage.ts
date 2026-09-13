import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { StorageProvider } from "./storage";
import { ReadStream } from "node:fs";

/**
 * R2StorageProvider — Cloudflare R2 (S3-compatible) storage backend.
 *
 * R2 is the zero-cost object storage from Cloudflare:
 *   - Free tier: 10GB storage, 1M Class A ops, 10M Class B ops
 *   - Zero egress fees (huge advantage over AWS S3)
 *   - S3-compatible API (uses @aws-sdk/client-s3)
 *
 * Activated when STORAGE_PROVIDER=r2 + R2 credentials are set in env.
 *
 * The R2 bucket must be created + R2 must be enabled on the Cloudflare
 * dashboard before this provider can be used.
 */
export class R2StorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  httpBase?: string;

  constructor(opts: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicBaseUrl?: string;
  }) {
    this.bucket = opts.bucket;
    this.client = new S3Client({
      region: "auto",
      endpoint: `https://${opts.accountId}.r2.cloudflarestorage.com`,
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      forcePathStyle: true,
    });
    this.httpBase = opts.publicBaseUrl;
  }

  private toKey(relPath: string): string {
    // Normalize: remove leading slashes, prevent path traversal.
    return relPath.replace(/^\/+/, "").replace(/\.\./g, "");
  }

  async write(relPath: string, data: Buffer): Promise<void> {
    await this.client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.toKey(relPath),
      Body: data,
    }));
  }

  async read(relPath: string): Promise<Buffer> {
    const r = await this.client.send(new GetObjectCommand({
      Bucket: this.bucket,
      Key: this.toKey(relPath),
    }));
    // Convert the stream to a Buffer.
    const chunks: Buffer[] = [];
    for await (const chunk of r.Body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  stream(_relPath: string): ReadStream {
    // R2 doesn't support Node.js ReadStream directly — the manifest route
    // uses `read()` instead (which buffers the full file). In practice,
    // HLS segments are small (100KB-2MB), so buffering is fine.
    throw new Error("R2 streaming not implemented — use read() for buffered access");
  }

  async delete(relPath: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.toKey(relPath),
      }));
    } catch {
      /* already gone */
    }
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await this.client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.toKey(relPath),
      }));
      return true;
    } catch {
      return false;
    }
  }

  async stat(relPath: string): Promise<{ size: number; mtime: Date }> {
    const r = await this.client.send(new HeadObjectCommand({
      Bucket: this.bucket,
      Key: this.toKey(relPath),
    }));
    return {
      size: r.ContentLength || 0,
      mtime: r.LastModified || new Date(),
    };
  }

  async mkdir(_relPath: string): Promise<void> {
    // R2 is object storage — directories are virtual. No-op.
  }
}
