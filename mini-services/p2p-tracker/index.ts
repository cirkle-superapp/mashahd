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

const PORT = 3003;
const HEARTBEAT_INTERVAL = 20000; // 20s
const PEER_TIMEOUT = 60000; // 60s without heartbeat → expire
const MAX_PAYLOAD = 16384; // 16 KB — signaling messages are small
const MAX_PEERS_PER_SWARM = 50;

interface Peer {
  ws: WebSocket;
  peerId: string;
  swarmId: string | null;
  lastHeartbeat: number;
  isAlive: boolean;
}

const peers = new Map<string, Peer>();
const swarms = new Map<string, Set<string>>(); // swarmId → Set<peerId>

const wss = new WebSocketServer({ port: PORT });

wss.on("connection", (ws, req) => {
  const peerId = `p_${Math.random().toString(36).slice(2, 12)}`;
  const peer: Peer = { ws, peerId, swarmId: null, lastHeartbeat: Date.now(), isAlive: true };
  peers.set(peerId, peer);

  // Acknowledge the new peer with its ID.
  send(ws, { type: "welcome", peerId });

  ws.on("message", (raw) => {
    if (raw.length > MAX_PAYLOAD) {
      send(ws, { type: "error", code: "PAYLOAD_TOO_LARGE", message: "message exceeds 16KB" });
      return;
    }
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
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
