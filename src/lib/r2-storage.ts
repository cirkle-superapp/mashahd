import type { StorageProvider } from "./storage";
import { ReadStream } from "node:fs";

/**
 * R2StorageProvider — Cloudflare R2 (S3-compatible) storage backend.
 *
 * Uses dynamic imports for the AWS SDK to keep the bundle lean.
 * The SDK is only loaded when R2 is actually activated.
 */

export class R2StorageProvider implements StorageProvider {
  private client: any = null;
  private bucket: string;
  httpBase?: string;
  private opts: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicBaseUrl?: string;
  };

  constructor(opts: {
    accountId: string;
    accessKeyId: string;
    secretAccessKey: string;
    bucket: string;
    publicBaseUrl?: string;
  }) {
    this.opts = opts;
    this.bucket = opts.bucket;
    this.httpBase = opts.publicBaseUrl;
  }

  private async getClient() {
    if (!this.client) {
      const { S3Client } = await import("@aws-sdk/client-s3");
      this.client = new S3Client({
        region: "auto",
        endpoint: `https://${this.opts.accountId}.r2.cloudflarestorage.com`,
        credentials: {
          accessKeyId: this.opts.accessKeyId,
          secretAccessKey: this.opts.secretAccessKey,
        },
        forcePathStyle: true,
      });
    }
    return this.client;
  }

  private toKey(relPath: string): string {
    return relPath.replace(/^\/+/, "").replace(/\.\./g, "");
  }

  async write(relPath: string, data: Buffer): Promise<void> {
    const { PutObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.getClient();
    await client.send(new PutObjectCommand({
      Bucket: this.bucket,
      Key: this.toKey(relPath),
      Body: data,
    }));
  }

  async read(relPath: string): Promise<Buffer> {
    const { GetObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.getClient();
    const r = await client.send(new GetObjectCommand({
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
    throw new Error("R2 streaming not implemented — use read() for buffered access");
  }

  async delete(relPath: string): Promise<void> {
    const { DeleteObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.getClient();
    try {
      await client.send(new DeleteObjectCommand({
        Bucket: this.bucket,
        Key: this.toKey(relPath),
      }));
    } catch { /* already gone */ }
  }

  async exists(relPath: string): Promise<boolean> {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.getClient();
    try {
      await client.send(new HeadObjectCommand({
        Bucket: this.bucket,
        Key: this.toKey(relPath),
      }));
      return true;
    } catch {
      return false;
    }
  }

  async stat(relPath: string): Promise<{ size: number; mtime: Date }> {
    const { HeadObjectCommand } = await import("@aws-sdk/client-s3");
    const client = await this.getClient();
    const r = await client.send(new HeadObjectCommand({
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
