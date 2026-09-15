import { promises as fs } from "node:fs";
import path from "node:path";
import { createReadStream, createWriteStream, type ReadStream } from "node:fs";

/**
 * StorageProvider — a storage abstraction for the media pipeline.
 * Implementations: LocalFilesystemStorage (default), FilebaseStorageProvider.
 *
 * The application works with local filesystem storage without any cloud account.
 * Filebase (S3-compatible + IPFS pinning, 5GB free, no payment card) is
 * activated when STORAGE_PROVIDER=filebase.
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

    if (provider === "filebase") {
      // Filebase (S3-compatible with IPFS pinning, 5GB free, no payment card).
      // Requires a bucket to be created via the Filebase dashboard first.
      const accessKeyId = process.env.FILEBASE_ACCESS_KEY_ID;
      const secretAccessKey = process.env.FILEBASE_SECRET_ACCESS_KEY;
      const bucket = process.env.FILEBASE_BUCKET || "mashahd-media";
      const publicBaseUrl = process.env.FILEBASE_PUBLIC_BASE_URL;

      if (accessKeyId && secretAccessKey) {
        try {
          const mod = (0, eval)("require")("../server-lib/filebase-storage");
          const { FilebaseStorageProvider } = mod;
          _instance = new FilebaseStorageProvider({
            accessKeyId,
            secretAccessKey,
            bucket,
            publicBaseUrl,
          });
          console.log(`[storage] Using Filebase: bucket=${bucket}`);
        } catch (e) {
          console.warn("[storage] Filebase init failed, falling back to local:", e);
          _instance = new LocalFilesystemStorage();
        }
      } else {
        console.warn("[storage] Filebase credentials not set, falling back to local");
        _instance = new LocalFilesystemStorage();
      }
    } else if (provider === "s3") {
      // S3-compatible storage (AWS S3, Backblaze B2, MinIO, etc.)
      // Falls back to local for now — implement when needed.
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
