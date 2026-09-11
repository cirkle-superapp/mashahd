/**
 * P2P Policy Engine — determines whether P2P should be enabled for the
 * current playback session based on network type, data-saver mode, page
 * visibility, battery, and user opt-out.
 *
 * Core rules (hard blocks):
 *   - Cellular (2g/3g/4g/5g) → P2P OFF (no cellular data contribution)
 *   - saveData=true → P2P OFF (regardless of Wi-Fi)
 *   - Background tab → P2P upload OFF (receive-only or fully off)
 *   - Poor network (high RTT, low downlink) → P2P OFF
 *   - User opt-out → P2P OFF
 *   - Wi-Fi / Ethernet → P2P ON (bounded: maxPeers=6, upload limits)
 *
 * The engine degrades gracefully when browser APIs (Network Information,
 * Battery, Visibility) are unavailable — it uses conservative behavior.
 */

export type NetworkType = "wifi" | "ethernet" | "cellular" | "unknown";
export type EffectiveType = "slow-2g" | "2g" | "3g" | "4g" | "unknown";

export interface NetworkInfo {
  type: NetworkType;
  effectiveType: EffectiveType;
  saveData: boolean;
  downlink: number; // Mbps
  rtt: number; // ms
}

export interface P2PPolicy {
  enabled: boolean;
  uploadEnabled: boolean;
  maxPeers: number;
  maxUploadMbps: number;
  maxUploadBytes: number;
  reason: string;
}

export interface P2PConfig {
  enabled: boolean;
  uploadEnabled: boolean;
  maxPeers: number;
  maxUploadMbps: number;
  maxUploadBytes: number;
  backgroundEnabled: boolean;
  lowBatteryMode: boolean;
}

export const DEFAULT_P2P_CONFIG: P2PConfig = {
  enabled: true,
  uploadEnabled: true,
  maxPeers: 6,
  maxUploadMbps: 2,
  maxUploadBytes: 262_144_000, // 250 MB
  backgroundEnabled: false,
  lowBatteryMode: true,
};

/** Read the Network Information API (if available). */
export function readNetworkInfo(): NetworkInfo {
  const conn = (navigator as any)?.connection;
  if (!conn) {
    return {
      type: "unknown",
      effectiveType: "unknown",
      saveData: false,
      downlink: 0,
      rtt: 0,
    };
  }
  const type = conn.type || (conn.effectiveType && conn.effectiveType !== "4g" ? "cellular" : "unknown");
  return {
    type: type as NetworkType,
    effectiveType: (conn.effectiveType || "unknown") as EffectiveType,
    saveData: Boolean(conn.saveData),
    downlink: conn.downlink || 0,
    rtt: conn.rtt || 0,
  };
}

/**
 * Evaluate the P2P policy for the current session.
 * Returns the resolved policy + the reason for the decision.
 */
export function evaluatePolicy(
  net: NetworkInfo,
  config: P2PConfig,
  opts: { pageVisible: boolean; userOptOut: boolean; batteryLow?: boolean }
): P2PPolicy {
  const base: P2PPolicy = {
    enabled: config.enabled,
    uploadEnabled: config.uploadEnabled,
    maxPeers: config.maxPeers,
    maxUploadMbps: config.maxUploadMbps,
    maxUploadBytes: config.maxUploadBytes,
    reason: "",
  };

  // User opt-out is the highest priority.
  if (opts.userOptOut) {
    return { ...base, enabled: false, uploadEnabled: false, reason: "user opt-out" };
  }

  // Global kill switch.
  if (!config.enabled) {
    return { ...base, enabled: false, uploadEnabled: false, reason: "P2P disabled globally" };
  }

  // Cellular hard block (2g/3g/4g/5g).
  const cellularTypes: EffectiveType[] = ["slow-2g", "2g", "3g", "4g"];
  if (cellularTypes.includes(net.effectiveType)) {
    return { ...base, enabled: false, uploadEnabled: false, reason: "cellular network — P2P off" };
  }
  if (net.type === "cellular") {
    return { ...base, enabled: false, uploadEnabled: false, reason: "cellular network — P2P off" };
  }

  // Data-saver hard block.
  if (net.saveData) {
    return { ...base, enabled: false, uploadEnabled: false, reason: "data saver enabled — P2P off" };
  }

  // Poor network (high RTT or very low downlink).
  if (net.rtt > 0 && net.rtt > 800) {
    return { ...base, enabled: false, uploadEnabled: false, reason: "poor network (high RTT)" };
  }
  if (net.downlink > 0 && net.downlink < 0.5) {
    return { ...base, enabled: false, uploadEnabled: false, reason: "poor network (low downlink)" };
  }

  // Background tab — disable upload, optionally disable P2P entirely.
  if (!opts.pageVisible) {
    if (!config.backgroundEnabled) {
      return { ...base, enabled: false, uploadEnabled: false, reason: "background tab — P2P off" };
    }
    return { ...base, uploadEnabled: false, reason: "background tab — receive only" };
  }

  // Low battery — prefer receive-only if we have reliable battery info.
  if (opts.batteryLow && config.lowBatteryMode) {
    return { ...base, uploadEnabled: false, reason: "low battery — receive only" };
  }

  // Wi-Fi / Ethernet — P2P ON with bounded participation.
  return { ...base, reason: net.type === "wifi" ? "Wi-Fi — P2P on" : "eligible network — P2P on" };
}
