import { S3Client, PutObjectCommand, GetObjectCommand, DeleteObjectCommand, HeadObjectCommand } from "@aws-sdk/client-s3";
import type { StorageProvider } from "./storage";
import { ReadStream } from "node:fs";

/**
 * FilebaseStorageProvider — S3-compatible storage with IPFS pinning.
 *
 * Filebase provides:
 *   - S3-compatible API (endpoint: https://s3.filebase.com)
 *   - IPFS pinning (content-addressed, deduplicated)
 *   - Free tier: 5GB storage, no payment card required
 *
 * Activation:
 *   1. Create a bucket via the Filebase dashboard (console.filebase.com)
 *      — S3 API bucket creation is blocked on the free plan.
 *   2. Set STORAGE_PROVIDER=filebase + FILEBASE_* env vars.
 *
 * When this provider is active, every media segment written to Filebase is
 * automatically pinned to IPFS — giving Mashahd a content-addressed,
 * deduplicated storage layer with zero egress fees.
 */
export class FilebaseStorageProvider implements StorageProvider {
  private client: S3Client;
  private bucket: string;
  httpBase?: string;

  constructor(opts: {
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicBaseUrl?: string;
  }) {
    this.bucket = opts.bucket;
    this.client = new S3Client({
      region: "auto", // Filebase requires "auto" (us-east-1 still works but auto is recommended)
      endpoint: "https://s3.filebase.io", // NOTE: .io NOT .com
      credentials: {
        accessKeyId: opts.accessKeyId,
        secretAccessKey: opts.secretAccessKey,
      },
      forcePathStyle: true,
      // Filebase requires AWS Signature v4 (the default for @aws-sdk/client-s3)
    });
    // Filebase provides IPFS gateways: https://ipfs.filebase.io/ipfs/{CID}
    // But CIDs aren't known until after upload, so we don't set httpBase.
    this.httpBase = opts.publicBaseUrl;
  }

  private toKey(relPath: string): string {
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
    const chunks: Buffer[] = [];
    for await (const chunk of r.Body as AsyncIterable<Buffer>) {
      chunks.push(Buffer.from(chunk));
    }
    return Buffer.concat(chunks);
  }

  stream(_relPath: string): ReadStream {
    throw new Error("Filebase streaming not implemented — use read() for buffered access");
  }

  async delete(relPath: string): Promise<void> {
    try {
      await this.client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.toKey(relPath),
      }));
    } catch { /* already gone */ }
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
    // Object storage — directories are virtual. No-op.
  }
}
