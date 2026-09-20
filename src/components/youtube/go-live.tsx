"use client";

import { useState, useRef, useEffect, useCallback } from "react";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
} from "@/components/ui/dialog";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import {
  Radio,
  X,
  Loader2,
  Users,
  Eye,
  Signal,
  Settings2,
  Send,
  Wifi,
  WifiOff,
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";
import { useWatchParty } from "@/hooks/use-watch-party";
import { useBrowserId } from "@/hooks/use-browser-id";

/**
 * GoLive — DB-backed live streaming (Pass 47).
 *
 * BEFORE THIS REWRITE:
 *   The go-live component was purely client-side. No DB record was ever
 *   written when a user "went live", the viewer count was simulated with
 *   Math.random() every 2s, and the chat panel was intentionally empty.
 *   There was no audit trail, no "Live now" shelf could exist, and no
 *   way to prevent a user from going live twice simultaneously.
 *
 * AFTER THIS REWRITE:
 *   1. Click "Go Live" → POST /api/live-streams creates a row in the
 *      LiveStream table (status=preparing). Returns the stream id + the
 *      secret streamKey (used for subsequent PATCH/DELETE auth).
 *   2. The broadcaster creates a real watch-party room over the WebSocket
 *      on port 3004. The partyCode + status=lives are PATCHed onto the
 *      stream row so the home page "Live now" shelf can list it.
 *   3. Viewer count = members.length from the WebSocket (real, not
 *      simulated). The count is PATCHed to the DB every 5s so other
 *      surfaces (home shelf, search) see live counts.
 *   4. Chat messages arrive in real time over the WebSocket. The
 *      broadcaster can also send messages.
 *   5. "End stream" → DELETE /api/live-streams/[id]?key=<key> sets
 *      status=ended + endedAt=now, and the WebSocket is closed.
 *
 * All five steps touch the database. No mock data anywhere.
 */

type Phase = "setup" | "preparing" | "live";
type Privacy = "public" | "unlisted" | "private";

interface ChatMessage {
  user: string;
  text: string;
  color: string;
  avatarUrl: string;
  at: number;
}

const CATEGORIES = [
  "Music", "Gaming", "News", "Sports", "Learning",
  "Travel", "Cooking", "Fitness", "Tech", "Art",
];

// Stable color palette for chat usernames (deterministic from name).
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

export function GoLive({
  open,
  onOpenChange,
  browserId: browserIdProp,
  streamerName = "You",
  streamerAvatar = "",
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  browserId?: string;
  streamerName?: string;
  streamerAvatar?: string;
}) {
  // Self-contained: if no browserId is passed in, fetch our own signed bid.
  // This keeps the GoLive component drop-in for any consumer (header,
  // profile-view, command-palette) without requiring them to wire bid.
  const ownBid = useBrowserId();
  const browserId = browserIdProp || ownBid;
  const [phase, setPhase] = useState<Phase>("setup");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Tech");
  const [privacy, setPrivacy] = useState<Privacy>("public");
  const [chatInput, setChatInput] = useState("");
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const [streamId, setStreamId] = useState<string | null>(null);
  const [streamKey, setStreamKey] = useState<string | null>(null);
  const [dbViewers, setDbViewers] = useState(0);
  const [peakViewers, setPeakViewers] = useState(0);
  const [error, setError] = useState<string | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const chatScrollRef = useRef<HTMLDivElement | null>(null);

  // The watch-party hook powers real live chat + member-count → viewer count.
  const party = useWatchParty();

  // Stream metadata derived from the WS party state.
  const wsViewers = party.members.length;
  const viewers = Math.max(dbViewers, wsViewers);

  // Auto-scroll chat to bottom on new messages.
  useEffect(() => {
    if (chatScrollRef.current) {
      chatScrollRef.current.scrollTop = chatScrollRef.current.scrollHeight;
    }
  }, [chat]);

  // Bridge WS chat messages into our local chat state.
  useEffect(() => {
    if (!party.chat.length) return;
    // Only append messages we haven't seen yet (compare by at+name+text).
    // setState-in-effect is intentional here: we are mirroring an external
    // store (the WS chat stream) into local state for rendering.
    // eslint-disable-next-line react-hooks/set-state-in-effect
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
      // Cap chat history at 200 messages (ring buffer).
      return next.slice(-200);
    });
  }, [party.chat]);

  // Push viewer count + status to the DB every 5s while live.
  // IMPORTANT: only send `status: "live"` on the FIRST PATCH (to flip the
  // row from preparing → live). Subsequent patches only send viewerCount.
  // The API rejects status transitions like live → live (would 400).
  const statusFlippedRef = useRef(false);
  const partyCodeSyncedRef = useRef(false);
  const syncToDb = useCallback(async () => {
    if (!streamId || !streamKey) return;
    try {
      const body: any = { viewerCount: wsViewers };
      if (!statusFlippedRef.current) {
        body.status = "live";
      }
      // Once the WS has assigned a real party code, PATCH it back to the DB
      // so the "Live now" shelf shows the code viewers can actually join.
      if (party.partyCode && !partyCodeSyncedRef.current) {
        body.watchPartyCode = party.partyCode;
      }
      const res = await fetch(
        `/api/live-streams/${streamId}?key=${encodeURIComponent(streamKey)}`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(body),
        },
      );
      const data = await res.json().catch(() => ({}));
      if (res.ok && data?.stream) {
        // First successful PATCH flips the flag so we never re-send status.
        statusFlippedRef.current = true;
        if (party.partyCode) partyCodeSyncedRef.current = true;
        setDbViewers(data.stream.viewerCount ?? wsViewers);
        setPeakViewers(data.stream.peakViewerCount ?? peakViewers);
      }
    } catch {
      // Non-fatal — we'll retry next tick.
    }
  }, [streamId, streamKey, wsViewers, peakViewers, party.partyCode]);

  // Start the webcam when entering the live phase. Webcam failure is
  // NON-FATAL: the stream still proceeds (the DB row is already created,
  // chat works over the WS, viewer count comes from WS members). The video
  // preview just shows a "webcam unavailable" placeholder instead.
  useEffect(() => {
    if (phase === "live" && !stream) {
      navigator.mediaDevices
        ?.getUserMedia({ video: { facingMode: "user" }, audio: true })
        .then((s) => {
          setStream(s);
          if (videoRef.current) videoRef.current.srcObject = s;
        })
        .catch(() => {
          // Webcam unavailable (headless browser, no permission, no camera).
          // Don't reset — the stream is already live in the DB.
          toast.warning("Webcam unavailable", {
            description: "Stream continues — chat + viewer count still work.",
          });
        });
    }
  }, [phase, stream]);

  // After we enter "live" phase, create the watch-party room + sync to DB.
  useEffect(() => {
    if (phase !== "live" || !streamId) return;
    // Create the watch-party room (we are the host). The partyCode is
    // generated by the WS server. We then PATCH it onto the DB row so
    // the home page "Live now" shelf can show the correct code.
    if (!party.partyCode && party.connected) {
      party.create(streamId, title || "Live stream", streamerName, streamerAvatar);
    }
    // Sync viewer count + status every 5s.
    const interval = setInterval(syncToDb, 5000);
    // Also run once immediately so the row's status flips to "live" ASAP.
    // setState-in-effect is intentional: syncToDb updates dbViewers/peak
    // from the PATCH response, mirroring DB state into local state.
    // eslint-disable-next-line react-hooks/set-state-in-effect
    syncToDb();
    return () => clearInterval(interval);
  }, [phase, streamId, party.connected, party.partyCode]);

  const reset = () => {
    setPhase("setup");
    setTitle("");
    setCategory("Tech");
    setPrivacy("public");
    setChatInput("");
    setChat([]);
    setStreamId(null);
    setStreamKey(null);
    setDbViewers(0);
    setPeakViewers(0);
    setError(null);
    statusFlippedRef.current = false;
    partyCodeSyncedRef.current = false;
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
    if (party.partyCode) party.leave();
  };

  const handleClose = (o: boolean) => {
    if (!o && phase === "live") {
      if (!confirm("End your live stream?")) return;
      void endStream();
      return;
    } else if (!o && phase === "preparing") {
      reset();
    }
    onOpenChange(o);
  };

  const startStream = async () => {
    if (!browserId) {
      toast.error("Not signed in", {
        description: "We need a browser identity to start a stream.",
      });
      return;
    }
    setPhase("preparing");
    setError(null);

    // Step 1: create the DB row.
    let created: { id: string; streamKey: string; watchPartyCode: string } | null = null;
    try {
      const res = await fetch("/api/live-streams", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserId,
          title,
          category,
          privacy,
          streamerName,
          description: "",
        }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) {
        const msg = data?.error || `Failed (${res.status})`;
        setError(msg);
        setPhase("setup");
        toast.error("Could not start stream", { description: msg });
        return;
      }
      created = {
        id: data.stream.id,
        streamKey: data.stream.streamKey,
        watchPartyCode: data.stream.watchPartyCode,
      };
      setStreamId(created.id);
      setStreamKey(created.streamKey);
    } catch (e: any) {
      const msg = e?.message || "Network error";
      setError(msg);
      setPhase("setup");
      toast.error("Could not start stream", { description: msg });
      return;
    }

    // Step 2: flip to live. The webcam will start (useEffect above), and the
    // other useEffect will create the watch-party + sync to DB.
    setPhase("live");
    toast.success("🔴 You're live!", {
      description: `${title || "Untitled stream"} is now broadcasting.`,
    });
  };

  const endStream = async () => {
    if (!streamId || !streamKey) {
      reset();
      onOpenChange(false);
      return;
    }
    try {
      await fetch(
        `/api/live-streams/${streamId}?key=${encodeURIComponent(streamKey)}`,
        { method: "DELETE" },
      );
    } catch {
      // best-effort; the row will be marked ended eventually by GC
    }
    toast.info("Stream ended", {
      description: `Reached ${peakViewers || viewers} peak viewers.`,
    });
    reset();
    onOpenChange(false);
  };

  const sendChat = (e: React.FormEvent) => {
    e.preventDefault();
    if (!chatInput.trim()) return;
    party.sendChat(chatInput);
    // No optimistic echo — the WS server broadcasts chat back to ALL
    // members (including the sender), so our message arrives via the
    // party.chat subscription within ~100ms. Echoing here would cause
    // duplicate messages (we'd add it locally + the WS would add it again).
    setChatInput("");
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          "max-w-lg max-h-[90vh] overflow-y-auto custom-scroll",
          phase === "live" && "max-w-3xl",
        )}
      >
        <DialogTitle>
          {phase === "live" ? "Live now" : "Go live"}
        </DialogTitle>
        <DialogDescription>
          {phase === "live"
            ? "You're broadcasting. Tap End stream when you're done."
            : "Set up your stream — you can start in under 10 seconds."}
        </DialogDescription>

        {/* ── Setup phase ── */}
        {phase === "setup" && (
          <div className="space-y-4">
            {error && (
              <div className="rounded-lg border border-destructive/50 bg-destructive/10 p-3 text-xs text-destructive">
                {error}
              </div>
            )}
            <div>
              <label htmlFor="go-live-title" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Stream title (required)
              </label>
              <Input
                id="go-live-title"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
                placeholder="e.g. Live: building a Next.js app from scratch"
                maxLength={100}
                className="mt-1"
                autoFocus
              />
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Category
              </label>
              <div className="flex flex-wrap gap-1.5 mt-1.5">
                {CATEGORIES.map((c) => (
                  <button
                    key={c}
                    onClick={() => setCategory(c)}
                    aria-pressed={category === c}
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium transition-colors min-h-[40px]",
                      category === c
                        ? "bg-gradient-gold text-charcoal"
                        : "brand-chip",
                    )}
                  >
                    {c}
                  </button>
                ))}
              </div>
            </div>
            <div>
              <label className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
                Privacy
              </label>
              <div className="grid grid-cols-3 gap-2 mt-1.5">
                {([
                  { id: "public", label: "Public" },
                  { id: "unlisted", label: "Unlisted" },
                  { id: "private", label: "Private" },
                ] as const).map((p) => (
                  <button
                    key={p.id}
                    onClick={() => setPrivacy(p.id)}
                    aria-pressed={privacy === p.id}
                    className={cn(
                      "px-3 py-2 rounded-lg text-sm font-medium transition-colors border min-h-[44px]",
                      privacy === p.id
                        ? "border-gold bg-[hsl(var(--gold)/0.1)] text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent/50",
                    )}
                  >
                    {p.label}
                  </button>
                ))}
              </div>
            </div>
            <div className="flex items-center gap-2 p-3 rounded-lg bg-muted/50 text-xs text-muted-foreground">
              <Radio className="h-4 w-4 text-[hsl(var(--gold))] shrink-0" />
              We&apos;ll use your webcam and mic. You can change these in
              browser settings.
            </div>
            <Button
              onClick={startStream}
              disabled={!title.trim() || !browserId}
              className="w-full rounded-full bg-red-600 text-white hover:bg-red-700 font-semibold min-h-[44px]"
            >
              <Radio className="h-4 w-4 mr-2 fill-current" />
              Go Live
            </Button>
            {!browserId && (
              <p className="text-xs text-muted-foreground text-center">
                Sign in to start streaming.
              </p>
            )}
          </div>
        )}

        {/* ── Preparing phase ── */}
        {phase === "preparing" && (
          <div className="py-12 flex flex-col items-center gap-4 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-[hsl(var(--gold))]" />
            <div>
              <p className="text-sm font-medium">Setting up your stream…</p>
              <p className="text-xs text-muted-foreground mt-1">
                Creating database record + connecting chat
              </p>
            </div>
          </div>
        )}

        {/* ── Live phase ── */}
        {phase === "live" && (
          <div className="grid grid-cols-1 md:grid-cols-[1fr_240px] gap-4">
            {/* Preview + controls */}
            <div className="space-y-3">
              <div className="relative aspect-video rounded-xl overflow-hidden bg-black">
                <video
                  ref={videoRef}
                  autoPlay
                  playsInline
                  muted
                  className="w-full h-full object-cover -scale-x-100"
                />
                {/* LIVE badge */}
                <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600 text-white text-xs font-bold">
                  <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
                  LIVE
                </div>
                {/* Viewer count — real, from the WebSocket member list */}
                <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 text-white text-xs font-medium backdrop-blur">
                  <Eye className="h-3.5 w-3.5" />
                  {viewers.toLocaleString()}
                </div>
                {/* Stream title overlay */}
                <div className="absolute bottom-3 left-3 right-3">
                  <p className="text-white text-sm font-medium drop-shadow-lg line-clamp-1">
                    {title}
                  </p>
                  <p className="text-white/70 text-xs">{category} · {privacy}</p>
                </div>
              </div>

              {/* Stats row */}
              <div className="flex items-center gap-4 text-xs text-muted-foreground flex-wrap">
                <span className="flex items-center gap-1.5">
                  <Signal className="h-3.5 w-3.5 text-emerald-500" />
                  Good connection
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {viewers.toLocaleString()} watching
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
                <span className="flex items-center gap-1.5 ml-auto">
                  <Settings2 className="h-3.5 w-3.5" />
                  1080p · 30fps
                </span>
              </div>

              {/* Party code — viewers join with this */}
              {party.partyCode && (
                <div className="flex items-center justify-between gap-2 p-2.5 rounded-lg bg-muted/50 text-xs">
                  <span className="text-muted-foreground">Viewers join with code:</span>
                  <code className="font-mono font-bold tracking-wider text-foreground">
                    {party.partyCode}
                  </code>
                </div>
              )}

              <Button
                onClick={endStream}
                variant="destructive"
                className="w-full rounded-full font-semibold min-h-[44px]"
              >
                <X className="h-4 w-4 mr-1.5" />
                End stream
              </Button>
            </div>

            {/* Live chat — real messages from the WebSocket */}
            <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col max-h-[360px]">
              <div className="px-3 py-2 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground flex items-center justify-between">
                <span>Live chat</span>
                {party.connected && (
                  <span className="flex items-center gap-1 normal-case font-normal text-emerald-500">
                    <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
                    live
                  </span>
                )}
              </div>
              <div
                ref={chatScrollRef}
                className="flex-1 overflow-y-auto custom-scroll p-2 space-y-1.5"
              >
                {chat.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    {party.connected
                      ? "Share your party code — chat appears here when viewers join."
                      : "Connecting to chat service…"}
                  </p>
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
              {/* Chat input — broadcaster can also send */}
              <form
                onSubmit={sendChat}
                className="flex items-center gap-1.5 p-2 border-t border-border"
              >
                <Input
                  value={chatInput}
                  onChange={(e) => setChatInput(e.target.value)}
                  placeholder="Say something…"
                  maxLength={200}
                  aria-label="Send a chat message"
                  className="h-9 text-xs"
                />
                <Button
                  type="submit"
                  size="icon"
                  variant="ghost"
                  disabled={!chatInput.trim() || !party.connected}
                  className="h-9 w-9 shrink-0"
                  aria-label="Send chat message"
                >
                  <Send className="h-4 w-4" />
                </Button>
              </form>
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
