/**
 * Feature flags for the Autonomous Media Mesh v6.
 *
 * All flags default to safe values per §173. Optional/experimental features
 * are disabled by default. Environment variables override defaults.
 *
 * Implements §172 of the v6 spec.
 */

export interface MediaFabricConfig {
  // Master switch
  DISTRIBUTED_MEDIA_ENABLED: boolean;

  // P2P
  P2P_ENABLED: boolean;
  P2P_UPLOAD_ENABLED: boolean;
  P2P_MAX_PEERS: number;
  P2P_MAX_UPLOAD_MBPS: number;
  P2P_MAX_UPLOAD_BYTES: number;
  P2P_MAX_CONCURRENT_UPLOADS: number;
  P2P_BACKGROUND_ENABLED: boolean;
  P2P_LOW_BATTERY_MODE: boolean;

  // Local cache
  LOCAL_MEDIA_CACHE_ENABLED: boolean;

  // Transports
  WEBTRANSPORT_ENABLED: boolean;
  WEBTRANSPORT_URL: string;
  MOQ_ENABLED: boolean;

  // Optimization features
  TRUSTED_SEED_ENABLED: boolean;
  DEMAND_DRIVEN_TRANSCODING: boolean;
  DYNAMIC_PREFETCH: boolean;
  HEDGED_REQUESTS: boolean;
  REQUEST_COALESCING: boolean;
  SCARCITY_SCHEDULING: boolean;
  DYNAMIC_REPLICATION: boolean;
  HOT_CONTENT_PROMOTION: boolean;
  LAN_OPTIMIZATION: boolean;

  // v6 additions
  FILEBASE_ARCHIVE_ENABLED: boolean;

  // TURN
  TURN_ENABLED: boolean;

  // CORS
  ALLOWED_ORIGINS: string;

  // Cost config (optional, for internal accounting)
  ORIGIN_COST_PER_GB: number;

  // Storage provider selection
  STORAGE_PROVIDER: string;

  // P2P tracker fail-open override (dev only — §39, §87)
  FAIL_OPEN_P2P: boolean;
}

function parseBool(val: string | undefined, fallback: boolean): boolean {
  if (val === undefined) return fallback;
  return val === "true" || val === "1" || val === "yes";
}

function parseNum(val: string | undefined, fallback: number): number {
  if (val === undefined) return fallback;
  return Number(val) || fallback;
}

export function getMediaFabricConfig(): MediaFabricConfig {
  return {
    DISTRIBUTED_MEDIA_ENABLED: parseBool(process.env.DISTRIBUTED_MEDIA_ENABLED, true),

    P2P_ENABLED: parseBool(process.env.P2P_ENABLED, true),
    P2P_UPLOAD_ENABLED: parseBool(process.env.P2P_UPLOAD_ENABLED, true),
    P2P_MAX_PEERS: parseNum(process.env.P2P_MAX_PEERS, 6),
    P2P_MAX_UPLOAD_MBPS: parseNum(process.env.P2P_MAX_UPLOAD_MBPS, 2),
    P2P_MAX_UPLOAD_BYTES: parseNum(process.env.P2P_MAX_UPLOAD_BYTES, 262_144_000),
    P2P_MAX_CONCURRENT_UPLOADS: parseNum(process.env.P2P_MAX_CONCURRENT_UPLOADS, 2),
    P2P_BACKGROUND_ENABLED: parseBool(process.env.P2P_BACKGROUND_ENABLED, false),
    P2P_LOW_BATTERY_MODE: parseBool(process.env.P2P_LOW_BATTERY_MODE, true),

    LOCAL_MEDIA_CACHE_ENABLED: parseBool(process.env.LOCAL_MEDIA_CACHE_ENABLED, true),

    WEBTRANSPORT_ENABLED: parseBool(process.env.WEBTRANSPORT_ENABLED, true),
    WEBTRANSPORT_URL: process.env.WEBTRANSPORT_URL || "",
    MOQ_ENABLED: parseBool(process.env.MOQ_ENABLED, false),

    TRUSTED_SEED_ENABLED: parseBool(process.env.TRUSTED_SEED_ENABLED, true),
    DEMAND_DRIVEN_TRANSCODING: parseBool(process.env.DEMAND_DRIVEN_TRANSCODING, true),
    DYNAMIC_PREFETCH: parseBool(process.env.DYNAMIC_PREFETCH, true),
    HEDGED_REQUESTS: parseBool(process.env.HEDGED_REQUESTS, true),
    REQUEST_COALESCING: parseBool(process.env.REQUEST_COALESCING, true),
    SCARCITY_SCHEDULING: parseBool(process.env.SCARCITY_SCHEDULING, true),
    DYNAMIC_REPLICATION: parseBool(process.env.DYNAMIC_REPLICATION, true),
    HOT_CONTENT_PROMOTION: parseBool(process.env.HOT_CONTENT_PROMOTION, true),
    LAN_OPTIMIZATION: parseBool(process.env.LAN_OPTIMIZATION, true),

    TURN_ENABLED: parseBool(process.env.TURN_ENABLED, false),

    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "*",

    ORIGIN_COST_PER_GB: parseNum(process.env.ORIGIN_COST_PER_GB, 0),

    // v6 additions
    FILEBASE_ARCHIVE_ENABLED: parseBool(process.env.FILEBASE_ARCHIVE_ENABLED, false),
    STORAGE_PROVIDER: process.env.STORAGE_PROVIDER || "local",
    FAIL_OPEN_P2P: parseBool(process.env.FAIL_OPEN_P2P, false),
  };
}

/** Check if a specific feature is enabled. */
export function isEnabled(flag: keyof MediaFabricConfig): boolean {
  const config = getMediaFabricConfig();
  const value = config[flag];
  return typeof value === "boolean" ? value : false;
}
