import { createClient, type Client } from "@libsql/client";

/**
 * TursoDB — a Prisma-compatible wrapper over the raw @libsql/client.
 *
 * Exposes the same `db.model.findMany/findUnique/create/update/count` API
 * that the app already uses, so all 28 API routes work unchanged.
 *
 * Supports:
 *   - findMany with where (eq, OR, in), include, orderBy, take
 *   - findUnique with where (by id or unique field)
 *   - findFirst with where (including OR)
 *   - create with data
 *   - update with where + data (including increment)
 *   - updateMany with where + data
 *   - deleteMany with where
 *   - count
 *   - $queryRaw (for SELECT 1 health checks)
 *
 * Falls back to Prisma + local SQLite when TURSO_URL is not set.
 */

const TURSO_URL = process.env.TURSO_URL || "";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

let client: Client | null = null;

export function getTursoClient(): Client | null {
  if (!TURSO_URL || !TURSO_TOKEN) return null;
  if (!client) {
    const httpsUrl = TURSO_URL.replace(/^libsql:/, "https:");
    client = createClient({ url: httpsUrl, authToken: TURSO_TOKEN });
    console.log("[db] Connected to Turso (libSQL):", TURSO_URL);
  }
  return client;
}

// ── SQL builders ──

type WhereClause = Record<string, any>;
type OrderBy = Record<string, "asc" | "desc">;

function buildWhere(where: WhereClause | undefined): { sql: string; params: any[] } {
  if (!where || Object.keys(where).length === 0) return { sql: "", params: [] };
  const parts: string[] = [];
  const params: any[] = [];

  for (const [key, val] of Object.entries(where)) {
    if (key === "OR") {
      const orParts: string[] = [];
      for (const cond of val as WhereClause[]) {
        const { sql: subSql, params: subParams } = buildWhere(cond);
        if (subSql) {
          orParts.push(`(${subSql})`);
          params.push(...subParams);
        }
      }
      if (orParts.length) parts.push(`(${orParts.join(" OR ")})`);
      continue;
    }
    if (key === "AND") {
      const andParts: string[] = [];
      for (const cond of val as WhereClause[]) {
        const { sql: subSql, params: subParams } = buildWhere(cond);
        if (subSql) {
          andParts.push(`(${subSql})`);
          params.push(...subParams);
        }
      }
      if (andParts.length) parts.push(`(${andParts.join(" AND ")})`);
      continue;
    }
    if (val === undefined) {
      // Skip undefined values entirely (Prisma treats them as "no filter")
      continue;
    }
    if (val === null) {
      parts.push(`${key} IS NULL`);
    } else if (typeof val === "object" && val !== null) {
      if ("in" in val && Array.isArray(val.in)) {
        const placeholders = val.in.map(() => "?").join(",");
        parts.push(`${key} IN (${placeholders})`);
        params.push(...val.in);
      } else if ("increment" in val) {
        // Handled in update, not where
      } else if ("startsWith" in val) {
        parts.push(`${key} LIKE ?`);
        params.push(`${val.startsWith}%`);
      }
    } else {
      parts.push(`${key} = ?`);
      params.push(val);
    }
  }
  return { sql: parts.length ? parts.join(" AND ") : "", params };
}

function buildOrderBy(orderBy: OrderBy | undefined): string {
  if (!orderBy) return "";
  const parts = Object.entries(orderBy).map(([col, dir]) => `${col} ${dir.toUpperCase()}`);
  return parts.length ? `ORDER BY ${parts.join(", ")}` : "";
}

/** Convert a DB row's values to JS types (Date for DATETIME, number for INTEGER, boolean for 0/1). */
function castRow(row: Record<string, any>, columns: string[]): Record<string, any> {
  const result: Record<string, any> = {};
  for (const col of columns) {
    const val = row[col];
    if (val === null || val === undefined) {
      result[col] = null;
    } else if (typeof val === "number") {
      result[col] = val;
    } else if (typeof val === "bigint") {
      result[col] = Number(val);
    } else if (typeof val === "string") {
      // Check if it looks like an ISO date
      if (/^\d{4}-\d{2}-\d{2}[T ]/.test(val)) {
        result[col] = new Date(val);
      } else {
        result[col] = val;
      }
    } else {
      result[col] = val;
    }
  }
  return result;
}

/** Get column names for a table. */
async function getColumns(client: Client, table: string): Promise<string[]> {
  const result = await client.execute(`PRAGMA table_info(${table})`);
  return result.rows.map((r: any) => r.name);
}

/** Build the model proxy that mimics Prisma's db.model API. */
function createModel(client: Client, table: string) {
  return {
    async findMany(opts: {
      where?: WhereClause;
      include?: Record<string, boolean | object>;
      orderBy?: OrderBy;
      take?: number;
      skip?: number;
    } = {}): Promise<any[]> {
      const { sql: whereSql, params } = buildWhere(opts.where);
      const orderSql = buildOrderBy(opts.orderBy);
      const limitSql = opts.take ? `LIMIT ${opts.take}` : "";
      const offsetSql = opts.skip ? `OFFSET ${opts.skip}` : "";

      let sql = `SELECT * FROM ${table}`;
      if (whereSql) sql += ` WHERE ${whereSql}`;
      if (orderSql) sql += ` ${orderSql}`;
      if (limitSql) sql += ` ${limitSql}`;
      if (offsetSql) sql += ` ${offsetSql}`;

      const result = await client.execute({ sql, args: params });
      const cols = result.columns;
      let rows = result.rows.map((r: any) => castRow(r as Record<string, any>, cols));

      // Handle includes (relations)
      if (opts.include) {
        for (const [relName, relOpts] of Object.entries(opts.include)) {
          if (!relOpts) continue;
          // Map relation name to the foreign key + related table
          const relMap: Record<string, { table: string; fk: string; isCollection: boolean }> = {
            channel: { table: "Channel", fk: "channelId", isCollection: false },
            comments: { table: "Comment", fk: "videoId", isCollection: true },
            videos: { table: "Video", fk: "channelId", isCollection: true },
            sources: { table: "VideoSource", fk: "videoId", isCollection: true },
            renditions: { table: "VideoRendition", fk: "videoId", isCollection: true },
            manifests: { table: "VideoManifest", fk: "videoId", isCollection: true },
            jobs: { table: "MediaProcessingJob", fk: "videoId", isCollection: true },
            user: { table: "User", fk: "userId", isCollection: false },
            sessions: { table: "Session", fk: "userId", isCollection: true },
            // Playlist relations
            playlists: { table: "Playlist", fk: "userStateId", isCollection: true },
            items: { table: "PlaylistItem", fk: "playlistId", isCollection: true },
            userState: { table: "UserState", fk: "userStateId", isCollection: false },
            playlist: { table: "Playlist", fk: "playlistId", isCollection: false },
            video: { table: "Video", fk: "videoId", isCollection: false },
          };
          const rel = relMap[relName];
          if (!rel) continue;

          if (rel.isCollection) {
            // For collection relations, fetch all related rows for each parent
            const parentIds = rows.map((r: any) => r.id);
            if (parentIds.length === 0) continue;
            const placeholders = parentIds.map(() => "?").join(",");
            const relResult = await client.execute({
              sql: `SELECT * FROM ${rel.table} WHERE ${rel.fk} IN (${placeholders})`,
              args: parentIds,
            });
            const relCols = relResult.columns;
            const relRows = relResult.rows.map((r: any) => castRow(r as Record<string, any>, relCols));
            // Group by parent id
            const byParent: Record<string, any[]> = {};
            for (const rr of relRows) {
              const pid = rr[rel.fk];
              if (!byParent[pid]) byParent[pid] = [];
              byParent[pid].push(rr);
            }
            rows = rows.map((r: any) => ({ ...r, [relName]: byParent[r.id] || [] }));
          } else {
            // For single relations, fetch the related row for each parent
            const fk = rel.fk;
            for (const row of rows) {
              if (row[fk]) {
                const relResult = await client.execute({
                  sql: `SELECT * FROM ${rel.table} WHERE id = ?`,
                  args: [row[fk]],
                });
                if (relResult.rows.length > 0) {
                  row[relName] = castRow(relResult.rows[0] as Record<string, any>, relResult.columns);
                } else {
                  row[relName] = null;
                }
              } else {
                row[relName] = null;
              }
            }
          }
        }
      }

      return rows;
    },

    async findUnique(opts: {
      where: WhereClause;
      include?: Record<string, boolean | object>;
    }): Promise<any | null> {
      const { sql: whereSql, params } = buildWhere(opts.where);
      if (!whereSql) return null;
      const result = await client.execute({
        sql: `SELECT * FROM ${table} WHERE ${whereSql} LIMIT 1`,
        args: params,
      });
      if (result.rows.length === 0) return null;
      const row = castRow(result.rows[0] as Record<string, any>, result.columns);

      // Handle includes
      if (opts.include) {
        for (const [relName, relOpts] of Object.entries(opts.include)) {
          if (!relOpts) continue;
          const relMap: Record<string, { table: string; fk: string; isCollection: boolean }> = {
            channel: { table: "Channel", fk: "channelId", isCollection: false },
            comments: { table: "Comment", fk: "videoId", isCollection: true },
            user: { table: "User", fk: "userId", isCollection: false },
            // Playlist relations
            playlists: { table: "Playlist", fk: "userStateId", isCollection: true },
            items: { table: "PlaylistItem", fk: "playlistId", isCollection: true },
            userState: { table: "UserState", fk: "userStateId", isCollection: false },
            playlist: { table: "Playlist", fk: "playlistId", isCollection: false },
            video: { table: "Video", fk: "videoId", isCollection: false },
          };
          const rel = relMap[relName];
          if (!rel) continue;

          if (rel.isCollection) {
            const relResult = await client.execute({
              sql: `SELECT * FROM ${rel.table} WHERE ${rel.fk} = ?`,
              args: [row.id],
            });
            row[relName] = relResult.rows.map((r: any) => castRow(r as Record<string, any>, relResult.columns));
          } else {
            const fk = rel.fk;
            if (row[fk]) {
              const relResult = await client.execute({
                sql: `SELECT * FROM ${rel.table} WHERE id = ?`,
                args: [row[fk]],
              });
              row[relName] = relResult.rows.length > 0
                ? castRow(relResult.rows[0] as Record<string, any>, relResult.columns)
                : null;
            } else {
              row[relName] = null;
            }
          }
        }
      }

      return row;
    },

    async findFirst(opts: {
      where?: WhereClause;
      include?: Record<string, boolean | object>;
      orderBy?: OrderBy;
    } = {}): Promise<any | null> {
      const { sql: whereSql, params } = buildWhere(opts.where);
      const orderSql = buildOrderBy(opts.orderBy);
      let sql = `SELECT * FROM ${table}`;
      if (whereSql) sql += ` WHERE ${whereSql}`;
      if (orderSql) sql += ` ${orderSql}`;
      sql += ` LIMIT 1`;
      const result = await client.execute({ sql, args: params });
      if (result.rows.length === 0) return null;
      return castRow(result.rows[0] as Record<string, any>, result.columns);
    },

    async create(opts: { data: Record<string, any> }): Promise<any> {
      // Generate a cuid-like ID if not provided (Prisma's @default(cuid()))
      const data = { ...opts.data };
      if (!data.id) {
        data.id = "c" + Date.now().toString(36) + Math.random().toString(36).slice(2, 10);
      }
      // Auto-set timestamps only for tables that have them
      const now = new Date().toISOString();
      const tablesWithTimestamps = new Set(["Channel", "Video", "Comment", "UserState", "User", "Session", "VideoSource", "VideoRendition", "VideoManifest", "MediaProcessingJob", "Swarm", "PlaybackSession", "PlaybackTelemetry", "Playlist"]);
      if (tablesWithTimestamps.has(table)) {
        if (!data.createdAt) data.createdAt = now;
      }
      const tablesWithUpdatedAt = new Set(["UserState", "User", "MediaProcessingJob", "Swarm", "Playlist"]);
      if (tablesWithUpdatedAt.has(table)) {
        data.updatedAt = now;
      }
      // PlaylistItem uses `addedAt` instead of `createdAt`.
      if (table === "PlaylistItem" && !data.addedAt) {
        data.addedAt = now;
      }
      // Convert Date objects to ISO strings for SQLite
      for (const [k, v] of Object.entries(data)) {
        if (v instanceof Date) data[k] = v.toISOString();
      }
      const keys = Object.keys(data).filter((k) => data[k] !== undefined);
      const values = keys.map((k) => data[k]);
      const placeholders = keys.map(() => "?").join(",");
      const cols = keys.join(",");
      try {
        const result = await client.execute({
          sql: `INSERT INTO ${table} (${cols}) VALUES (${placeholders}) RETURNING *`,
          args: values,
        });
        if (result.rows.length > 0) {
          return castRow(result.rows[0] as Record<string, any>, result.columns);
        }
        return { id: data.id, ...data };
      } catch (e: any) {
        throw e;
      }
    },

    async update(opts: {
      where: WhereClause;
      data: Record<string, any>;
    }): Promise<any> {
      const { sql: whereSql, params: whereParams } = buildWhere(opts.where);
      if (!whereSql) throw new Error("update requires a where clause");

      // Auto-update updatedAt only if the table has that column
      const tablesWithUpdatedAt = new Set(["UserState", "User", "MediaProcessingJob", "Swarm"]);
      const data = { ...opts.data };
      if (tablesWithUpdatedAt.has(table)) {
        data.updatedAt = new Date().toISOString();
      }

      const setParts: string[] = [];
      const setParams: any[] = [];
      for (const [key, val] of Object.entries(data)) {
        if (val === undefined) continue;
        if (val instanceof Date) {
          setParts.push(`${key} = ?`);
          setParams.push(val.toISOString());
        } else if (typeof val === "object" && val !== null && "increment" in val) {
          setParts.push(`${key} = ${key} + ?`);
          setParams.push(val.increment);
        } else if (typeof val === "object" && val !== null && "decrement" in val) {
          setParts.push(`${key} = ${key} - ?`);
          setParams.push(val.decrement);
        } else {
          setParts.push(`${key} = ?`);
          setParams.push(val);
        }
      }

      if (setParts.length === 0) return null;

      const sql = `UPDATE ${table} SET ${setParts.join(", ")} WHERE ${whereSql} RETURNING *`;
      const result = await client.execute({ sql, args: [...setParams, ...whereParams] });
      if (result.rows.length > 0) {
        return castRow(result.rows[0] as Record<string, any>, result.columns);
      }
      return null;
    },

    async updateMany(opts: {
      where?: WhereClause;
      data: Record<string, any>;
    }): Promise<{ count: number }> {
      const { sql: whereSql, params: whereParams } = buildWhere(opts.where);

      const setParts: string[] = [];
      const setParams: any[] = [];
      for (const [key, val] of Object.entries(opts.data)) {
        if (val === undefined) continue;
        if (typeof val === "object" && val !== null && "increment" in val) {
          setParts.push(`${key} = ${key} + ?`);
          setParams.push(val.increment);
        } else if (typeof val === "object" && val !== null && "decrement" in val) {
          setParts.push(`${key} = ${key} - ?`);
          setParams.push(val.decrement);
        } else {
          setParts.push(`${key} = ?`);
          setParams.push(val);
        }
      }

      if (setParts.length === 0) return { count: 0 };

      let sql = `UPDATE ${table} SET ${setParts.join(", ")}`;
      if (whereSql) sql += ` WHERE ${whereSql}`;
      const result = await client.execute({ sql, args: [...setParams, ...whereParams] });
      return { count: (result as any).rowsAffected || 0 };
    },

    async deleteMany(opts: { where?: WhereClause } = {}): Promise<{ count: number }> {
      const { sql: whereSql, params } = buildWhere(opts.where);
      let sql = `DELETE FROM ${table}`;
      if (whereSql) sql += ` WHERE ${whereSql}`;
      const result = await client.execute({ sql, args: params });
      return { count: (result as any).rowsAffected || 0 };
    },

    async count(opts: { where?: WhereClause } = {}): Promise<number> {
      const { sql: whereSql, params } = buildWhere(opts.where);
      let sql = `SELECT COUNT(*) as n FROM ${table}`;
      if (whereSql) sql += ` WHERE ${whereSql}`;
      const result = await client.execute({ sql, args: params });
      return Number((result.rows[0] as any)?.n || 0);
    },
  };
}

/** Build the db object with all 13 models, mimicking Prisma's API. */
export function createTursoDB() {
  const client = getTursoClient();
  if (!client) return null;

  return {
    channel: createModel(client, "Channel"),
    video: createModel(client, "Video"),
    comment: createModel(client, "Comment"),
    userState: createModel(client, "UserState"),
    user: createModel(client, "User"),
    session: createModel(client, "Session"),
    videoSource: createModel(client, "VideoSource"),
    videoRendition: createModel(client, "VideoRendition"),
    videoManifest: createModel(client, "VideoManifest"),
    mediaProcessingJob: createModel(client, "MediaProcessingJob"),
    swarm: createModel(client, "Swarm"),
    playbackSession: createModel(client, "PlaybackSession"),
    playbackTelemetry: createModel(client, "PlaybackTelemetry"),
    // Playlists
    playlist: createModel(client, "Playlist"),
    playlistItem: createModel(client, "PlaylistItem"),
    $queryRaw: async (sql: string) => {
      const result = await client.execute(sql);
      return result.rows;
    },
    _client: client,
  };
}

export type TursoDB = ReturnType<typeof createTursoDB>;
