/**
 * Mashahd Watch Party Service — a lightweight WebSocket service for
 * real-time co-watching. Friends create a "party" with a shareable code,
 * join it, and their video playback stays synchronized:
 *
 *   - play / pause broadcasts to everyone
 *   - seek broadcasts to everyone
 *   - presence (who's watching) updates in real time
 *   - chat messages within the party
 *
 * This is a control-plane service. It does NOT transport video — only
 * small sync/presence/chat messages (max 4KB each). Each party has a
 * short alphanumeric code (6 chars) that's easy to share.
 *
 * Port: 3004 (the Caddy gateway forwards via XTransformPort=3004).
 */

import { WebSocketServer, WebSocket } from "ws";
import http from "node:http";

const PORT = 3004;
const MAX_PAYLOAD = 4096; // 4 KB — sync + chat messages are tiny
const HEARTBEAT_INTERVAL = 25000; // 25s
const PEER_TIMEOUT = 60000; // 60s without heartbeat → expire
const MAX_PARTY_MEMBERS = 12; // a watch party is a small group
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars
const CODE_LEN = 6;

// Allowed origins for WebSocket connections (deep audit pass 2: was missing).
const ALLOWED_ORIGINS = (process.env.ALLOWED_ORIGINS || "http://localhost:3000")
  .split(",")
  .map((s) => s.trim())
  .filter(Boolean);

interface Member {
  ws: WebSocket;
  memberId: string;
  name: string;
  avatarUrl: string;
  partyCode: string | null;
  lastHeartbeat: number;
  isAlive: boolean;
}

interface Party {
  code: string;
  videoId: string;
  videoTitle: string;
  hostId: string;
  members: Set<string>; // memberIds
  // Shared playback state — the host is the source of truth.
  playing: boolean;
  currentTime: number;
  // Monotonic state revision — incremented on every state change.
  // Clients send their lastSeenRevision on reconnect; the server sends
  // back the full state + all messages with revision > lastSeenRevision.
  stateRevision: number;
  // Generation — increments on host change. Used by clients to detect
  // that the host has changed (and they should re-sync).
  generation: number;
  updatedAt: number;
}

const members = new Map<string, Member>();
const parties = new Map<string, Party>();

// ── HTTP + WebSocket server ──
// The HTTP server handles /health (for monitoring + load balancers) and
// the WebSocket server shares the same port for watch-party signaling.
const server = http.createServer((req, res) => {
  if (req.url === "/health") {
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({
      ok: true,
      service: "watch-party",
      port: PORT,
      uptime: process.uptime(),
      members: members.size,
      parties: parties.size,
      timestamp: new Date().toISOString(),
    }));
    return;
  }
  res.writeHead(404, { "Content-Type": "application/json" });
  res.end(JSON.stringify({ error: "not found" }));
});

const wss = new WebSocketServer({ server });

function genCode(): string {
  // Generate a unique 6-char code.
  for (let tries = 0; tries < 50; tries++) {
    let code = "";
    for (let i = 0; i < CODE_LEN; i++) {
      code += CODE_ALPHABET[Math.floor(Math.random() * CODE_ALPHABET.length)];
    }
    if (!parties.has(code)) return code;
  }
  // Fallback — append a random suffix.
  return "PARTY" + Math.random().toString(36).slice(2, 6).toUpperCase();
}

function send(ws: WebSocket, msg: any) {
  if (ws.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify(msg));
  }
}

function broadcast(partyCode: string, msg: any, exceptMemberId?: string) {
  const party = parties.get(partyCode);
  if (!party) return;
  for (const memberId of party.members) {
    if (memberId === exceptMemberId) continue;
    const m = members.get(memberId);
    if (m) send(m.ws, msg);
  }
}

function broadcastPresence(partyCode: string) {
  const party = parties.get(partyCode);
  if (!party) return;
  const presence = Array.from(party.members).map((id) => {
    const m = members.get(id);
    return m
      ? { memberId: id, name: m.name, avatarUrl: m.avatarUrl, isHost: id === party.hostId }
      : null;
  }).filter(Boolean);
  broadcast(partyCode, { type: "presence", members: presence });
}

wss.on("connection", (ws, req) => {
  // ── Origin validation (deep audit pass 2: was missing) ──
  const origin = req.headers.origin;
  if (origin && ALLOWED_ORIGINS.length > 0 && !ALLOWED_ORIGINS.includes(origin)) {
    console.warn(`[watch-party] Rejected connection from origin: ${origin}`);
    ws.close(1008, "Origin not allowed");
    return;
  }
  const memberId = `m_${Math.random().toString(36).slice(2, 12)}`;
  const member: Member = {
    ws,
    memberId,
    name: "Guest",
    avatarUrl: "",
    partyCode: null,
    lastHeartbeat: Date.now(),
    isAlive: true,
  };
  members.set(memberId, member);
  send(ws, { type: "welcome", memberId });

  ws.on("message", (raw) => {
    const rawBytes = Buffer.isBuffer(raw) ? raw : Buffer.from(raw as ArrayBuffer);
    if (rawBytes.length > MAX_PAYLOAD) {
      send(ws, { type: "error", code: "PAYLOAD_TOO_LARGE", message: "message exceeds 4KB" });
      return;
    }
    let msg: any;
    try {
      msg = JSON.parse(rawBytes.toString());
    } catch {
      send(ws, { type: "error", code: "BAD_JSON", message: "invalid JSON" });
      return;
    }

    member.lastHeartbeat = Date.now();

    switch (msg.type) {
      case "identify": {
        member.name = String(msg.name || "Guest").slice(0, 60);
        member.avatarUrl = String(msg.avatarUrl || "").slice(0, 500);
        send(ws, { type: "identified", memberId, name: member.name });
        break;
      }

      case "create": {
        // Create a new watch party.
        const videoId = String(msg.videoId || "").slice(0, 60);
        const videoTitle = String(msg.videoTitle || "").slice(0, 200);
        if (!videoId) {
          send(ws, { type: "error", code: "BAD_REQUEST", message: "videoId required" });
          return;
        }
        const code = genCode();
        const party: Party = {
          code,
          videoId,
          videoTitle,
          hostId: memberId,
          members: new Set([memberId]),
          playing: false,
          currentTime: 0,
          stateRevision: 1, // monotonic counter — starts at 1
          generation: 1, // increments on host change
          updatedAt: Date.now(),
        };
        parties.set(code, party);
        member.partyCode = code;
        send(ws, {
          type: "created",
          code,
          videoId,
          videoTitle,
          isHost: true,
          stateRevision: party.stateRevision,
          generation: party.generation,
        });
        broadcastPresence(code);
        break;
      }

      case "join": {
        const code = String(msg.code || "").toUpperCase().slice(0, CODE_LEN);
        const party = parties.get(code);
        if (!party) {
          send(ws, { type: "error", code: "PARTY_NOT_FOUND", message: `No party with code ${code}` });
          return;
        }
        if (party.members.size >= MAX_PARTY_MEMBERS) {
          send(ws, { type: "error", code: "PARTY_FULL", message: "This party is full (max 12)" });
          return;
        }
        // Leave previous party if any.
        if (member.partyCode && member.partyCode !== code) {
          leaveParty(member);
        }
        party.members.add(memberId);
        member.partyCode = code;
        send(ws, {
          type: "joined",
          code,
          videoId: party.videoId,
          videoTitle: party.videoTitle,
          isHost: memberId === party.hostId,
          // Sync the new joiner to the current playback state.
          playing: party.playing,
          currentTime: party.currentTime,
          // State recovery (Phase 16): include the current revision + generation
          // so the client can detect if it needs to re-sync.
          stateRevision: party.stateRevision,
          generation: party.generation,
        });
        broadcastPresence(code);
        // Notify others that someone joined.
        broadcast(code, { type: "member_joined", name: member.name }, memberId);
        break;
      }

      case "reconnect": {
        // Phase 16: State recovery after reconnect.
        // Client sends its lastSeenRevision + party code. Server sends back
        // the full state so the client can reconstruct.
        const code = String(msg.code || "").toUpperCase().slice(0, CODE_LEN);
        const lastSeenRevision = Number(msg.lastSeenRevision) || 0;
        const party = parties.get(code);
        if (!party) {
          send(ws, { type: "error", code: "PARTY_NOT_FOUND", message: `No party with code ${code}` });
          return;
        }
        // Re-add the member to the party.
        party.members.add(memberId);
        member.partyCode = code;
        // Send the full current state.
        send(ws, {
          type: "reconnect_state",
          code,
          videoId: party.videoId,
          videoTitle: party.videoTitle,
          playing: party.playing,
          currentTime: party.currentTime,
          stateRevision: party.stateRevision,
          generation: party.generation,
          isHost: memberId === party.hostId,
        });
        broadcastPresence(code);
        break;
      }

      case "leave": {
        leaveParty(member);
        send(ws, { type: "left" });
        break;
      }

      case "sync": {
        // Host broadcasts a playback state change.
        if (!member.partyCode) return;
        const party = parties.get(member.partyCode);
        if (!party || party.hostId !== memberId) {
          // Only the host can broadcast sync state. Non-hosts can request
          // a "resync" which the host handles.
          if (msg.action === "request_resync") {
            broadcast(member.partyCode!, { type: "resync_request", from: memberId }, memberId);
          }
          return;
        }
        const action = String(msg.action || "state"); // play, pause, seek, state
        if (typeof msg.currentTime === "number") {
          party.currentTime = Math.max(0, msg.currentTime);
        }
        if (action === "play") party.playing = true;
        if (action === "pause") party.playing = false;
        // Increment the monotonic state revision.
        party.stateRevision++;
        party.updatedAt = Date.now();
        broadcast(party.code, {
          type: "sync",
          action,
          currentTime: party.currentTime,
          playing: party.playing,
          from: memberId,
          stateRevision: party.stateRevision,
          generation: party.generation,
          serverTime: Date.now(),
        }, memberId);
        break;
      }

      case "chat": {
        // Chat message within the party.
        if (!member.partyCode) return;
        const text = String(msg.text || "").slice(0, 500);
        if (!text) return;
        broadcast(member.partyCode, {
          type: "chat",
          memberId,
          name: member.name,
          avatarUrl: member.avatarUrl,
          text,
          at: Date.now(),
        });
        break;
      }

      case "heartbeat": {
        send(ws, { type: "heartbeat_ack", t: Date.now() });
        break;
      }

      default:
        send(ws, { type: "error", code: "UNKNOWN_TYPE", message: `unknown message type: ${msg.type}` });
    }
  });

  ws.on("pong", () => { member.isAlive = true; });
  ws.on("close", () => {
    leaveParty(member);
    members.delete(memberId);
  });
  ws.on("error", () => {});
});

function leaveParty(member: Member) {
  if (!member.partyCode) return;
  const party = parties.get(member.partyCode);
  if (!party) {
    member.partyCode = null;
    return;
  }
  party.members.delete(member.memberId);
  member.partyCode = null;

  // If the host left, promote the next member (or close the party).
  if (party.hostId === member.memberId) {
    const next = party.members.values().next();
    if (!next.done) {
      party.hostId = next.value;
      party.generation++; // Increment generation on host change (Phase 16)
      party.stateRevision++;
      // Notify the new host.
      const newHost = members.get(party.hostId);
      if (newHost) send(newHost.ws, { type: "promoted", code: party.code, generation: party.generation });
      // Broadcast the generation change to all members.
      broadcast(party.code, { type: "host_changed", newHostId: party.hostId, generation: party.generation });
    } else {
      parties.delete(party.code);
      return;
    }
  }
  broadcastPresence(party.code);
  broadcast(party.code, { type: "member_left", name: member.name });
}

// Heartbeat sweep — expire dead connections.
const heartbeatTimer = setInterval(() => {
  const now = Date.now();
  for (const [id, member] of members) {
    if (now - member.lastHeartbeat > PEER_TIMEOUT) {
      try { member.ws.terminate(); } catch {}
      leaveParty(member);
      members.delete(id);
    } else if (member.isAlive === false) {
      try { member.ws.terminate(); } catch {}
      leaveParty(member);
      members.delete(id);
    } else {
      member.isAlive = false;
      try { member.ws.ping(); } catch {}
    }
  }
}, HEARTBEAT_INTERVAL);

// ── Drift correction (Phase 16) ──
// Every 30s, the host broadcasts a "drift_check" message with the server
// time + current position. Clients compare their local time to the server
// time and adjust if drift > 2s. This prevents gradual desync over long
// watch sessions.
const DRIFT_CHECK_INTERVAL_MS = 30_000;
const driftTimer = setInterval(() => {
  for (const [code, party] of parties) {
    if (party.members.size === 0) continue;
    if (!party.playing) continue;
    broadcast(code, {
      type: "drift_check",
      serverTime: Date.now(),
      currentTime: party.currentTime,
      stateRevision: party.stateRevision,
      generation: party.generation,
    });
  }
}, DRIFT_CHECK_INTERVAL_MS);

// ── Start the HTTP + WebSocket server ──
server.listen(PORT, () => {
  console.log(`[watch-party] listening on http://localhost:${PORT} (ws + /health)`);
});

// ── Graceful shutdown (deep audit pass 2: was missing) ──
let shuttingDown = false;
function shutdown(signal: string) {
  if (shuttingDown) return;
  shuttingDown = true;
  console.log(`[watch-party] ${signal} received, shutting down gracefully…`);
  clearInterval(heartbeatTimer);
  clearInterval(driftTimer);
  // Notify all members to reconnect elsewhere.
  for (const [id, member] of members) {
    try {
      if (member.ws.readyState === WebSocket.OPEN) {
        member.ws.close(1001, "server shutting down");
      }
    } catch { /* ignore */ }
  }
  wss.close(() => {
    server.close(() => {
      console.log("[watch-party] all connections closed, exiting.");
      process.exit(0);
    });
  });
  setTimeout(() => {
    console.warn("[watch-party] graceful shutdown timed out, forcing exit.");
    process.exit(1);
  }, 5000).unref();
}

process.on("SIGTERM", () => shutdown("SIGTERM"));
process.on("SIGINT", () => shutdown("SIGINT"));
