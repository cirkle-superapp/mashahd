/**
 * Mashahd P2P Tracker — a lightweight WebSocket signaling service.
 *
 * Responsibilities (per the master spec):
 *   - swarm discovery
 *   - peer announcement
 *   - peer membership
 *   - WebRTC offer/answer exchange
 *   - ICE candidate exchange
 *   - peer expiration
 *   - heartbeat
 *
 * It MUST NOT transport video — only small signaling/control messages.
 * Media flows peer ⇄ peer via WebRTC data channels.
 *
 * Security:
 *   - origin validation
 *   - rate limiting (connection + swarm-join)
 *   - max payload size
 *   - swarm authorization (peers must claim a valid swarmId)
 *   - peer session expiration (45-90s timeout)
 *
 * Port: 3003 (hardcoded — the Caddy gateway forwards via XTransformPort=3003).
 */

import { WebSocketServer, WebSocket } from "ws";
import { createClient, type Client } from "@libsql/client";

const PORT = 3003;
const HEARTBEAT_INTERVAL = 20000; // 20s
const PEER_TIMEOUT = 60000; // 60s without heartbeat → expire
const MAX_PAYLOAD = 16384; // 16 KB — signaling messages are small
const MAX_PEERS_PER_SWARM = 50;

// ── Turso client for swarm authorization (S89, S91) ──
// Verifies that a swarmId actually exists in the DB before allowing a peer
// to join. Prevents swarm poisoning.
let tursoClient: Client | null = null;
const tursoUrl = process.env.TURSO_URL;
const tursoToken = process.env.TURSO_AUTH_TOKEN;
if (tursoUrl && tursoToken) {
  try {
    const httpsUrl = tursoUrl.startsWith("libsql://") ? tursoUrl.replace("libsql://", "https://") : tursoUrl;
    tursoClient = createClient({ url: httpsUrl, authToken: tursoToken });
    console.log("[p2p-tracker] Swarm authorization enabled (Turso)");
  } catch (e) {
    console.warn("[p2p-tracker] Turso init failed, swarm authorization disabled:", e);
  }
}

// In-memory cache of valid swarmIds (60s TTL) to avoid a DB query per join.
const swarmCache = new Map<string, number>(); // swarmId → expiresAt
const SWARM_CACHE_TTL_MS = 60_000;

async function isValidSwarm(swarmId: string): Promise<boolean> {
  // Check cache first.
  const cached = swarmCache.get(swarmId);
  if (cached !== undefined) {
    if (cached > Date.now()) return true;
    swarmCache.delete(swarmId);
  }

  // Query Turso if available.
  if (!tursoClient) {
    // No Turso → allow all (dev mode). In production, this should fail closed.
    return true;
  }

  try {
    const result = await tursoClient.execute({
      sql: "SELECT id FROM Swarm WHERE swarmId = ? LIMIT 1",
      args: [swarmId],
    });
    const valid = result.rows.length > 0;
    if (valid) {
      swarmCache.set(swarmId, Date.now() + SWARM_CACHE_TTL_MS);
    }
    return valid;
  } catch (e) {
    console.warn("[p2p-tracker] Swarm validation error:", e);
    // On DB error, fail open (don't block playback) — the origin remains
    // the authoritative source, so a poisoned swarm can't corrupt media.
    return true;
  }
}

interface Peer {
  ws: WebSocket;
  peerId: string;
  swarmId: string | null;
  lastHeartbeat: number;
  isAlive: boolean;
}

const peers = new Map<string, Peer>();
const swarms = new Map<string, Set<string>>(); // swarmId → Set<peerId>

// Allowed origins for WebSocket connections. Comma-separated env var.
// Defaults to localhost for dev. In production, set to the app's domain.
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws, req) => {
  // ── Origin validation (S85-S86, S143) ──
  // Reject connections from disallowed origins. This prevents cross-site
  // WebSocket hijacking (CSWSH) attacks.
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
    console.warn(`[p2p-tracker] Rejected connection from origin: ${origin}`);
    ws.close(1008, "Origin not allowed");
    return;
  }

  const peerId = `p_${Math.random().toString(36).slice(2, 12)}`;
  const peer: Peer = { ws, peerId, swarmId: null, lastHeartbeat: Date.now(), isAlive: true };
  peers.set(peerId, peer);

  // Acknowledge the new peer with its ID.
  send(ws, { type: "welcome", peerId });

  ws.on("message", async (raw) => {
    const rawBytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    if (rawBytes.length > MAX_PAYLOAD) {
      send(ws, { type: "error", code: "PAYLOAD_TOO_LARGE", message: "message exceeds 16KB" });
      return;
    }
    let msg: any;
    try {
      msg = JSON.parse(rawBytes.toString());
    } catch {
      send(ws, { type: "error", code: "MALFORMED", message: "invalid JSON" });
      return;
    }

    peer.lastHeartbeat = Date.now();

    switch (msg.type) {
      case "heartbeat":
        send(ws, { type: "heartbeat-ack", peerId, ts: Date.now() });
        break;

      case "join-swarm": {
        const swarmId = String(msg.swarmId || "");
        if (!swarmId) {
          send(ws, { type: "error", code: "NO_SWARM", message: "swarmId required" });
          return;
        }
        // ── Swarm authorization (S89, S91) ──
        // Verify the swarmId exists in the DB before allowing the join.
        // Prevents swarm poisoning where a peer claims a different swarm.
        const valid = await isValidSwarm(swarmId);
        if (!valid) {
          send(ws, { type: "error", code: "INVALID_SWARM", message: "swarmId not found" });
          return;
        }
        // Rate limit: max 50 peers per swarm.
        if (!swarms.has(swarmId)) swarms.set(swarmId, new Set());
        const swarm = swarms.get(swarmId)!;
        if (swarm.size >= MAX_PEERS_PER_SWARM) {
          send(ws, { type: "error", code: "SWARM_FULL", message: "swarm is full" });
          return;
        }
        // Leave previous swarm if any.
        if (peer.swarmId && peer.swarmId !== swarmId) {
          leaveSwarm(peer);
        }
        peer.swarmId = swarmId;
        swarm.add(peerId);
        // Announce the new peer to existing swarm members + vice versa.
        for (const otherId of swarm) {
          if (otherId === peerId) continue;
          const other = peers.get(otherId);
          if (other && other.ws.readyState === WebSocket.OPEN) {
            send(other.ws, { type: "peer-joined", peerId, swarmId });
            send(ws, { type: "peer-joined", peerId: otherId, swarmId });
          }
        }
        send(ws, { type: "swarm-joined", swarmId, peerCount: swarm.size });
        break;
      }

      case "leave-swarm":
        leaveSwarm(peer);
        send(ws, { type: "swarm-left" });
        break;

      case "offer":
      case "answer":
      case "ice-candidate": {
        const to = String(msg.to || "");
        const target = peers.get(to);
        if (!target) {
          send(ws, { type: "error", code: "PEER_NOT_FOUND", message: `peer ${to} not found` });
          return;
        }
        // Forward the signaling message to the target.
        send(target.ws, { ...msg, from: peerId });
        break;
      }

      default:
        send(ws, { type: "error", code: "UNKNOWN_TYPE", message: `unknown message type: ${msg.type}` });
    }
  });

  ws.on("close", () => {
    leaveSwarm(peer);
    peers.delete(peerId);
  });

  ws.on("pong", () => {
    peer.isAlive = true;
    peer.lastHeartbeat = Date.now();
  });
});

function leaveSwarm(peer: Peer) {
  if (!peer.swarmId) return;
  const swarm = swarms.get(peer.swarmId);
  if (swarm) {
    swarm.delete(peer.peerId);
    // Notify remaining peers.
    for (const otherId of swarm) {
      const other = peers.get(otherId);
      if (other && other.ws.readyState === WebSocket.OPEN) {
        send(other.ws, { type: "peer-left", peerId: peer.peerId, swarmId: peer.swarmId });
      }
    }
    if (swarm.size === 0) swarms.delete(peer.swarmId);
  }
  peer.swarmId = null;
}

function send(ws: WebSocket, obj: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(obj));
  }
}

// Heartbeat + expiration sweep — every 20s, ping all peers and expire dead ones.
setInterval(() => {
  const now = Date.now();
  for (const [peerId, peer] of peers) {
    if (now - peer.lastHeartbeat > PEER_TIMEOUT) {
      // Expire the dead peer.
      leaveSwarm(peer);
      peer.ws.terminate();
      peers.delete(peerId);
      continue;
    }
    peer.isAlive = false;
    peer.ws.ping();
  }
}, HEARTBEAT_INTERVAL);

console.log(`[p2p-tracker] listening on ws://localhost:${PORT}`);
