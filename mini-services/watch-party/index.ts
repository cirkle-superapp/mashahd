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

const PORT = 3004;
const MAX_PAYLOAD = 4096; // 4 KB — sync + chat messages are tiny
const HEARTBEAT_INTERVAL = 25000; // 25s
const PEER_TIMEOUT = 60000; // 60s without heartbeat → expire
const MAX_PARTY_MEMBERS = 12; // a watch party is a small group
const CODE_ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789"; // no confusing chars
const CODE_LEN = 6;

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
  updatedAt: number;
}

const members = new Map<string, Member>();
const parties = new Map<string, Party>();

const wss = new WebSocketServer({ port: PORT });

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
    if (raw.length > MAX_PAYLOAD) {
      send(ws, { type: "error", code: "PAYLOAD_TOO_LARGE", message: "message exceeds 4KB" });
      return;
    }
    let msg: any;
    try {
      msg = JSON.parse(raw.toString());
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
        });
        broadcastPresence(code);
        // Notify others that someone joined.
        broadcast(code, { type: "member_joined", name: member.name }, memberId);
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
        party.updatedAt = Date.now();
        broadcast(party.code, {
          type: "sync",
          action,
          currentTime: party.currentTime,
          playing: party.playing,
          from: memberId,
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
      // Notify the new host.
      const newHost = members.get(party.hostId);
      if (newHost) send(newHost.ws, { type: "promoted", code: party.code });
    } else {
      parties.delete(party.code);
      return;
    }
  }
  broadcastPresence(party.code);
  broadcast(party.code, { type: "member_left", name: member.name });
}

// Heartbeat sweep — expire dead connections.
setInterval(() => {
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

console.log(`[watch-party] listening on ws://localhost:${PORT}`);
