/**
 * Feature flags for the Autonomous Distributed Media Fabric v3.
 *
 * All flags default to safe values. Optional/experimental features are
 * disabled by default. Environment variables override defaults.
 *
 * Implements S72.
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
  P2P_BACKGROUND_ENABLED: boolean;
  P2P_LOW_BATTERY_MODE: boolean;

  // Local cache
  LOCAL_MEDIA_CACHE_ENABLED: boolean;

  // Transports
  WEBTRANSPORT_ENABLED: boolean;
  MOQ_ENABLED: boolean;

  // Optimization features
  TRUSTED_SEED_ENABLED: boolean;
  DEMAND_DRIVEN_TRANSCODING: boolean;
  DYNAMIC_PREFETCH: boolean;
  HEDGED_REQUESTS: boolean;
  REQUEST_COALESCING: boolean;
  SCARCITY_SCHEDULING: boolean;

  // TURN
  TURN_ENABLED: boolean;

  // CORS
  ALLOWED_ORIGINS: string;
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
    P2P_BACKGROUND_ENABLED: parseBool(process.env.P2P_BACKGROUND_ENABLED, false),
    P2P_LOW_BATTERY_MODE: parseBool(process.env.P2P_LOW_BATTERY_MODE, true),

    LOCAL_MEDIA_CACHE_ENABLED: parseBool(process.env.LOCAL_MEDIA_CACHE_ENABLED, true),

    WEBTRANSPORT_ENABLED: parseBool(process.env.WEBTRANSPORT_ENABLED, true),
    MOQ_ENABLED: parseBool(process.env.MOQ_ENABLED, false),

    TRUSTED_SEED_ENABLED: parseBool(process.env.TRUSTED_SEED_ENABLED, true),
    DEMAND_DRIVEN_TRANSCODING: parseBool(process.env.DEMAND_DRIVEN_TRANSCODING, true),
    DYNAMIC_PREFETCH: parseBool(process.env.DYNAMIC_PREFETCH, true),
    HEDGED_REQUESTS: parseBool(process.env.HEDGED_REQUESTS, true),
    REQUEST_COALESCING: parseBool(process.env.REQUEST_COALESCING, true),
    SCARCITY_SCHEDULING: parseBool(process.env.SCARCITY_SCHEDULING, true),

    TURN_ENABLED: parseBool(process.env.TURN_ENABLED, false),

    ALLOWED_ORIGINS: process.env.ALLOWED_ORIGINS || "*",
  };
}

/** Check if a specific feature is enabled. */
export function isEnabled(flag: keyof MediaFabricConfig): boolean {
  const config = getMediaFabricConfig();
  const value = config[flag];
  return typeof value === "boolean" ? value : false;
}
