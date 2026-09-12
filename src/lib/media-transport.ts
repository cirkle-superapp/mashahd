/**
 * MediaTransport — transport-neutral abstraction for media delivery.
 *
 * Implements S9: a formal interface that HTTP/HLS, WebRTC P2P, WebTransport,
 * and future MoQ transports all implement. The delivery scheduler uses this
 * interface to select the best transport without hard-coding routing logic
 * into the player.
 */

export type TransportType = "http" | "p2p" | "webtransport" | "moq";

export interface TransportContext {
  networkType: string;
  effectiveType: string;
  saveData: boolean;
  downlink: number;
  rtt: number;
  batteryLevel: number | null;
  pageVisible: boolean;
  bufferDepth: number;
  peerCount: number;
  cacheBudget: number;
}

export interface MediaObjectRequest {
  videoId: string;
  renditionId: string;
  manifestVersion: string;
  segmentIndex: number;
  swarmId: string;
  url: string; // the HTTP fallback URL
  expectedSize: number;
  deadline: number; // ms until playback stalls
}

export interface MediaObjectHandle {
  data: ArrayBuffer;
  source: TransportType;
  duration: number; // ms to retrieve
  bytesFromPeer: number;
  bytesFromOrigin: number;
  cacheHit: boolean;
}

export interface TransportStats {
  type: TransportType;
  requests: number;
  successes: number;
  failures: number;
  bytesTransferred: number;
  avgLatency: number;
}

export interface MediaTransport {
  type: TransportType;
  canUse(context: TransportContext): boolean;
  open(request: MediaObjectRequest): Promise<MediaObjectHandle>;
  cancel(requestId: string): void;
  getStats(): TransportStats;
}

/**
 * HTTP Transport — the baseline fallback. Always available.
 */
export class HttpTransport implements MediaTransport {
  type: TransportType = "http";
  private stats: TransportStats = {
    type: "http",
    requests: 0,
    successes: 0,
    failures: 0,
    bytesTransferred: 0,
    avgLatency: 0,
  };

  canUse(_context: TransportContext): boolean {
    return true; // HTTP is always available
  }

  async open(request: MediaObjectRequest): Promise<MediaObjectHandle> {
    const start = performance.now();
    this.stats.requests++;

    try {
      const response = await fetch(request.url);
      if (!response.ok) throw new Error(`HTTP ${response.status}`);
      const data = await response.arrayBuffer();
      const duration = performance.now() - start;

      this.stats.successes++;
      this.stats.bytesTransferred += data.byteLength;
      this.stats.avgLatency = (this.stats.avgLatency * (this.stats.successes - 1) + duration) / this.stats.successes;

      return {
        data,
        source: "http",
        duration,
        bytesFromPeer: 0,
        bytesFromOrigin: data.byteLength,
        cacheHit: false,
      };
    } catch (e) {
      this.stats.failures++;
      throw e;
    }
  }

  cancel(): void {
    // HTTP fetch can't be cancelled cleanly, but the player will use the
    // response or discard it based on whether it's still needed.
  }

  getStats(): TransportStats {
    return { ...this.stats };
  }
}

/**
 * Transport Registry — manages available transports and provides
 * the interface for the delivery scheduler.
 */
export class TransportRegistry {
  private transports: Map<TransportType, MediaTransport> = new Map();

  register(transport: MediaTransport): void {
    this.transports.set(transport.type, transport);
  }

  get(type: TransportType): MediaTransport | undefined {
    return this.transports.get(type);
  }

  getAvailable(context: TransportContext): MediaTransport[] {
    return Array.from(this.transports.values()).filter((t) => t.canUse(context));
  }

  getAllStats(): TransportStats[] {
    return Array.from(this.transports.values()).map((t) => t.getStats());
  }
}
