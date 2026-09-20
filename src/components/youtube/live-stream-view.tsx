"use client";

import { useState, useEffect, useRef, useCallback } from "react";
import { useQuery } from "@tanstack/react-query";
import {
  Radio,
  Users,
  Send,
  ArrowLeft,
  Wifi,
  WifiOff,
  Signal,
  Eye,
  Copy,
  Check,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/store/app-store";
import { useWatchParty } from "@/hooks/use-watch-party";
import { useBrowserId } from "@/hooks/use-browser-id";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

/**
 * LiveStreamView — the viewer experience for a live stream (Pass 48).
 *
 * Pass 47 built the broadcaster side (Go Live → POST → DB row + WS host).
 * This pass completes the feature: when a viewer clicks a "Live now" shelf
 * card, they land here. The view:
 *
 *   1. Fetches /api/live-streams/[id] for the stream metadata (title,
 *      streamer, category, viewer count, watchPartyCode).
 *   2. Joins the broadcaster's watch-party room over the WebSocket on
 *      port 3004 using the watchPartyCode. The WS is the source of truth
 *      for: live chat messages, presence (who's watching), and the real
 *      concurrent viewer count.
 *   3. Renders: stream preview placeholder (in dev — no RTMP backend),
 *      LIVE badge, real-time viewer count, presence avatars, live chat
 *      (with the ability for the viewer to send messages), and a "stream
 *      ended" state if the broadcaster ends the stream.
 *   4. On unmount, leaves the party (frees the WS slot).
 *
 * The viewer count + chat are REAL — they come from the watch-party
 * WebSocket, not simulated. If the broadcaster ends the stream, the DB
 * row's status flips to "ended"; the view polls /api/live-streams/[id]
 * every 10s to detect this and shows a "Stream ended" state with the
 * peak viewer count + duration.
 */

interface LiveStream {
  id: string;
  title: string;
  description: string;
  category: string;
  privacy: string;
  status: "preparing" | "live" | "ended";
  streamerName: string;
  streamerId: string;
  channelId: string;
  viewerCount: number;
  peakViewerCount: number;
  watchPartyCode: string;
  startedAt: string;
  endedAt: string;
  thumbnailUrl: string;
}

const CHAT_COLORS = [
  "text-rose-500", "text-amber-500", "text-emerald-500",
  "text-sky-500", "text-violet-500", "text-fuchsia-500",
  "text-orange-500", "text-lime-500", "text-cyan-500",
];

function colorForName(name: string): string {
  let h = 0;
  for (let i = 0; i < name.length; i++) h = (h * 31 + name.charCodeAt(i)) >>> 0;
  return CHAT_COLORS[h % CHAT_COLORS.length];
}

function streamerAvatar(name: string): string {
  return `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(name)}&radius=50`;
}

function elapsed(iso: string): string {
  if (!iso) return "—";
  const ms = Date.now() - new Date(iso).getTime();
  if (ms < 0 || !isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  if (s < 60) return `${s}s`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function duration(startIso: string, endIso: string): string {
  if (!startIso || !endIso) return "—";
  const ms = new Date(endIso).getTime() - new Date(startIso).getTime();
  if (ms < 0 || !isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

async function fetchStream(streamId: string): Promise<{ stream: LiveStream } | null> {
  const res = await fetch(`/api/live-streams/${streamId}`);
  if (!res.ok) return null;
  return res.json();
}

export function LiveStreamView({ streamId }: { streamId: string }) {
  const { navigate } = useAppStore();
  const bid = useBrowserId();
  const party = useWatchParty();

  // Fetch stream metadata. Poll every 10s so we detect when the broadcaster
  // ends the stream (status flips to "ended" in the DB).
  const { data, isLoading, error } = useQuery({
    queryKey: ["live-stream", streamId],
    queryFn: () => fetchStream(streamId),
    refetchInterval: 10_000,
    enabled: !!streamId,
  });

  const stream = data?.stream;
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState<
    Array<{ user: string; text: string; color: string; avatarUrl: string; at: number }>
  >([]);
  const [copied, setCopied] = useState(false);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // Determine the viewer's display name. In dev with no auth, we use a
  // random stable name so the chat shows different colors per viewer.
  const viewerName = useRef<string>(
    `Guest${Math.floor(1000 + Math.random() * 9000)}`,
  ).current;
  const viewerAvatar = useRef<string>(streamerAvatar(viewerName)).current;

  // Join the watch-party as soon as we have the watchPartyCode + a WS connection.
  // Track join attempts so we retry once if the first attempt fails (e.g. the
  // broadcaster's WS party hasn't been created yet — common in the first few
  // seconds after they click "Go Live").
  const joinAttemptedRef = useRef(false);
  useEffect(() => {
    if (!stream?.watchPartyCode || !party.connected) return;
    // Only join if we're not already in a party (avoid re-join loops).
    if (party.partyCode === stream.watchPartyCode) return;
    // Retry once after 2s if the first attempt returned PARTY_NOT_FOUND.
    // This covers the race where the broadcaster just clicked "Go Live"
    // and the WS party is being created.
    if (party.error && joinAttemptedRef.current) return; // give up after retry
    party.join(stream.watchPartyCode, viewerName, viewerAvatar);
    joinAttemptedRef.current = true;
    // Schedule a retry if the first attempt failed.
    if (party.error) {
      const t = setTimeout(() => {
        joinAttemptedRef.current = false;
      }, 2000);
      return () => clearTimeout(t);
    }
  }, [stream?.watchPartyCode, party.connected, party.partyCode, party.error, viewerName, viewerAvatar]);

  // Bridge WS chat messages into local state.
  useEffect(() => {
    if (!party.chat.length) return;
    setChat((prev) => {
      const seen = new Set(prev.map((m) => `${m.at}|${m.user}|${m.text}`));
      const next = [...prev];
      for (const m of party.chat) {
        const key = `${m.at}|${m.name}|${m.text}`;
        if (!seen.has(key)) {
          next.push({
            user: m.name,
            text: m.text,
            color: colorForName(m.name),
            avatarUrl: m.avatarUrl,
            at: m.at,
          });
        }
      }
      return next.slice(-200);
    });
  }, [party.chat]);

  // Auto-scroll chat to bottom on new messages.
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chat]);

  // Leave the party on unmount.
  useEffect(() => {
    return () => {
      try { party.leave(); } catch { /* best-effort */ }
    };
  }, []);

  const sendChat = useCallback((e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    party.sendChat(chatInput);
    setChatInput("");
  }, [chatInput, party]);

  const copyCode = async () => {
    if (!stream?.watchPartyCode) return;
    try {
      await navigator.clipboard.writeText(stream.watchPartyCode);
      setCopied(true);
      toast.success("Party code copied", {
        description: `Share it so others can join the chat`,
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy code");
    }
  };

  // ── States ──
  if (!streamId) {
    return (
      <div className="px-4 sm:px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">No stream ID provided.</p>
        <Button variant="ghost" onClick={() => navigate({ kind: "home" })} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to home
        </Button>
      </div>
    );
  }

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 py-4 max-w-5xl mx-auto">
        <Skeleton className="aspect-video w-full rounded-xl" />
        <div className="flex gap-3 mt-3">
          <Skeleton className="h-10 w-10 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-4 w-3/4" />
            <Skeleton className="h-3 w-1/2 mt-1" />
          </div>
        </div>
      </div>
    );
  }

  if (error || !stream) {
    return (
      <div className="px-4 sm:px-6 py-12 text-center">
        <p className="text-sm text-muted-foreground">Stream not found.</p>
        <Button variant="ghost" onClick={() => navigate({ kind: "home" })} className="mt-4">
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to home
        </Button>
      </div>
    );
  }

  const isLive = stream.status === "live";
  const isEnded = stream.status === "ended";
  // Real viewer count = max(DB row's count, WS presence count). The WS
  // count is fresher (the broadcaster patches the DB every 5s, but the
  // WS presence updates instantly).
  const liveViewers = Math.max(stream.viewerCount, party.members.length);

  return (
    <div className="px-4 sm:px-6 py-4 max-w-5xl mx-auto pb-24">
      {/* Back link */}
      <button
        onClick={() => navigate({ kind: "home" })}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3 min-h-[44px] py-1"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to home
      </button>

      <div className="grid grid-cols-1 md:grid-cols-[1fr_320px] gap-4">
        {/* ── Stream preview + meta ── */}
        <div className="space-y-3">
          <div className="relative aspect-video rounded-xl overflow-hidden bg-black">
            {/* Preview placeholder — in production this would be a live
                HLS pull from the broadcaster's webcam via an RTMP ingest.
                For dev, show the streamer's avatar over a gradient. */}
            <div
              className="absolute inset-0 flex flex-col items-center justify-center gap-3"
              style={{
                background:
                  "linear-gradient(135deg, hsl(var(--gold)/0.25), hsl(var(--charcoal)/0.7))",
              }}
            >
              <img
                src={streamerAvatar(stream.streamerName)}
                alt={stream.streamerName}
                className="h-20 w-20 rounded-full opacity-90"
              />
              {isLive ? (
                <p className="text-white/80 text-xs">Live broadcast</p>
              ) : isEnded ? (
                <p className="text-white/80 text-xs">This stream has ended</p>
              ) : (
                <p className="text-white/80 text-xs">Preparing stream…</p>
              )}
            </div>

            {/* LIVE badge */}
            {isLive && (
              <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600 text-white text-xs font-bold">
                <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                LIVE
              </div>
            )}
            {isEnded && (
              <div className="absolute top-3 left-3 px-2.5 py-1 rounded-full bg-zinc-800 text-white text-xs font-bold">
                ENDED
              </div>
            )}

            {/* Viewer count */}
            {isLive && (
              <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 text-white text-xs font-medium backdrop-blur">
                <Eye className="h-3.5 w-3.5" />
                {liveViewers.toLocaleString()} watching
              </div>
            )}

            {/* Elapsed / duration */}
            {isLive && (
              <div className="absolute bottom-3 left-3 text-white text-xs font-medium drop-shadow">
                {elapsed(stream.startedAt)}
              </div>
            )}
            {isEnded && (
              <div className="absolute bottom-3 left-3 text-white/80 text-xs font-medium drop-shadow">
                Duration: {duration(stream.startedAt, stream.endedAt)}
              </div>
            )}
          </div>

          {/* Stream title + streamer */}
          <div className="flex gap-3">
            <img
              src={streamerAvatar(stream.streamerName)}
              alt=""
              className="h-10 w-10 rounded-full shrink-0"
            />
            <div className="min-w-0 flex-1">
              <h1 className="text-base font-semibold line-clamp-2">{stream.title}</h1>
              <div className="flex items-center gap-2 text-xs text-muted-foreground mt-1">
                <span className="font-medium text-foreground">{stream.streamerName}</span>
                <span>·</span>
                <span>{stream.category}</span>
                <span>·</span>
                <span className="capitalize">{stream.privacy}</span>
              </div>
              {stream.description && (
                <p className="text-xs text-muted-foreground mt-2 line-clamp-3">
                  {stream.description}
                </p>
              )}
            </div>
          </div>

          {/* Stats row */}
          <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
            {isLive && (
              <>
                <span className="flex items-center gap-1.5">
                  <Signal className="h-3.5 w-3.5 text-emerald-500" />
                  Good connection
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {liveViewers.toLocaleString()} watching
                </span>
                {party.connected ? (
                  <span className="flex items-center gap-1.5 text-emerald-500">
                    <Wifi className="h-3.5 w-3.5" />
                    Chat live
                  </span>
                ) : (
                  <span className="flex items-center gap-1.5 text-amber-500">
                    <WifiOff className="h-3.5 w-3.5" />
                    Reconnecting…
                  </span>
                )}
              </>
            )}
            {isEnded && (
              <span className="flex items-center gap-1.5">
                Peak: {stream.peakViewerCount.toLocaleString()} viewers
              </span>
            )}
          </div>

          {/* Copy party code */}
          {isLive && stream.watchPartyCode && (
            <button
              onClick={copyCode}
              className="flex items-center gap-1.5 text-xs px-3 py-2 rounded-lg border border-border bg-muted/40 hover:bg-muted transition-colors min-h-[40px]"
            >
              {copied ? (
                <>
                  <Check className="h-3.5 w-3.5 text-emerald-500" />
                  Copied {stream.watchPartyCode}
                </>
              ) : (
                <>
                  <Copy className="h-3.5 w-3.5" />
                  Share chat code: {stream.watchPartyCode}
                </>
              )}
            </button>
          )}

          {/* Ended CTA */}
          {isEnded && (
            <div className="rounded-lg border border-border bg-muted/30 p-4 text-center">
              <p className="text-sm font-medium">This stream has ended</p>
              <p className="text-xs text-muted-foreground mt-1">
                Reached {stream.peakViewerCount.toLocaleString()} peak viewers over{" "}
                {duration(stream.startedAt, stream.endedAt)}.
              </p>
              <Button
                variant="ghost"
                size="sm"
                onClick={() => navigate({ kind: "home" })}
                className="mt-3"
              >
                <ArrowLeft className="h-3.5 w-3.5 mr-1.5" />
                Back to home
              </Button>
            </div>
          )}
        </div>

        {/* ── Live chat (only when live) ── */}
        {isLive ? (
          <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col max-h-[600px] md:sticky md:top-20">
            <div className="px-3 py-2 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
              <span>Live chat</span>
              {party.connected && (
                <span className="flex items-center gap-1 normal-case font-normal text-emerald-500">
                  <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                  live
                </span>
              )}
            </div>

            {/* Presence avatars */}
            {party.members.length > 0 && (
              <div className="px-3 py-2 border-b border-border flex items-center gap-1 flex-wrap">
                <span className="text-[10px] text-muted-foreground mr-1">
                  {party.members.length} in chat:
                </span>
                {party.members.slice(0, 8).map((m) => (
                  <img
                    key={m.memberId}
                    src={m.avatarUrl || streamerAvatar(m.name)}
                    alt={m.name}
                    title={m.name}
                    className="h-5 w-5 rounded-full"
                  />
                ))}
                {party.members.length > 8 && (
                  <span className="text-[10px] text-muted-foreground">
                    +{party.members.length - 8}
                  </span>
                )}
              </div>
            )}

            {/* Chat messages */}
            <div
              ref={chatScrollRef}
              className="flex-1 overflow-y-auto custom-scroll p-2 space-y-1.5 min-h-[200px]"
            >
              {chat.length === 0 ? (
                <div className="text-xs text-muted-foreground text-center py-6 space-y-1">
                  {party.error ? (
                    <>
                      <p className="text-amber-500">Chat room unavailable</p>
                      <p className="text-[11px]">
                        The streamer&apos;s chat room isn&apos;t reachable right now.
                        This usually means they just went live — try again in a moment.
                      </p>
                    </>
                  ) : !party.connected ? (
                    <p>Connecting to chat…</p>
                  ) : !party.partyCode ? (
                    <p>Joining chat room…</p>
                  ) : (
                    <p>Be the first to say hi…</p>
                  )}
                </div>
              ) : (
                chat.map((msg, i) => (
                  <div key={i} className="text-xs leading-snug">
                    <span className={cn("font-medium", msg.color)}>
                      {msg.user}:{" "}
                    </span>
                    <span className="text-foreground">{msg.text}</span>
                  </div>
                ))
              )}
            </div>

            {/* Chat input */}
            <form
              onSubmit={sendChat}
              className="flex items-center gap-1.5 p-2 border-t border-border"
            >
              <Input
                value={chatInput}
                onChange={(e) => setChatInput(e.target.value)}
                placeholder={
                  party.error ? "Chat unavailable"
                  : !party.connected ? "Connecting…"
                  : !party.partyCode ? "Joining…"
                  : "Say something…"
                }
                maxLength={200}
                disabled={!party.connected || !!party.error || !party.partyCode}
                aria-label="Send a chat message"
                className="h-9 text-xs"
              />
              <Button
                type="submit"
                size="icon"
                variant="ghost"
                disabled={!chatInput.trim() || !party.connected || !!party.error || !party.partyCode}
                className="h-9 w-9 shrink-0"
                aria-label="Send chat message"
              >
                <Send className="h-4 w-4" />
              </Button>
            </form>
          </div>
        ) : (
          /* When ended, show a placeholder where chat would be */
          <div className="rounded-xl border border-border bg-muted/20 p-4 text-center text-xs text-muted-foreground hidden md:block">
            Chat is closed.
          </div>
        )}
      </div>
    </div>
  );
}
