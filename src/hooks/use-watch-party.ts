"use client";

import { useEffect, useRef, useState, useCallback } from "react";

/**
 * useWatchParty — a React hook that connects to the Mashahd Watch Party
 * WebSocket service (port 3004 via the Caddy gateway) and exposes:
 *
 *   - connected: whether the socket is open
 *   - create(videoId, videoTitle, name, avatarUrl): create a new party
 *   - join(code, name, avatarUrl): join an existing party
 *   - leave(): leave the current party
 *   - members: the current presence list
 *   - chat: the chat messages
 *   - hostSync: the latest playback sync from the host
 *   - sendSync(action, currentTime): host broadcasts a sync state
 *   - sendChat(text): send a chat message
 *
 * The WebSocket URL uses the XTransformPort query param so the Caddy
 * gateway routes it to port 3004. The path is always "/" (per gateway rules).
 */

type Member = {
  memberId: string;
  name: string;
  avatarUrl: string;
  isHost: boolean;
};

type ChatMsg = {
  memberId: string;
  name: string;
  avatarUrl: string;
  text: string;
  at: number;
};

type SyncState = {
  action: string; // play | pause | seek | state
  currentTime: number;
  playing: boolean;
  from: string;
  at: number;
};

export function useWatchParty() {
  const wsRef = useRef<WebSocket | null>(null);
  const memberIdRef = useRef<string | null>(null);
  // Indirection so the onclose handler (captured once per socket) can reach
  // the latest ensureConnected without referencing it before declaration.
  const reconnectRef = useRef<(() => void) | null>(null);
  const [connected, setConnected] = useState(false);
  const [partyCode, setPartyCode] = useState<string | null>(null);
  const [isHost, setIsHost] = useState(false);
  const [members, setMembers] = useState<Member[]>([]);
  const [chat, setChat] = useState<ChatMsg[]>([]);
  const [hostSync, setHostSync] = useState<SyncState | null>(null);
  const [resyncRequested, setResyncRequested] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const ensureConnected = useCallback(() => {
    if (wsRef.current && wsRef.current.readyState === WebSocket.OPEN) return;
    const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
    // In local dev (port 3000, no Caddy gateway), connect directly to the
    // watch-party service on port 3004. In production (behind Caddy on port
    // 81), use the XTransformPort query param so the gateway routes it.
    const isDev = window.location.port === "3000";
    const url = isDev
      ? `${protocol}//${window.location.hostname}:3004/`
      : `${protocol}//${window.location.host}/?XTransformPort=3004`;
    const ws = new WebSocket(url);
    wsRef.current = ws;

    ws.onopen = () => setConnected(true);
    ws.onclose = () => {
      setConnected(false);
      // Auto-reconnect after 2s (re-read the ref so it's always current).
      setTimeout(() => {
        if (wsRef.current === ws) {
          wsRef.current = null;
          // Re-invoke the latest ensureConnected via the ref indirection.
          reconnectRef.current?.();
        }
      }, 2000);
    };
    ws.onerror = () => setError("Connection error");
    ws.onmessage = (e) => {
      try {
        const msg = JSON.parse(e.data);
        switch (msg.type) {
          case "welcome":
            memberIdRef.current = msg.memberId;
            break;
          case "identified":
            break;
          case "created":
          case "joined":
            setPartyCode(msg.code);
            setIsHost(!!msg.isHost);
            setMembers([]);
            setChat([]);
            setHostSync(null);
            setError(null);
            // If we joined, sync to the current state immediately.
            if (msg.type === "joined" && typeof msg.currentTime === "number") {
              setHostSync({
                action: "state",
                currentTime: msg.currentTime,
                playing: !!msg.playing,
                from: msg.from || "",
                at: Date.now(),
              });
            }
            break;
          case "presence":
            setMembers(msg.members || []);
            break;
          case "sync":
            setHostSync({
              action: msg.action,
              currentTime: msg.currentTime,
              playing: msg.playing,
              from: msg.from,
              at: Date.now(),
            });
            break;
          case "resync_request":
            setResyncRequested(msg.from);
            break;
          case "chat":
            setChat((prev) => [...prev, {
              memberId: msg.memberId,
              name: msg.name,
              avatarUrl: msg.avatarUrl,
              text: msg.text,
              at: msg.at,
            }]);
            break;
          case "member_joined":
            // Presence broadcast will refresh the list; this is for toasts.
            break;
          case "promoted":
            setIsHost(true);
            break;
          case "left":
            setPartyCode(null);
            setIsHost(false);
            setMembers([]);
            setChat([]);
            setHostSync(null);
            break;
          case "error":
            setError(msg.message || "Unknown error");
            break;
        }
      } catch {
        /* ignore bad frames */
      }
    };
  }, []);

  useEffect(() => {
    reconnectRef.current = ensureConnected;
    ensureConnected();
    return () => {
      reconnectRef.current = null;
      try { wsRef.current?.close(); } catch {}
      wsRef.current = null;
    };
  }, [ensureConnected]);

  const send = useCallback((msg: any) => {
    const ws = wsRef.current;
    if (ws && ws.readyState === WebSocket.OPEN) {
      ws.send(JSON.stringify(msg));
    }
  }, []);

  const create = useCallback((videoId: string, videoTitle: string, name: string, avatarUrl: string) => {
    send({ type: "identify", name, avatarUrl });
    send({ type: "create", videoId, videoTitle });
  }, [send]);

  const join = useCallback((code: string, name: string, avatarUrl: string) => {
    send({ type: "identify", name, avatarUrl });
    send({ type: "join", code: code.toUpperCase().trim() });
  }, [send]);

  const leave = useCallback(() => {
    send({ type: "leave" });
  }, [send]);

  const sendSync = useCallback((action: "play" | "pause" | "seek" | "state", currentTime: number) => {
    send({ type: "sync", action, currentTime });
  }, [send]);

  const sendChat = useCallback((text: string) => {
    if (!text.trim()) return;
    send({ type: "chat", text: text.trim() });
  }, [send]);

  return {
    connected,
    partyCode,
    isHost,
    members,
    chat,
    hostSync,
    resyncRequested,
    error,
    create,
    join,
    leave,
    sendSync,
    sendChat,
  };
}
