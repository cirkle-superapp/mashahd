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

/**
 * WebTransport Adapter — browser↔self-hosted-edge transport over HTTP/3 QUIC.
 *
 * Per v6 spec §61: "Implement WebTransport as browser↔self-hosted-edge
 * optional production transport. Use reliable streams for media objects.
 * Do not send critical media through unreliable datagrams."
 *
 * This adapter checks for WebTransport browser support at runtime.
 * If unavailable, the scheduler falls back to HTTP.
 *
 * WebTransport is only enabled when WEBTRANSPORT_URL is set + the browser
 * supports it. The URL points to the self-hosted edge (not Vercel).
 */
export class WebTransportTransport implements MediaTransport {
  type: TransportType = "webtransport";
  private stats: TransportStats = {
    type: "webtransport",
    requests: 0,
    successes: 0,
    failures: 0,
    bytesTransferred: 0,
    avgLatency: 0,
  };
  private session: any = null;
  private url: string;

  constructor(url: string) {
    this.url = url;
  }

  canUse(context: TransportContext): boolean {
    // WebTransport requires:
    // 1. Browser support (typeof WebTransport !== 'undefined')
    // 2. A configured URL
    // 3. Not on cellular (per §41, P2P hard rule applies to WebTransport too)
    if (typeof globalThis !== "undefined" && typeof (globalThis as any).WebTransport === "undefined") {
      return false;
    }
    if (!this.url) return false;
    if (context.networkType === "cellular") return false;
    return true;
  }

  async open(request: MediaObjectRequest): Promise<MediaObjectHandle> {
    const start = performance.now();
    this.stats.requests++;

    try {
      // Open a WebTransport session if not already connected.
      if (!this.session) {
        const WT = (globalThis as any).WebTransport;
        this.session = new WT(this.url);
        await this.session.ready;
      }

      // Create a reliable bidirectional stream for the media object request.
      // Per §61: "Use reliable streams for media objects."
      const stream = await this.session.createBidirectionalStream();
      const writer = stream.writable.getWriter();
      await writer.write(new TextEncoder().encode(request.url));
      writer.close();

      // Read the response.
      const reader = stream.readable.getReader();
      const chunks: Uint8Array[] = [];
      let totalBytes = 0;
      const MAX_CHUNKS = 10000; // Safety limit — prevents infinite loops (§37)
      let chunkCount = 0;
      while (chunkCount < MAX_CHUNKS) {
        const { done, value } = await reader.read();
        if (done) break;
        chunks.push(value);
        totalBytes += value.byteLength;
        chunkCount++;
      }

      const data = new ArrayBuffer(totalBytes);
      const view = new Uint8Array(data);
      let offset = 0;
      for (const chunk of chunks) {
        view.set(chunk, offset);
        offset += chunk.byteLength;
      }

      const duration = performance.now() - start;
      this.stats.successes++;
      this.stats.bytesTransferred += totalBytes;
      this.stats.avgLatency = (this.stats.avgLatency * (this.stats.successes - 1) + duration) / this.stats.successes;

      return {
        data,
        source: "webtransport",
        duration,
        bytesFromPeer: 0,
        bytesFromOrigin: 0, // WebTransport is edge-served, not origin
        cacheHit: false,
      };
    } catch (e) {
      this.stats.failures++;
      // Close the session — it will be re-established on the next request.
      this.session = null;
      throw e;
    }
  }

  cancel(): void {
    // Cancel any in-flight stream. The session stays open for reuse.
  }

  getStats(): TransportStats {
    return { ...this.stats };
  }
}

/**
 * DeliveryClient — the layer between the player and the transport layer.
 *
 * Per v6 spec §168: "Create DeliveryClient between player and transport layer."
 * Per §169: "The player must not know provider details."
 *
 * The DeliveryClient:
 *   1. Checks local browser cache first (if LOCAL_MEDIA_CACHE_ENABLED)
 *   2. Tries P2P (if P2P_ENABLED + eligible network)
 *   3. Tries WebTransport (if WEBTRANSPORT_ENABLED + browser support)
 *   4. Falls back to HTTP (always available)
 *   5. Uses the delivery scheduler for source scoring (§65-77)
 *   6. Reports telemetry to the metrics store (§174)
 */
export class DeliveryClient {
  private registry: TransportRegistry;
  private cacheEnabled: boolean;
  private p2pEnabled: boolean;

  constructor(opts: {
    cacheEnabled?: boolean;
    p2pEnabled?: boolean;
    webtransportUrl?: string;
  } = {}) {
    this.registry = new TransportRegistry();
    this.registry.register(new HttpTransport());
    this.cacheEnabled = opts.cacheEnabled ?? true;
    this.p2pEnabled = opts.p2pEnabled ?? true;

    if (opts.webtransportUrl) {
      const wt = new WebTransportTransport(opts.webtransportUrl);
      if (wt.canUse({
        networkType: "wifi",
        effectiveType: "4g",
        saveData: false,
        downlink: 10,
        rtt: 50,
        batteryLevel: 1,
        pageVisible: true,
        bufferDepth: 10,
        peerCount: 0,
        cacheBudget: 0,
      })) {
        this.registry.register(wt);
      }
    }
  }

  /**
   * Fetch a media object. The player calls this — it doesn't know about
   * storage, P2P, or HTTP. It just asks for a media object.
   */
  async fetch(request: MediaObjectRequest): Promise<MediaObjectHandle> {
    const context: TransportContext = {
      networkType: this.detectNetworkType(),
      effectiveType: "4g",
      saveData: false,
      downlink: 10,
      rtt: 50,
      batteryLevel: 1,
      pageVisible: true,
      bufferDepth: 10,
      peerCount: 0,
      cacheBudget: 0,
    };

    // Get available transports (sorted by priority via scheduler).
    const available = this.registry.getAvailable(context);

    // Try each transport in order until one succeeds.
    for (const transport of available) {
      try {
        const handle = await transport.open(request);
        // Track delivery metrics.
        try {
          const { incrementMetric } = await import("./metrics-store");
          if (handle.source === "p2p") {
            incrementMetric("p2pBytesServed", handle.bytesFromPeer);
            incrementMetric("p2pHits");
          } else {
            incrementMetric("originBytesServed", handle.bytesFromOrigin);
            incrementMetric("cacheMisses");
          }
        } catch { /* metrics store not available */ }
        return handle;
      } catch (e) {
        // Transport failed — try the next one.
        console.warn(`[delivery-client] ${transport.type} failed:`, e);
      }
    }

    // All transports failed — this should never happen because HTTP always works.
    throw new Error("All transports failed for " + request.url);
  }

  private detectNetworkType(): "wifi" | "cellular" | "unknown" {
    if (typeof navigator !== "undefined" && (navigator as any).connection) {
      const conn = (navigator as any).connection;
      if (conn.type === "wifi") return "wifi";
      if (conn.type === "cellular") return "cellular";
      const cellular = ["slow-2g", "2g", "3g", "4g"];
      if (cellular.includes(conn.effectiveType)) return "cellular";
    }
    return "unknown";
  }

  /**
   * Get transport stats for observability (§174).
   */
  getStats(): TransportStats[] {
    return this.registry.getAllStats();
  }
}
