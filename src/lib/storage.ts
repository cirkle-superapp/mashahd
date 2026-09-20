import { promises as fs } from "node:fs";
import path from "node:path";
import { createReadStream, createWriteStream, type ReadStream } from "node:fs";
import { createRequire } from "node:module";

// In ESM context (Next.js Turbopack), `require` is not defined. Use
// `createRequire` to get a CJS require function for dynamic imports
// of server-only modules (R2 + Filebase storage providers).
const require = createRequire(import.meta.url);

/**
 * StorageProvider — a storage abstraction for the media pipeline.
 * Implementations: LocalFilesystemStorage (default), R2StorageProvider,
 * FilebaseStorageProvider.
 *
 * The application works with local filesystem storage without any cloud account.
 * Cloudflare R2 (10GB free, ZERO egress) is activated when STORAGE_PROVIDER=r2.
 * Filebase (5GB free, IPFS pinning) is activated when STORAGE_PROVIDER=filebase.
 */

export interface StorageProvider {
  /** Write a Buffer to storage at the given relative path. */
  write(relPath: string, data: Buffer): Promise<void>;
  /** Read a file as a Buffer. */
  read(relPath: string): Promise<Buffer>;
  /** Stream a file (for HTTP range serving). */
  stream(relPath: string): ReadStream;
  /** Delete a file. */
  delete(relPath: string): Promise<void>;
  /** Check if a file exists. */
  exists(relPath: string): Promise<boolean>;
  /** Stat a file (size, mtime). */
  stat(relPath: string): Promise<{ size: number; mtime: Date }>;
  /** Create a directory (recursive). */
  mkdir(relPath: string): Promise<void>;
  /** The base URL prefix for serving files over HTTP (if any). */
  httpBase?: string;
}

const MEDIA_ROOT = process.env.MEDIA_STORAGE_PATH || path.join(process.cwd(), "storage");

/**
 * LocalFilesystemStorage — the zero-cost default. Stores files under
 * MEDIA_STORAGE_PATH (defaults to ./storage). No cloud account needed.
 */
export class LocalFilesystemStorage implements StorageProvider {
  root: string;
  httpBase?: string;

  constructor(root?: string, httpBase?: string) {
    this.root = root || MEDIA_ROOT;
    this.httpBase = httpBase;
  }

  private abs(p: string): string {
    // Prevent path traversal — resolve and ensure it's under root.
    const resolved = path.resolve(this.root, p);
    if (!resolved.startsWith(path.resolve(this.root))) {
      throw new Error("path traversal blocked");
    }
    return resolved;
  }

  async write(relPath: string, data: Buffer): Promise<void> {
    const abs = this.abs(relPath);
    await fs.mkdir(path.dirname(abs), { recursive: true });
    await fs.writeFile(abs, data);
  }

  async read(relPath: string): Promise<Buffer> {
    return fs.readFile(this.abs(relPath));
  }

  stream(relPath: string): ReadStream {
    return createReadStream(this.abs(relPath));
  }

  async delete(relPath: string): Promise<void> {
    try {
      await fs.unlink(this.abs(relPath));
    } catch {
      /* already gone */
    }
  }

  async exists(relPath: string): Promise<boolean> {
    try {
      await fs.access(this.abs(relPath));
      return true;
    } catch {
      return false;
    }
  }

  async stat(relPath: string): Promise<{ size: number; mtime: Date }> {
    const s = await fs.stat(this.abs(relPath));
    return { size: s.size, mtime: s.mtime };
  }

  async mkdir(relPath: string): Promise<void> {
    await fs.mkdir(this.abs(relPath), { recursive: true });
  }
}

/** Singleton instance — defaults to local filesystem. */
let _instance: StorageProvider | null = null;

export function getStorage(): StorageProvider {
  if (!_instance) {
    const provider = process.env.STORAGE_PROVIDER || "local";

    // ── Storage fallback chain ──
    // 1. R2 (if STORAGE_PROVIDER=r2 + credentials set) — zero egress cost
    // 2. Filebase (if STORAGE_PROVIDER=filebase + credentials set) — IPFS pinning
    // 3. Local filesystem (always works — the safe fallback)
    //
    // Each cloud provider is tried; if it fails to initialize, we fall back to
    // local. This means the platform ALWAYS works for uploads, even before
    // the user enables R2 or creates a Filebase bucket.
    if (provider === "r2") {
      const accountId = process.env.R2_ACCOUNT_ID;
      const accessKeyId = process.env.R2_ACCESS_KEY_ID;
      const secretAccessKey = process.env.R2_SECRET_ACCESS_KEY;
      const bucket = process.env.R2_BUCKET || "mashahd-media";
      const publicBaseUrl = process.env.R2_PUBLIC_BASE_URL;

      if (accountId && accessKeyId && secretAccessKey) {
        try {
          const mod = require("../../server-lib/r2-storage");
          const { R2StorageProvider } = mod;
          _instance = new R2StorageProvider({
            accountId,
            accessKeyId,
            secretAccessKey,
            bucket,
            publicBaseUrl,
          });
          console.log(`[storage] Using Cloudflare R2: bucket=${bucket}`);
          return _instance!;
        } catch (e) {
          console.warn("[storage] R2 init failed (enable R2 at https://dash.cloudflare.com → R2 → Enable), falling back to local:", e instanceof Error ? e.message.slice(0, 100) : String(e));
        }
      } else {
        console.warn("[storage] R2 credentials not set, using local");
      }
      // Fall through to local if R2 failed.
      _instance = new LocalFilesystemStorage();
    } else if (provider === "filebase") {
      const accessKeyId = process.env.FILEBASE_ACCESS_KEY_ID;
      const secretAccessKey = process.env.FILEBASE_SECRET_ACCESS_KEY;
      const bucket = process.env.FILEBASE_BUCKET || "mashahd-media";
      const publicBaseUrl = process.env.FILEBASE_PUBLIC_BASE_URL;

      if (accessKeyId && secretAccessKey) {
        try {
          const mod = require("../../server-lib/filebase-storage");
          const { FilebaseStorageProvider } = mod;
          _instance = new FilebaseStorageProvider({
            accessKeyId,
            secretAccessKey,
            bucket,
            publicBaseUrl,
          });
          console.log(`[storage] Using Filebase: bucket=${bucket}`);
          return _instance!;
        } catch (e) {
          console.warn("[storage] Filebase init failed (create a bucket at https://console.filebase.com), falling back to local:", e instanceof Error ? e.message.slice(0, 100) : String(e));
        }
      } else {
        console.warn("[storage] Filebase credentials not set, using local");
      }
      // Fall through to local if Filebase failed.
      _instance = new LocalFilesystemStorage();
    } else {
      // Local filesystem (default, zero-cost, self-hosted).
      _instance = new LocalFilesystemStorage();
    }
  }
  // Guarantee non-null return (all code paths above set _instance,
  // but TypeScript can't prove it through the nested conditionals).
  return _instance ?? new LocalFilesystemStorage();
}

/**
 * Build the versioned media path for a video's HLS assets.
 *   /videos/{videoId}/{manifestVersion}/master.m3u8
 *   /videos/{videoId}/{manifestVersion}/{rendition}/index.m3u8
 */
export function mediaPath(videoId: string, version: string, file: string): string {
  return path.join("videos", videoId, version, file);
}
