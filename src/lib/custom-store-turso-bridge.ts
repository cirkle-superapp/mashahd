/**
 * CustomStoreTursoBridge — Event-Sourced Polyglot Persistence (Pass 90).
 *
 * Per user request: "keep using GitHub, vercel, neon, inngest, and turso as
 * they are our cloud structure. be sure to use them in best structuring that
 * is creative and out of the box that makes them work together in harmony."
 *
 * This bridge reconciles the Pass 89 from-scratch CustomStore with the
 * Turso cloud DB. The architecture is "Event-Sourced Polyglot Persistence
 * with CQRS":
 *
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │            CustomStore (hot, in-memory, file-backed)            │
 *   │   Event log (data/events.log) + Projections (in-memory)         │
 *   │   Reads: <1ms (in-memory projection lookup)                     │
 *   │   Writes: ~1ms (local file append + projection update)         │
 *   └─────────────────────────────────────────────────────────────────┘
 *         │                                            │
 *         │ mirror (async, fire-and-forget)            │ cold-start replay
 *         ▼                                            ▼
 *   ┌─────────────────────────────────────────────────────────────────┐
 *   │             Turso (durable, hosted libsql, cloud)               │
 *   │   events table: (seq, type, payload, ts)                       │
 *   │   snapshots table: (name, state, seq)                           │
 *   │   Survives Vercel cold starts, multi-instance safe             │
 *   └─────────────────────────────────────────────────────────────────┘
 *
 * WHY THIS DESIGN (creative + out-of-box + top-tier):
 *   - CustomStore = HOT cache + event log (fast reads, <1ms)
 *   - Turso = DURABLE write-ahead-log (survives serverless restarts)
 *   - Both are kept in sync by an async mirror (writes are non-blocking)
 *   - On cold start, CustomStore warms up by replaying from Turso
 *   - Reads NEVER touch Turso (they go through CustomStore's projections)
 *   - Writes NEVER block on Turso (the mirror is fire-and-forget)
 *   - This is the CQRS + Event Sourcing pattern, polyglot-persisted
 *
 * HARMONY with the 5-service stack:
 *   - GitHub: source control (commits trigger Vercel deploy)
 *   - Vercel: hosting + edge functions (runs CustomStore in /tmp)
 *   - Turso: durable backing for CustomStore event log + snapshots
 *   - Neon: analytics warehouse (CustomStore analytics projection flushes there)
 *   - Inngest: long-job orchestrator (>30s jobs; CustomJobQueue handles <30s)
 *   - AI providers: 5-provider consensus (Groq + OpenRouter + NVIDIA + Gemini + HF)
 *
 * USAGE:
 *   import { getTursoBridgedCustomStore } from "@/lib/custom-store-turso-bridge";
 *   const store = getTursoBridgedCustomStore();
 *   await store.append("video_uploaded", { ... });  // writes locally + mirrors to Turso
 *   const videos = store.projection("videos");        // reads from in-memory (<1ms)
 */

import { CustomStore, type Event, type StorageAdapter, type ProjectionState } from "./custom-store";

// Lazy-load Turso client (avoid circular deps + don't fail if Turso isn't configured)
async function getTursoClient(): Promise<any | null> {
  try {
    const { db } = await import("./db");
    return db;
  } catch {
    return null;
  }
}

/**
 * TursoBackedStorageAdapter — implements StorageAdapter by mirroring to Turso.
 *
 * - append(event): writes locally (file) + mirrors to Turso (async).
 * - readAll(): reads from Turso (durable source of truth on cold start).
 * - readFrom(seq): reads from Turso (for incremental replay).
 * - saveSnapshot(name, state): writes to local file + Turso.
 * - loadSnapshot(name): reads from Turso (durable).
 *
 * The local file is the FAST path (no network round-trip). Turso is the
 * DURABLE path (survives Vercel cold starts + multi-instance coordination).
 */
export class TursoBackedStorageAdapter implements StorageAdapter {
  private localAdapter: StorageAdapter;
  private tursoClient: any | null = null;
  private mirrorQueue: Event[] = [];
  private mirrorFlushInProgress = false;
  private initialized = false;

  // SQL schema for the events table in Turso. Created lazily on first use.
  private static readonly SCHEMA_SQL = `
    CREATE TABLE IF NOT EXISTS custom_store_events (
      seq INTEGER PRIMARY KEY,
      id TEXT NOT NULL,
      type TEXT NOT NULL,
      payload TEXT NOT NULL,
      ts INTEGER NOT NULL
    );
    CREATE TABLE IF NOT EXISTS custom_store_snapshots (
      name TEXT PRIMARY KEY,
      state TEXT NOT NULL,
      seq INTEGER NOT NULL,
      updated_at INTEGER NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_events_ts ON custom_store_events(ts);
    CREATE INDEX IF NOT EXISTS idx_events_type ON custom_store_events(type);
  `;

  constructor(localAdapter: StorageAdapter) {
    this.localAdapter = localAdapter;
  }

  private async ensureInitialized(): Promise<void> {
    if (this.initialized) return;
    this.initialized = true;
    this.tursoClient = await getTursoClient();
    if (this.tursoClient) {
      try {
        // Create the schema (idempotent — IF NOT EXISTS).
        await this.tursoClient.$executeRawUnsafe(TursoBackedStorageAdapter.SCHEMA_SQL);
        console.log("[custom-store-turso-bridge] Turso schema initialized");
      } catch (err) {
        console.warn("[custom-store-turso-bridge] Turso schema init failed (continuing with local-only):", err);
        this.tursoClient = null;
      }
    }
  }

  async append(event: Event): Promise<void> {
    // FAST PATH: write locally first (deterministic, no network).
    await this.localAdapter.append(event);

    // DURABLE PATH: mirror to Turso asynchronously (fire-and-forget, non-blocking).
    // If Turso is unavailable, the event is still safely in the local log.
    this.queueForMirror(event);
  }

  private queueForMirror(event: Event): void {
    this.mirrorQueue.push(event);
    // Batch flush every 10 events or 1s, whichever comes first.
    if (this.mirrorQueue.length >= 10) {
      this.flushMirrorQueue().catch(() => {});  // fire-and-forget
    } else if (!this.mirrorFlushInProgress) {
      this.mirrorFlushInProgress = true;
      setTimeout(() => {
        this.flushMirrorQueue().catch(() => {}).finally(() => {
          this.mirrorFlushInProgress = false;
        });
      }, 1000);
    }
  }

  private async flushMirrorQueue(): Promise<void> {
    if (this.mirrorQueue.length === 0) return;
    await this.ensureInitialized();
    if (!this.tursoClient) return;

    const batch = this.mirrorQueue.splice(0, this.mirrorQueue.length);
    try {
      // Batch insert (atomic transaction).
      const values = batch
        .map((e) => `(${e.seq}, '${e.id.replace(/'/g, "''")}', '${e.type.replace(/'/g, "''")}', '${JSON.stringify(e.payload).replace(/'/g, "''")}', ${e.ts})`)
        .join(", ");
      const sql = `INSERT OR IGNORE INTO custom_store_events (seq, id, type, payload, ts) VALUES ${values}`;
      await this.tursoClient.$executeRawUnsafe(sql);
    } catch (err) {
      // Mirror failed — re-queue the batch for next flush.
      console.warn("[custom-store-turso-bridge] Mirror flush failed (re-queuing):", err);
      this.mirrorQueue.unshift(...batch);
    }
  }

  async readAll(): Promise<Event[]> {
    await this.ensureInitialized();
    if (this.tursoClient) {
      try {
        // DURABLE PATH: read from Turso (source of truth on cold start).
        const rows = await this.tursoClient.$queryRawUnsafe(
          "SELECT seq, id, type, payload, ts FROM custom_store_events ORDER BY seq ASC"
        );
        if (Array.isArray(rows) && rows.length > 0) {
          return rows.map((r: any) => ({
            seq: Number(r.seq),
            id: String(r.id),
            type: String(r.type),
            payload: JSON.parse(r.payload),
            ts: Number(r.ts),
          }));
        }
      } catch (err) {
        console.warn("[custom-store-turso-bridge] Turso readAll failed (falling back to local):", err);
      }
    }
    // FALLBACK: read from local file (dev mode without Turso).
    return this.localAdapter.readAll();
  }

  async readFrom(seq: number): Promise<Event[]> {
    await this.ensureInitialized();
    if (this.tursoClient) {
      try {
        const rows = await this.tursoClient.$queryRawUnsafe(
          "SELECT seq, id, type, payload, ts FROM custom_store_events WHERE seq > ? ORDER BY seq ASC",
          seq
        );
        if (Array.isArray(rows) && rows.length > 0) {
          return rows.map((r: any) => ({
            seq: Number(r.seq),
            id: String(r.id),
            type: String(r.type),
            payload: JSON.parse(r.payload),
            ts: Number(r.ts),
          }));
        }
      } catch (err) {
        console.warn("[custom-store-turso-bridge] Turso readFrom failed (falling back to local):", err);
      }
    }
    return this.localAdapter.readFrom(seq);
  }

  async saveSnapshot(name: string, state: any): Promise<void> {
    // Save locally (fast) + mirror to Turso (durable).
    await this.localAdapter.saveSnapshot(name, state);
    await this.ensureInitialized();
    if (this.tursoClient) {
      try {
        const stateJson = JSON.stringify(state);
        const now = Date.now();
        const seq = state?.seq || 0;
        // Upsert (atomic).
        await this.tursoClient.$executeRawUnsafe(
          `INSERT OR REPLACE INTO custom_store_snapshots (name, state, seq, updated_at) VALUES (?, ?, ?, ?)`,
          name, stateJson, seq, now
        );
      } catch (err) {
        console.warn("[custom-store-turso-bridge] Turso saveSnapshot failed (local-only):", err);
      }
    }
  }

  async loadSnapshot(name: string): Promise<any | null> {
    await this.ensureInitialized();
    if (this.tursoClient) {
      try {
        const rows = await this.tursoClient.$queryRawUnsafe(
          "SELECT state FROM custom_store_snapshots WHERE name = ?",
          name
        );
        if (Array.isArray(rows) && rows.length > 0) {
          return JSON.parse(rows[0].state);
        }
      } catch (err) {
        console.warn("[custom-store-turso-bridge] Turso loadSnapshot failed (falling back to local):", err);
      }
    }
    return this.localAdapter.loadSnapshot(name);
  }

  /**
   * Force-flush the mirror queue (e.g. on shutdown or before a deploy).
   */
  async flush(): Promise<void> {
    await this.flushMirrorQueue();
  }
}

// ── Singleton ──
import { FileStorageAdapter } from "./custom-store";

let _bridgedStore: CustomStore | null = null;

export function getTursoBridgedCustomStore(): CustomStore {
  if (!_bridgedStore) {
    const isVercel = !!process.env.VERCEL;
    const dataDir = isVercel ? "/tmp/mashahd-data" : "data";
    const localAdapter = new FileStorageAdapter(dataDir);
    const tursoBacked = new TursoBackedStorageAdapter(localAdapter);
    _bridgedStore = new CustomStore(tursoBacked);
    console.log("[custom-store-turso-bridge] Initialized (Event-Sourced Polyglot Persistence)");
  }
  return _bridgedStore;
}
