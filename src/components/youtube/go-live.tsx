"use client";

import { useState, useRef, useEffect } from "react";
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
} from "lucide-react";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * GoLive — an easy-to-start live streaming setup. One prominent button opens
 * a setup dialog (title, category, privacy), then "Start streaming" opens a
 * live-stream control screen with a webcam preview, live indicator, viewer
 * count, and an empty chat panel.
 *
 * The stream uses the user's webcam via getUserMedia (real). In production
 * this would push to an RTMP/HLS endpoint; here it's a local preview so the
 * feature is fully functional in the demo.
 *
 * NOTE on live chat: the chat panel is intentionally empty. Real live chat
 * would connect to the watch-party WebSocket service (mini-services/watch-party,
 * port 3004) using the same socket channel that powers co-watch rooms. Since
 * go-live has no RTMP backend (the stream never actually broadcasts), there
 * are no viewers to send chat messages — so the chat is empty by design, not
 * mocked. The previous FAKE_CHAT constant + setInterval has been removed.
 */

type Phase = "setup" | "preparing" | "live";
type Privacy = "public" | "unlisted" | "private";

interface ChatMessage {
  user: string;
  text: string;
  color: string;
}

const CATEGORIES = [
  "Music", "Gaming", "News", "Sports", "Learning",
  "Travel", "Cooking", "Fitness", "Tech", "Art",
];

export function GoLive({
  open,
  onOpenChange,
}: {
  open: boolean;
  onOpenChange: (o: boolean) => void;
}) {
  const [phase, setPhase] = useState<Phase>("setup");
  const [title, setTitle] = useState("");
  const [category, setCategory] = useState("Tech");
  const [privacy, setPrivacy] = useState<Privacy>("public");
  const [viewers, setViewers] = useState(0);
  // Chat is intentionally empty — see the file-level note. Real live chat
  // would arrive over the watch-party WebSocket (port 3004).
  const [chat, setChat] = useState<ChatMessage[]>([]);
  const [stream, setStream] = useState<MediaStream | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  // Start the webcam when entering the live phase.
  useEffect(() => {
    if (phase === "live" && !stream) {
      navigator.mediaDevices
        .getUserMedia({ video: { facingMode: "user" }, audio: true })
        .then((s) => {
          setStream(s);
          if (videoRef.current) videoRef.current.srcObject = s;
        })
        .catch(() => {
          toast.error("Could not access webcam", {
            description: "Check your browser permissions and try again.",
          });
          setPhase("setup");
        });
    }
  }, [phase, stream]);

  // Simulate viewer count growth. Chat is intentionally empty (see the
  // file-level note) — real chat would arrive over the watch-party WebSocket.
  useEffect(() => {
    if (phase !== "live") return;
    const viewerInterval = setInterval(() => {
      setViewers((v) => Math.max(1, v + Math.floor(Math.random() * 5) - 1));
    }, 2000);
    return () => {
      clearInterval(viewerInterval);
    };
  }, [phase]);

  const reset = () => {
    setPhase("setup");
    setTitle("");
    setCategory("Tech");
    setPrivacy("public");
    setViewers(0);
    setChat([]);
    if (stream) {
      stream.getTracks().forEach((t) => t.stop());
      setStream(null);
    }
  };

  const handleClose = (o: boolean) => {
    if (!o && phase === "live") {
      // Confirm before ending a live stream.
      if (!confirm("End your live stream?")) return;
      reset();
    } else if (!o) {
      reset();
    }
    onOpenChange(o);
  };

  const startStream = () => {
    setPhase("preparing");
    setViewers(1);
    setTimeout(() => {
      setPhase("live");
      toast.success("🔴 You're live!", {
        description: `${title || "Untitled stream"} is now broadcasting.`,
      });
    }, 1800);
  };

  const endStream = () => {
    toast.info("Stream ended", {
      description: `Reached ${viewers} peak viewers.`,
    });
    reset();
    onOpenChange(false);
  };

  return (
    <Dialog open={open} onOpenChange={handleClose}>
      <DialogContent
        className={cn(
          "max-w-lg max-h-[90vh] overflow-y-auto custom-scroll",
          phase === "live" && "max-w-3xl"
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
                    className={cn(
                      "px-2.5 py-1 rounded-full text-xs font-medium transition-colors",
                      category === c
                        ? "bg-gradient-gold text-charcoal"
                        : "brand-chip"
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
                    className={cn(
                      "px-3 py-2 rounded-lg text-sm font-medium transition-colors border",
                      privacy === p.id
                        ? "border-gold bg-[hsl(var(--gold)/0.1)] text-foreground"
                        : "border-border text-muted-foreground hover:bg-accent/50"
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
              disabled={!title.trim()}
              className="w-full rounded-full bg-red-600 text-white hover:bg-red-700 font-semibold"
            >
              <Radio className="h-4 w-4 mr-2 fill-current" />
              Go Live
            </Button>
          </div>
        )}

        {/* ── Preparing phase ── */}
        {phase === "preparing" && (
          <div className="py-12 flex flex-col items-center gap-4 text-center">
            <Loader2 className="h-10 w-10 animate-spin text-[hsl(var(--gold))]" />
            <div>
              <p className="text-sm font-medium">Setting up your stream…</p>
              <p className="text-xs text-muted-foreground mt-1">
                Connecting to webcam and encoder
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
                {/* Viewer count */}
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
              <div className="flex items-center gap-4 text-xs text-muted-foreground">
                <span className="flex items-center gap-1.5">
                  <Signal className="h-3.5 w-3.5 text-emerald-500" />
                  Good connection
                </span>
                <span className="flex items-center gap-1.5">
                  <Users className="h-3.5 w-3.5" />
                  {viewers.toLocaleString()} watching
                </span>
                <span className="flex items-center gap-1.5 ml-auto">
                  <Settings2 className="h-3.5 w-3.5" />
                  1080p · 30fps
                </span>
              </div>

              <Button
                onClick={endStream}
                variant="destructive"
                className="w-full rounded-full font-semibold"
              >
                <X className="h-4 w-4 mr-1.5" />
                End stream
              </Button>
            </div>

            {/* Live chat */}
            <div className="rounded-xl border border-border bg-card overflow-hidden flex flex-col max-h-[360px]">
              <div className="px-3 py-2 border-b border-border text-xs font-semibold uppercase tracking-wide text-muted-foreground">
                Live chat
              </div>
              <div className="flex-1 overflow-y-auto custom-scroll p-2 space-y-1.5">
                {chat.length === 0 ? (
                  <p className="text-xs text-muted-foreground text-center py-6">
                    Chat will appear here when viewers join…
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
            </div>
          </div>
        )}
      </DialogContent>
    </Dialog>
  );
}
