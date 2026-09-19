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
            clips: { table: "Clip", fk: "videoId", isCollection: true },
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
            // For single relations (e.g. video.channel), batch-fetch all related
            // rows in ONE query instead of N queries (deep audit pass 2: this
            // was an N+1 — 50 videos → 50 separate Channel queries).
            const fk = rel.fk;
            const fkIds = [
              ...new Set(
                rows
                  .map((r: any) => r[fk])
                  .filter((id: any) => id != null && id !== "")
              ),
            ];
            if (fkIds.length === 0) {
              // No foreign keys to resolve — set all to null.
              for (const row of rows) row[relName] = null;
            } else {
              const placeholders = fkIds.map(() => "?").join(",");
              const relResult = await client.execute({
                sql: `SELECT * FROM ${rel.table} WHERE id IN (${placeholders})`,
                args: fkIds,
              });
              const relCols = relResult.columns;
              const relRows = relResult.rows.map((r: any) =>
                castRow(r as Record<string, any>, relCols)
              );
              // Build a lookup map: id → row.
              const byId: Record<string, any> = {};
              for (const rr of relRows) {
                byId[rr.id] = rr;
              }
              // Assign to each parent row.
              for (const row of rows) {
                row[relName] = row[fk] ? (byId[row[fk]] || null) : null;
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
            clips: { table: "Clip", fk: "videoId", isCollection: true },
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
      const tablesWithTimestamps = new Set(["Channel", "Video", "Comment", "UserState", "User", "Session", "VideoSource", "VideoRendition", "VideoManifest", "MediaProcessingJob", "Swarm", "Playlist", "Clip"]);
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

  // Ensure all tables exist (CREATE TABLE IF NOT EXISTS).
  // This runs once per serverless invocation (idempotent — safe to repeat).
  ensureAllTables(client).catch(() => { /* non-fatal — tables may already exist */ });

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
    // Clips
    clip: createModel(client, "Clip"),
    // New models (pass 5+)
    outboxEvent: createModel(client, "OutboxEvent"),
    notification: createModel(client, "Notification"),
    notificationPreference: createModel(client, "NotificationPreference"),
    share: createModel(client, "Share"),
    userPreference: createModel(client, "UserPreference"),
    recommendationFeedback: createModel(client, "RecommendationFeedback"),
    userBlock: createModel(client, "UserBlock"),
    continueWatching: createModel(client, "ContinueWatching"),
    contentProvenance: createModel(client, "ContentProvenance"),
    interestProfile: createModel(client, "InterestProfile"),
    smartPlaylist: createModel(client, "SmartPlaylist"),
    recommendationChangelog: createModel(client, "RecommendationChangelog"),
    playlistFolder: createModel(client, "PlaylistFolder"),
    activeSession: createModel(client, "ActiveSession"),
    commentMeta: createModel(client, "CommentMeta"),
    videoRelationship: createModel(client, "VideoRelationship"),
    videoCorrection: createModel(client, "VideoCorrection"),
    rightsClaim: createModel(client, "RightsClaim"),
    rightsDispute: createModel(client, "RightsDispute"),
    livePoll: createModel(client, "LivePoll"),
    liveQA: createModel(client, "LiveQA"),
    adDisclosure: createModel(client, "AdDisclosure"),
    channelRole: createModel(client, "ChannelRole"),
    sponsoredHashtag: createModel(client, "SponsoredHashtag"),
    factCheckNote: createModel(client, "FactCheckNote"),
    $queryRaw: async (sql: string) => {
      const result = await client.execute(sql);
      return result.rows;
    },
    _client: client,
  };
}

/** Create all tables if they don't exist (idempotent). */
async function ensureAllTables(client: Client): Promise<void> {
  const tables: { name: string; sql: string }[] = [
    { name: "OutboxEvent", sql: "CREATE TABLE IF NOT EXISTS OutboxEvent (id TEXT PRIMARY KEY, aggregateType TEXT, aggregateId TEXT, eventType TEXT, schemaVersion INTEGER DEFAULT 1, payload TEXT, tenantId TEXT DEFAULT 'default', createdAt TEXT, processedAt TEXT, attemptCount INTEGER DEFAULT 0, status TEXT DEFAULT 'PENDING', lastError TEXT DEFAULT '', idempotencyKey TEXT, correlationId TEXT, causationId TEXT)" },
    { name: "Notification", sql: "CREATE TABLE IF NOT EXISTS Notification (id TEXT PRIMARY KEY, recipientId TEXT, type TEXT, payload TEXT, read INTEGER DEFAULT 0, createdAt TEXT)" },
    { name: "NotificationPreference", sql: "CREATE TABLE IF NOT EXISTS NotificationPreference (id TEXT PRIMARY KEY, userId TEXT UNIQUE, newVideos INTEGER DEFAULT 1, comments INTEGER DEFAULT 1, subscribers INTEGER DEFAULT 1, tips INTEGER DEFAULT 1, mentions INTEGER DEFAULT 1, emailEnabled INTEGER DEFAULT 1, pushEnabled INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT)" },
    { name: "Share", sql: "CREATE TABLE IF NOT EXISTS Share (id TEXT PRIMARY KEY, videoId TEXT, sharerId TEXT, platform TEXT DEFAULT 'copy_link', createdAt TEXT)" },
    { name: "UserPreference", sql: "CREATE TABLE IF NOT EXISTS UserPreference (id TEXT PRIMARY KEY, ownerId TEXT UNIQUE, preferredQuality TEXT DEFAULT 'auto', preferredSpeed REAL DEFAULT 1, preferredVolume INTEGER DEFAULT 100, preferredSubtitleLang TEXT DEFAULT '', preferredAudioLang TEXT DEFAULT '', disableShorts INTEGER DEFAULT 0, aiContentFilter TEXT DEFAULT 'show_all', homeMode TEXT DEFAULT 'smart', discoveryFamiliar INTEGER DEFAULT 60, discoveryNewCreators INTEGER DEFAULT 25, discoveryUnexpected INTEGER DEFAULT 15, searchSort TEXT DEFAULT 'relevance', pauseRecommendationLearning INTEGER DEFAULT 0, reducedMotion INTEGER DEFAULT 0, highContrast INTEGER DEFAULT 0, largeControls INTEGER DEFAULT 0, continueWatchingEnabled INTEGER DEFAULT 1, autoplayNext INTEGER DEFAULT 0, uiMode TEXT DEFAULT 'simple', likesVisibility TEXT DEFAULT 'private', subscriptionsVisibility TEXT DEFAULT 'private', historyVisibility TEXT DEFAULT 'private', playlistsVisibility TEXT DEFAULT 'public', commentsVisibility TEXT DEFAULT 'public', createdAt TEXT, updatedAt TEXT)" },
    { name: "RecommendationFeedback", sql: "CREATE TABLE IF NOT EXISTS RecommendationFeedback (id TEXT PRIMARY KEY, userId TEXT, videoId TEXT, reason TEXT, note TEXT DEFAULT '', createdAt TEXT)" },
    { name: "UserBlock", sql: "CREATE TABLE IF NOT EXISTS UserBlock (id TEXT PRIMARY KEY, userId TEXT, blockType TEXT, blockValue TEXT, createdAt TEXT)" },
    { name: "ContinueWatching", sql: "CREATE TABLE IF NOT EXISTS ContinueWatching (id TEXT PRIMARY KEY, userId TEXT, videoId TEXT, position REAL DEFAULT 0, completed INTEGER DEFAULT 0, playbackSpeed REAL DEFAULT 1, qualityPref TEXT DEFAULT 'auto', audioLang TEXT DEFAULT '', subtitleLang TEXT DEFAULT '', updatedAt TEXT)" },
    { name: "ContentProvenance", sql: "CREATE TABLE IF NOT EXISTS ContentProvenance (id TEXT PRIMARY KEY, videoId TEXT UNIQUE, origin TEXT DEFAULT 'unknown', components TEXT DEFAULT '{}', sourceNote TEXT DEFAULT '', declared INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT)" },
    { name: "InterestProfile", sql: "CREATE TABLE IF NOT EXISTS InterestProfile (id TEXT PRIMARY KEY, userId TEXT, name TEXT, categories TEXT DEFAULT '', isActive INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT)" },
    { name: "SmartPlaylist", sql: "CREATE TABLE IF NOT EXISTS SmartPlaylist (id TEXT PRIMARY KEY, userId TEXT, name TEXT, description TEXT DEFAULT '', rules TEXT DEFAULT '{}', createdAt TEXT, updatedAt TEXT)" },
    { name: "RecommendationChangelog", sql: "CREATE TABLE IF NOT EXISTS RecommendationChangelog (id TEXT PRIMARY KEY, userId TEXT, eventType TEXT, description TEXT, metadata TEXT DEFAULT '{}', createdAt TEXT)" },
    { name: "PlaylistFolder", sql: "CREATE TABLE IF NOT EXISTS PlaylistFolder (id TEXT PRIMARY KEY, userStateId TEXT, name TEXT, parentId TEXT, position INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT)" },
    { name: "ActiveSession", sql: "CREATE TABLE IF NOT EXISTS ActiveSession (id TEXT PRIMARY KEY, userId TEXT, deviceFingerprint TEXT, deviceName TEXT DEFAULT 'Unknown device', ipAddress TEXT DEFAULT '', userAgent TEXT DEFAULT '', lastSeenAt TEXT, isCurrent INTEGER DEFAULT 0, createdAt TEXT)" },
    { name: "CommentMeta", sql: "CREATE TABLE IF NOT EXISTS CommentMeta (id TEXT PRIMARY KEY, commentId TEXT UNIQUE, isQuestion INTEGER DEFAULT 0, isCreatorReply INTEGER DEFAULT 0, pinnedBy TEXT, pinnedAt TEXT, createdAt TEXT, updatedAt TEXT)" },
    { name: "VideoRelationship", sql: "CREATE TABLE IF NOT EXISTS VideoRelationship (id TEXT PRIMARY KEY, videoId TEXT, relatedVideoId TEXT, relationType TEXT, note TEXT DEFAULT '', createdBy TEXT DEFAULT 'system', createdAt TEXT)" },
    { name: "VideoCorrection", sql: "CREATE TABLE IF NOT EXISTS VideoCorrection (id TEXT PRIMARY KEY, videoId TEXT, timestamp INTEGER DEFAULT 0, originalText TEXT, correctedText TEXT, note TEXT DEFAULT '', viewersNotified INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT)" },
    { name: "RightsClaim", sql: "CREATE TABLE IF NOT EXISTS RightsClaim (id TEXT PRIMARY KEY, videoId TEXT, claimant TEXT, claimType TEXT, matchedMaterial TEXT, timestampStart INTEGER DEFAULT 0, timestampEnd INTEGER DEFAULT 0, action TEXT DEFAULT 'monetize', territory TEXT DEFAULT '', status TEXT DEFAULT 'active', evidence TEXT DEFAULT '', createdAt TEXT, updatedAt TEXT)" },
    { name: "RightsDispute", sql: "CREATE TABLE IF NOT EXISTS RightsDispute (id TEXT PRIMARY KEY, claimId TEXT, disputant TEXT, reason TEXT, evidence TEXT DEFAULT '', status TEXT DEFAULT 'submitted', resolution TEXT DEFAULT '', createdAt TEXT, updatedAt TEXT)" },
    { name: "LivePoll", sql: "CREATE TABLE IF NOT EXISTS LivePoll (id TEXT PRIMARY KEY, videoId TEXT, question TEXT, options TEXT DEFAULT '[]', status TEXT DEFAULT 'active', createdAt TEXT, closedAt TEXT)" },
    { name: "LiveQA", sql: "CREATE TABLE IF NOT EXISTS LiveQA (id TEXT PRIMARY KEY, videoId TEXT, askerName TEXT, askerAvatar TEXT DEFAULT '', question TEXT, answer TEXT DEFAULT '', answeredBy TEXT DEFAULT '', answeredAt TEXT, upvotes INTEGER DEFAULT 0, createdAt TEXT)" },
    { name: "AdDisclosure", sql: "CREATE TABLE IF NOT EXISTS AdDisclosure (id TEXT PRIMARY KEY, videoId TEXT, adType TEXT, sponsor TEXT, product TEXT DEFAULT '', isPaid INTEGER DEFAULT 1, disclosureNote TEXT DEFAULT '', createdAt TEXT)" },
    { name: "ChannelRole", sql: "CREATE TABLE IF NOT EXISTS ChannelRole (id TEXT PRIMARY KEY, channelId TEXT, userId TEXT, role TEXT DEFAULT 'viewer', accepted INTEGER DEFAULT 0, invitedBy TEXT DEFAULT '', createdAt TEXT, updatedAt TEXT)" },
    { name: "SponsoredHashtag", sql: "CREATE TABLE IF NOT EXISTS SponsoredHashtag (id TEXT PRIMARY KEY, hashtag TEXT UNIQUE, advertiser TEXT DEFAULT '', city TEXT DEFAULT '', budget INTEGER DEFAULT 0, startsAt TEXT, endsAt TEXT, active INTEGER DEFAULT 1, createdAt TEXT)" },
    { name: "FactCheckNote", sql: "CREATE TABLE IF NOT EXISTS FactCheckNote (id TEXT PRIMARY KEY, videoId TEXT, timestamp INTEGER, claim TEXT, verdict TEXT, evidence TEXT DEFAULT '', submitterId TEXT, submitterName TEXT DEFAULT 'Anonymous', upvotes INTEGER DEFAULT 0, downvotes INTEGER DEFAULT 0, status TEXT DEFAULT 'pending', createdAt TEXT, updatedAt TEXT)" },
    // Also ensure existing tables that might be missing on Turso
    { name: "UserState", sql: "CREATE TABLE IF NOT EXISTS UserState (id TEXT PRIMARY KEY, browserId TEXT UNIQUE, likedVideoIds TEXT DEFAULT '', dislikedVideoIds TEXT DEFAULT '', subscribedChannelIds TEXT DEFAULT '', watchedVideoIds TEXT DEFAULT '', favoriteVideoIds TEXT DEFAULT '', watchLaterIds TEXT DEFAULT '', createdAt TEXT, updatedAt TEXT)" },
    { name: "Clip", sql: "CREATE TABLE IF NOT EXISTS Clip (id TEXT PRIMARY KEY, videoId TEXT, creatorId TEXT, creatorName TEXT DEFAULT 'Anonymous', title TEXT, startSec INTEGER, endSec INTEGER, note TEXT DEFAULT '', views INTEGER DEFAULT 0, createdAt TEXT)" },
    { name: "Playlist", sql: "CREATE TABLE IF NOT EXISTS Playlist (id TEXT PRIMARY KEY, userStateId TEXT, title TEXT, description TEXT DEFAULT '', visibility TEXT DEFAULT 'public', coverUrl TEXT DEFAULT '', createdAt TEXT, updatedAt TEXT)" },
    { name: "PlaylistItem", sql: "CREATE TABLE IF NOT EXISTS PlaylistItem (id TEXT PRIMARY KEY, playlistId TEXT, videoId TEXT, position INTEGER DEFAULT 0, addedAt TEXT)" },
    // ── Core models (Pass 47): the audit found these 12 critical tables were
    // NOT auto-created here, causing silent 500s on fresh Turso databases.
    // Now they are ensured on every cold start, matching the Prisma schema.
    { name: "Channel", sql: "CREATE TABLE IF NOT EXISTS Channel (id TEXT PRIMARY KEY, name TEXT, handle TEXT UNIQUE, avatarUrl TEXT, bannerColors TEXT, bannerUrl TEXT DEFAULT '', description TEXT, subscribers INTEGER DEFAULT 0, verified INTEGER DEFAULT 0, ownerId TEXT, links TEXT DEFAULT '', country TEXT DEFAULT '', createdAt TEXT)" },
    { name: "Video", sql: "CREATE TABLE IF NOT EXISTS Video (id TEXT PRIMARY KEY, title TEXT, description TEXT, thumbnailUrl TEXT, videoUrl TEXT, durationSec INTEGER, views INTEGER DEFAULT 0, likes INTEGER DEFAULT 0, dislikes INTEGER DEFAULT 0, category TEXT, tags TEXT DEFAULT '', channelId TEXT, visibility TEXT DEFAULT 'public', publishedAt TEXT, language TEXT DEFAULT '', ageGated INTEGER DEFAULT 0, clipPolicy TEXT DEFAULT 'allowed', createdAt TEXT)" },
    { name: "Comment", sql: "CREATE TABLE IF NOT EXISTS Comment (id TEXT PRIMARY KEY, videoId TEXT, author TEXT, avatarUrl TEXT, text TEXT, likes INTEGER DEFAULT 0, timestamp INTEGER, parentId TEXT, createdAt TEXT)" },
    { name: "User", sql: "CREATE TABLE IF NOT EXISTS User (id TEXT PRIMARY KEY, email TEXT UNIQUE, phone TEXT UNIQUE, username TEXT UNIQUE, displayName TEXT, avatarUrl TEXT DEFAULT '', bio TEXT DEFAULT '', passwordHash TEXT DEFAULT '', verified INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT)" },
    { name: "Session", sql: "CREATE TABLE IF NOT EXISTS Session (id TEXT PRIMARY KEY, userId TEXT, token TEXT UNIQUE, browserId TEXT, createdAt TEXT, expiresAt TEXT)" },
    { name: "VideoSource", sql: "CREATE TABLE IF NOT EXISTS VideoSource (id TEXT PRIMARY KEY, videoId TEXT, sourceHash TEXT, originalName TEXT, storagePath TEXT, fileSize INTEGER, duration REAL, width INTEGER, height INTEGER, codec TEXT, audioCodec TEXT, frameRate REAL, bitrate INTEGER, createdAt TEXT)" },
    { name: "VideoRendition", sql: "CREATE TABLE IF NOT EXISTS VideoRendition (id TEXT PRIMARY KEY, videoId TEXT, resolution TEXT, height INTEGER, width INTEGER, bitrate INTEGER, codec TEXT, manifestPath TEXT, createdAt TEXT)" },
    { name: "VideoManifest", sql: "CREATE TABLE IF NOT EXISTS VideoManifest (id TEXT PRIMARY KEY, videoId TEXT, version TEXT, hash TEXT, manifestPath TEXT, createdAt TEXT)" },
    { name: "MediaProcessingJob", sql: "CREATE TABLE IF NOT EXISTS MediaProcessingJob (id TEXT PRIMARY KEY, videoId TEXT, status TEXT, progress INTEGER DEFAULT 0, error TEXT DEFAULT '', errorClass TEXT DEFAULT '', profile TEXT DEFAULT 'cpu-safe', retryCount INTEGER DEFAULT 0, maxRetries INTEGER DEFAULT 3, priority INTEGER DEFAULT 0, claimedBy TEXT, claimedAt TEXT, startedAt TEXT, completedAt TEXT, createdAt TEXT, updatedAt TEXT)" },
    { name: "Swarm", sql: "CREATE TABLE IF NOT EXISTS Swarm (id TEXT PRIMARY KEY, swarmId TEXT UNIQUE, videoId TEXT, renditionId TEXT, manifestVersion TEXT, activePeers INTEGER DEFAULT 0, createdAt TEXT, updatedAt TEXT)" },
    { name: "PlaybackSession", sql: "CREATE TABLE IF NOT EXISTS PlaybackSession (id TEXT PRIMARY KEY, videoId TEXT, renditionId TEXT, peerId TEXT, browserId TEXT, networkType TEXT DEFAULT 'unknown', swarmId TEXT, p2pEnabled INTEGER DEFAULT 0, startedAt TEXT, endedAt TEXT)" },
    { name: "PlaybackTelemetry", sql: "CREATE TABLE IF NOT EXISTS PlaybackTelemetry (id TEXT PRIMARY KEY, sessionId TEXT, videoId TEXT, cdnBytes INTEGER DEFAULT 0, p2pBytes INTEGER DEFAULT 0, rebufferCount INTEGER DEFAULT 0, rebufferDuration REAL DEFAULT 0, startupTime REAL DEFAULT 0, peerCount INTEGER DEFAULT 0, p2pFailures INTEGER DEFAULT 0, httpFallbackCount INTEGER DEFAULT 0, currentRendition TEXT DEFAULT '', timestamp TEXT)" },
    // ── LiveStream (Pass 47): real DB-backed live broadcasting. Replaces the
    // previous client-only go-live component which had no DB record at all.
    { name: "LiveStream", sql: "CREATE TABLE IF NOT EXISTS LiveStream (id TEXT PRIMARY KEY, channelId TEXT DEFAULT '', streamerId TEXT DEFAULT '', streamerName TEXT DEFAULT 'Anonymous', title TEXT, description TEXT DEFAULT '', category TEXT DEFAULT 'Tech', privacy TEXT DEFAULT 'public', status TEXT DEFAULT 'preparing', viewerCount INTEGER DEFAULT 0, peakViewerCount INTEGER DEFAULT 0, streamKey TEXT UNIQUE, watchPartyCode TEXT DEFAULT '', thumbnailUrl TEXT DEFAULT '', startedAt TEXT DEFAULT '', endedAt TEXT DEFAULT '', createdAt TEXT, updatedAt TEXT)" },
  ];

  for (const { name, sql } of tables) {
    try {
      await client.execute(sql);
      // Create indexes.
      const indexes: Record<string, string[]> = {
        "Notification": ["CREATE INDEX IF NOT EXISTS idx_notif_recipient ON Notification (recipientId, createdAt)", "CREATE INDEX IF NOT EXISTS idx_notif_recipient_read ON Notification (recipientId, read)"],
        "RecommendationFeedback": ["CREATE INDEX IF NOT EXISTS idx_recfb_user ON RecommendationFeedback (userId)", "CREATE INDEX IF NOT EXISTS idx_recfb_video ON RecommendationFeedback (videoId)"],
        "UserBlock": ["CREATE INDEX IF NOT EXISTS idx_block_user ON UserBlock (userId)", "CREATE INDEX IF NOT EXISTS idx_block_type ON UserBlock (blockType)"],
        "ContinueWatching": ["CREATE INDEX IF NOT EXISTS idx_cw_user ON ContinueWatching (userId)", "CREATE INDEX IF NOT EXISTS idx_cw_updated ON ContinueWatching (updatedAt)"],
        "VideoRelationship": ["CREATE INDEX IF NOT EXISTS idx_vrel_video ON VideoRelationship (videoId)", "CREATE INDEX IF NOT EXISTS idx_vrel_related ON VideoRelationship (relatedVideoId)"],
        "VideoCorrection": ["CREATE INDEX IF NOT EXISTS idx_vc_video ON VideoCorrection (videoId)"],
        "RightsClaim": ["CREATE INDEX IF NOT EXISTS idx_rc_video ON RightsClaim (videoId)", "CREATE INDEX IF NOT EXISTS idx_rc_status ON RightsClaim (status)"],
        "RightsDispute": ["CREATE INDEX IF NOT EXISTS idx_rd_claim ON RightsDispute (claimId)", "CREATE INDEX IF NOT EXISTS idx_rd_status ON RightsDispute (status)"],
        "LivePoll": ["CREATE INDEX IF NOT EXISTS idx_lp_video ON LivePoll (videoId)", "CREATE INDEX IF NOT EXISTS idx_lp_status ON LivePoll (status)"],
        "LiveQA": ["CREATE INDEX IF NOT EXISTS idx_lqa_video ON LiveQA (videoId)"],
        "AdDisclosure": ["CREATE INDEX IF NOT EXISTS idx_ad_video ON AdDisclosure (videoId)", "CREATE INDEX IF NOT EXISTS idx_ad_type ON AdDisclosure (adType)"],
        "ChannelRole": ["CREATE INDEX IF NOT EXISTS idx_cr_channel ON ChannelRole (channelId)", "CREATE INDEX IF NOT EXISTS idx_cr_user ON ChannelRole (userId)", "CREATE INDEX IF NOT EXISTS idx_cr_role ON ChannelRole (role)"],
        "SponsoredHashtag": ["CREATE INDEX IF NOT EXISTS idx_sh_active ON SponsoredHashtag (active)", "CREATE INDEX IF NOT EXISTS idx_sh_hashtag ON SponsoredHashtag (hashtag)"],
        "FactCheckNote": ["CREATE INDEX IF NOT EXISTS idx_fcn_video ON FactCheckNote (videoId)", "CREATE INDEX IF NOT EXISTS idx_fcn_status ON FactCheckNote (status)"],
        "ActiveSession": ["CREATE INDEX IF NOT EXISTS idx_as_user ON ActiveSession (userId)", "CREATE INDEX IF NOT EXISTS idx_as_fp ON ActiveSession (deviceFingerprint)"],
        "CommentMeta": ["CREATE INDEX IF NOT EXISTS idx_cm_comment ON CommentMeta (commentId)", "CREATE INDEX IF NOT EXISTS idx_cm_question ON CommentMeta (isQuestion)"],
        "RecommendationChangelog": ["CREATE INDEX IF NOT EXISTS idx_rcl_user ON RecommendationChangelog (userId, createdAt)"],
        "InterestProfile": ["CREATE INDEX IF NOT EXISTS idx_ip_user ON InterestProfile (userId)"],
        "SmartPlaylist": ["CREATE INDEX IF NOT EXISTS idx_sp_user ON SmartPlaylist (userId)"],
        "PlaylistFolder": ["CREATE INDEX IF NOT EXISTS idx_pf_user ON PlaylistFolder (userStateId)", "CREATE INDEX IF NOT EXISTS idx_pf_parent ON PlaylistFolder (parentId)"],
        // Core model indexes (Pass 47)
        "Channel": ["CREATE INDEX IF NOT EXISTS idx_ch_owner ON Channel (ownerId)"],
        "Video": ["CREATE INDEX IF NOT EXISTS idx_v_cat ON Video (category)", "CREATE INDEX IF NOT EXISTS idx_v_channel ON Video (channelId)", "CREATE INDEX IF NOT EXISTS idx_v_created ON Video (createdAt)", "CREATE INDEX IF NOT EXISTS idx_v_vis ON Video (visibility)"],
        "Comment": ["CREATE INDEX IF NOT EXISTS idx_cmt_video ON Comment (videoId)", "CREATE INDEX IF NOT EXISTS idx_cmt_parent ON Comment (parentId)", "CREATE INDEX IF NOT EXISTS idx_cmt_vts ON Comment (videoId, timestamp)"],
        "Session": ["CREATE INDEX IF NOT EXISTS idx_sess_user ON Session (userId)", "CREATE INDEX IF NOT EXISTS idx_sess_token ON Session (token)"],
        "VideoSource": ["CREATE INDEX IF NOT EXISTS idx_vs_video ON VideoSource (videoId)"],
        "VideoRendition": ["CREATE INDEX IF NOT EXISTS idx_vr_video ON VideoRendition (videoId)"],
        "VideoManifest": ["CREATE INDEX IF NOT EXISTS idx_vm_video ON VideoManifest (videoId)"],
        "MediaProcessingJob": ["CREATE INDEX IF NOT EXISTS idx_mpj_video ON MediaProcessingJob (videoId)", "CREATE INDEX IF NOT EXISTS idx_mpj_status ON MediaProcessingJob (status)", "CREATE INDEX IF NOT EXISTS idx_mpj_sp ON MediaProcessingJob (status, priority)"],
        "Swarm": ["CREATE INDEX IF NOT EXISTS idx_sw_video ON Swarm (videoId)", "CREATE INDEX IF NOT EXISTS idx_sw_swarm ON Swarm (swarmId)"],
        "PlaybackSession": ["CREATE INDEX IF NOT EXISTS idx_ps_video ON PlaybackSession (videoId)", "CREATE INDEX IF NOT EXISTS idx_ps_peer ON PlaybackSession (peerId)"],
        "PlaybackTelemetry": ["CREATE INDEX IF NOT EXISTS idx_pt_sess ON PlaybackTelemetry (sessionId)", "CREATE INDEX IF NOT EXISTS idx_pt_video ON PlaybackTelemetry (videoId)"],
        "LiveStream": ["CREATE INDEX IF NOT EXISTS idx_ls_status ON LiveStream (status)", "CREATE INDEX IF NOT EXISTS idx_ls_channel ON LiveStream (channelId)", "CREATE INDEX IF NOT EXISTS idx_ls_streamer ON LiveStream (streamerId)"],
      };
      if (indexes[name]) {
        for (const idxSql of indexes[name]) {
          await client.execute(idxSql).catch(() => {});
        }
      }
    } catch (e) {
      console.warn(`[turso] Failed to ensure table ${name}:`, e);
    }
  }
}

export type TursoDB = ReturnType<typeof createTursoDB>;
