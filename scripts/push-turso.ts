import { createClient } from "@libsql/client";

/**
 * Push the Mashahd schema to Turso.
 *
 * SECURITY: reads TURSO_URL + TURSO_AUTH_TOKEN from environment variables.
 * Never hardcode credentials in source files. Copy .env.example to .env
 * and fill in the values.
 *
 * Usage:
 *   bun run scripts/push-turso.ts   (reads from .env automatically)
 *   TURSO_URL=... TURSO_AUTH_TOKEN=... bun run scripts/push-turso.ts
 */

const TURSO_URL = process.env.TURSO_URL || "";
const TURSO_TOKEN = process.env.TURSO_AUTH_TOKEN || "";

if (!TURSO_URL || !TURSO_TOKEN) {
  console.error("ERROR: TURSO_URL and TURSO_AUTH_TOKEN environment variables are required.");
  console.error("Copy .env.example to .env and fill in the values, or export them before running:");
  console.error("  export TURSO_URL=libsql://your-db.turso.io");
  console.error("  export TURSO_AUTH_TOKEN=your-token-here");
  process.exit(1);
}

const client = createClient({ url: TURSO_URL, authToken: TURSO_TOKEN });

const tables: string[] = [
  `CREATE TABLE IF NOT EXISTS Channel (
    id TEXT PRIMARY KEY NOT NULL,
    name TEXT NOT NULL,
    handle TEXT NOT NULL UNIQUE,
    avatarUrl TEXT NOT NULL,
    bannerColors TEXT NOT NULL,
    description TEXT NOT NULL,
    subscribers INTEGER NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE TABLE IF NOT EXISTS Video (
    id TEXT PRIMARY KEY NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL,
    thumbnailUrl TEXT NOT NULL,
    videoUrl TEXT NOT NULL,
    durationSec INTEGER NOT NULL,
    views INTEGER NOT NULL DEFAULT 0,
    likes INTEGER NOT NULL DEFAULT 0,
    dislikes INTEGER NOT NULL DEFAULT 0,
    category TEXT NOT NULL,
    tags TEXT NOT NULL DEFAULT '',
    channelId TEXT NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (channelId) REFERENCES Channel(id)
  )`,
  `CREATE INDEX IF NOT EXISTS idx_video_category ON Video(category)`,
  `CREATE INDEX IF NOT EXISTS idx_video_channelId ON Video(channelId)`,
  `CREATE INDEX IF NOT EXISTS idx_video_createdAt ON Video(createdAt)`,
  `CREATE TABLE IF NOT EXISTS Comment (
    id TEXT PRIMARY KEY NOT NULL,
    videoId TEXT NOT NULL,
    author TEXT NOT NULL,
    avatarUrl TEXT NOT NULL,
    text TEXT NOT NULL,
    likes INTEGER NOT NULL DEFAULT 0,
    timestamp INTEGER,
    parentId TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (videoId) REFERENCES Video(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_comment_videoId ON Comment(videoId)`,
  `CREATE INDEX IF NOT EXISTS idx_comment_parentId ON Comment(parentId)`,
  `CREATE INDEX IF NOT EXISTS idx_comment_video_ts ON Comment(videoId, timestamp)`,
  `CREATE TABLE IF NOT EXISTS UserState (
    id TEXT PRIMARY KEY NOT NULL,
    browserId TEXT NOT NULL UNIQUE,
    likedVideoIds TEXT NOT NULL DEFAULT '',
    subscribedChannelIds TEXT NOT NULL DEFAULT '',
    watchedVideoIds TEXT NOT NULL DEFAULT '',
    favoriteVideoIds TEXT NOT NULL DEFAULT '',
    watchLaterIds TEXT NOT NULL DEFAULT '',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS User (
    id TEXT PRIMARY KEY NOT NULL,
    email TEXT UNIQUE,
    phone TEXT UNIQUE,
    username TEXT NOT NULL UNIQUE,
    displayName TEXT NOT NULL,
    avatarUrl TEXT NOT NULL DEFAULT '',
    bio TEXT NOT NULL DEFAULT '',
    passwordHash TEXT NOT NULL DEFAULT '',
    verified INTEGER NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL
  )`,
  `CREATE TABLE IF NOT EXISTS Session (
    id TEXT PRIMARY KEY NOT NULL,
    userId TEXT NOT NULL,
    token TEXT NOT NULL UNIQUE,
    browserId TEXT,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    expiresAt DATETIME NOT NULL,
    FOREIGN KEY (userId) REFERENCES User(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_session_userId ON Session(userId)`,
  `CREATE INDEX IF NOT EXISTS idx_session_token ON Session(token)`,
  `CREATE TABLE IF NOT EXISTS VideoSource (
    id TEXT PRIMARY KEY NOT NULL,
    videoId TEXT NOT NULL,
    sourceHash TEXT NOT NULL,
    originalName TEXT NOT NULL,
    storagePath TEXT NOT NULL,
    fileSize INTEGER NOT NULL,
    duration REAL NOT NULL,
    width INTEGER NOT NULL,
    height INTEGER NOT NULL,
    codec TEXT NOT NULL,
    audioCodec TEXT NOT NULL,
    frameRate REAL NOT NULL,
    bitrate INTEGER NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (videoId) REFERENCES Video(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_videosource_videoId ON VideoSource(videoId)`,
  `CREATE TABLE IF NOT EXISTS VideoRendition (
    id TEXT PRIMARY KEY NOT NULL,
    videoId TEXT NOT NULL,
    resolution TEXT NOT NULL,
    height INTEGER NOT NULL,
    width INTEGER NOT NULL,
    bitrate INTEGER NOT NULL,
    codec TEXT NOT NULL,
    manifestPath TEXT NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (videoId) REFERENCES Video(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_videorendition_videoId ON VideoRendition(videoId)`,
  `CREATE TABLE IF NOT EXISTS VideoManifest (
    id TEXT PRIMARY KEY NOT NULL,
    videoId TEXT NOT NULL,
    version TEXT NOT NULL,
    hash TEXT NOT NULL,
    manifestPath TEXT NOT NULL,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (videoId) REFERENCES Video(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_videomanifest_videoId ON VideoManifest(videoId)`,
  `CREATE TABLE IF NOT EXISTS MediaProcessingJob (
    id TEXT PRIMARY KEY NOT NULL,
    videoId TEXT NOT NULL,
    status TEXT NOT NULL,
    progress INTEGER NOT NULL DEFAULT 0,
    error TEXT NOT NULL DEFAULT '',
    profile TEXT NOT NULL DEFAULT 'cpu-safe',
    retryCount INTEGER NOT NULL DEFAULT 0,
    startedAt DATETIME,
    completedAt DATETIME,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL,
    FOREIGN KEY (videoId) REFERENCES Video(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_mediaprocessingjob_videoId ON MediaProcessingJob(videoId)`,
  `CREATE INDEX IF NOT EXISTS idx_mediaprocessingjob_status ON MediaProcessingJob(status)`,
  `CREATE TABLE IF NOT EXISTS Swarm (
    id TEXT PRIMARY KEY NOT NULL,
    swarmId TEXT NOT NULL UNIQUE,
    videoId TEXT NOT NULL,
    renditionId TEXT NOT NULL,
    manifestVersion TEXT NOT NULL,
    activePeers INTEGER NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL
  )`,
  `CREATE INDEX IF NOT EXISTS idx_swarm_videoId ON Swarm(videoId)`,
  `CREATE INDEX IF NOT EXISTS idx_swarm_swarmId ON Swarm(swarmId)`,
  `CREATE TABLE IF NOT EXISTS PlaybackSession (
    id TEXT PRIMARY KEY NOT NULL,
    videoId TEXT NOT NULL,
    renditionId TEXT NOT NULL,
    peerId TEXT NOT NULL,
    browserId TEXT NOT NULL,
    networkType TEXT NOT NULL DEFAULT 'unknown',
    swarmId TEXT,
    p2pEnabled INTEGER NOT NULL DEFAULT 0,
    startedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    endedAt DATETIME
  )`,
  `CREATE INDEX IF NOT EXISTS idx_playbacksession_videoId ON PlaybackSession(videoId)`,
  `CREATE INDEX IF NOT EXISTS idx_playbacksession_peerId ON PlaybackSession(peerId)`,
  `CREATE TABLE IF NOT EXISTS PlaybackTelemetry (
    id TEXT PRIMARY KEY NOT NULL,
    sessionId TEXT NOT NULL,
    videoId TEXT NOT NULL,
    cdnBytes INTEGER NOT NULL DEFAULT 0,
    p2pBytes INTEGER NOT NULL DEFAULT 0,
    rebufferCount INTEGER NOT NULL DEFAULT 0,
    rebufferDuration REAL NOT NULL DEFAULT 0,
    startupTime REAL NOT NULL DEFAULT 0,
    peerCount INTEGER NOT NULL DEFAULT 0,
    p2pFailures INTEGER NOT NULL DEFAULT 0,
    httpFallbackCount INTEGER NOT NULL DEFAULT 0,
    currentRendition TEXT NOT NULL DEFAULT '',
    timestamp DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP
  )`,
  `CREATE INDEX IF NOT EXISTS idx_playbacktelemetry_sessionId ON PlaybackTelemetry(sessionId)`,
  `CREATE INDEX IF NOT EXISTS idx_playbacktelemetry_videoId ON PlaybackTelemetry(videoId)`,
  // Playlists
  `CREATE TABLE IF NOT EXISTS Playlist (
    id TEXT PRIMARY KEY NOT NULL,
    userStateId TEXT NOT NULL,
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    visibility TEXT NOT NULL DEFAULT 'public',
    coverUrl TEXT NOT NULL DEFAULT '',
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updatedAt DATETIME NOT NULL,
    FOREIGN KEY (userStateId) REFERENCES UserState(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_playlist_userStateId ON Playlist(userStateId)`,
  `CREATE TABLE IF NOT EXISTS PlaylistItem (
    id TEXT PRIMARY KEY NOT NULL,
    playlistId TEXT NOT NULL,
    videoId TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    addedAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (playlistId) REFERENCES Playlist(id) ON DELETE CASCADE
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS idx_playlistitem_playlist_video ON PlaylistItem(playlistId, videoId)`,
  `CREATE INDEX IF NOT EXISTS idx_playlistitem_playlist_pos ON PlaylistItem(playlistId, position)`,
  // Clips — user-created short segments of videos
  `CREATE TABLE IF NOT EXISTS Clip (
    id TEXT PRIMARY KEY NOT NULL,
    videoId TEXT NOT NULL,
    creatorId TEXT NOT NULL,
    creatorName TEXT NOT NULL DEFAULT 'Anonymous',
    title TEXT NOT NULL,
    startSec INTEGER NOT NULL,
    endSec INTEGER NOT NULL,
    note TEXT NOT NULL DEFAULT '',
    views INTEGER NOT NULL DEFAULT 0,
    createdAt DATETIME NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (videoId) REFERENCES Video(id) ON DELETE CASCADE
  )`,
  `CREATE INDEX IF NOT EXISTS idx_clip_videoId ON Clip(videoId)`,
  `CREATE INDEX IF NOT EXISTS idx_clip_creatorId ON Clip(creatorId)`,
];

async function main() {
  console.log("Pushing schema to Turso...");
  let ok = 0, skip = 0, fail = 0;
  for (const sql of tables) {
    try {
      await client.execute(sql);
      ok++;
    } catch (e: any) {
      if (e.message?.includes("already exists")) {
        skip++;
      } else {
        console.error("✗", e.message?.slice(0, 100));
        fail++;
      }
    }
  }
  console.log(`\n✅ Done: ${ok} created, ${skip} already existed, ${fail} failed`);

  const result = await client.execute("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name");
  console.log("\nTables in Turso database:");
  for (const row of result.rows) {
    console.log("  -", row.name);
  }
}

main().catch(console.error);
