"use client";

import { useQuery } from "@tanstack/react-query";
import { Radio, Users, Copy, Check } from "lucide-react";
import { useState } from "react";
import { Skeleton } from "@/components/ui/skeleton";
import { toast } from "sonner";
import { useAppStore } from "@/store/app-store";

interface LiveStream {
  id: string;
  title: string;
  description: string;
  category: string;
  privacy: string;
  status: string;
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

interface LiveStreamsResponse {
  streams: LiveStream[];
  count: number;
}

async function fetchLiveStreams(): Promise<LiveStreamsResponse> {
  const res = await fetch("/api/live-streams?status=live&limit=20");
  if (!res.ok) throw new Error("failed");
  return res.json();
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

/**
 * LiveNowShelf — shows currently-broadcasting live streams.
 *
 * Pulls from /api/live-streams?status=live (the LiveStream table in the
 * transactional DB). Each card shows: streamer name, title, live elapsed
 * time, real viewer count, and a "copy code" button so a viewer can join
 * the live chat over the watch-party WebSocket (port 3004).
 *
 * Hidden if no streams are live. Auto-refreshes every 15s.
 */
export function LiveNowShelf() {
  const { data, isLoading } = useQuery({
    queryKey: ["live-streams", "live"],
    queryFn: fetchLiveStreams,
    refetchInterval: 15_000, // refresh every 15s — live counts update fast
  });

  if (!isLoading && (!data?.streams || data.streams.length === 0)) return null;

  return (
    <section className="px-4 sm:px-6 pt-4 pb-2">
      <div className="flex items-center gap-2 mb-3">
        <span className="flex items-center justify-center h-7 w-7 rounded-full bg-red-600 text-white">
          <Radio className="h-3.5 w-3.5 fill-current" />
        </span>
        <h2 className="text-base font-semibold font-display">Live now</h2>
        <span className="text-xs text-muted-foreground">
          — broadcasting right now
        </span>
        {data?.count ? (
          <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-red-600/10 text-red-600">
            {data.count} live
          </span>
        ) : null}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 custom-scroll-x">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="shrink-0 w-72">
                <Skeleton className="aspect-video w-full rounded-xl" />
                <Skeleton className="h-3 w-3/4 mt-2" />
                <Skeleton className="h-2.5 w-1/2 mt-1" />
              </div>
            ))
          : data!.streams.map((s) => (
              <LiveStreamCard key={s.id} stream={s} />
            ))}
      </div>
    </section>
  );
}

function LiveStreamCard({ stream }: { stream: LiveStream }) {
  const { navigate } = useAppStore();
  const [copied, setCopied] = useState(false);
  const avatarUrl = `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(stream.streamerName)}&radius=50`;

  const copyCode = async (e: React.MouseEvent) => {
    // Stop propagation so the click doesn't also navigate to the stream.
    e.stopPropagation();
    try {
      await navigator.clipboard.writeText(stream.watchPartyCode);
      setCopied(true);
      toast.success("Party code copied", {
        description: `Join the chat with code ${stream.watchPartyCode}`,
      });
      setTimeout(() => setCopied(false), 2000);
    } catch {
      toast.error("Could not copy code");
    }
  };

  return (
    // Click anywhere on the card → navigate to the live stream view
    <button
      onClick={() => navigate({ kind: "live", streamId: stream.id })}
      className="shrink-0 w-72 group text-left"
      aria-label={`Watch ${stream.streamerName}'s live stream: ${stream.title}`}
    >
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-soft">
        {/* Webcam preview placeholder — the actual stream preview would be a
            live HLS pull from the broadcaster's webcam. For dev, show the
            streamer's avatar over a gradient + LIVE badge. */}
        <div
          className="absolute inset-0 flex items-center justify-center"
          style={{
            background:
              "linear-gradient(135deg, hsl(var(--gold)/0.2), hsl(var(--charcoal)/0.6))",
          }}
        >
          <img
            src={avatarUrl}
            alt={stream.streamerName}
            className="h-16 w-16 rounded-full opacity-90 transition-transform duration-300 group-hover:scale-110"
            loading="lazy"
          />
        </div>

        {/* LIVE badge */}
        <div className="absolute top-2 left-2 flex items-center gap-1.5 px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold">
          <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
          LIVE
        </div>

        {/* Viewer count */}
        <div className="absolute top-2 right-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/70 text-white text-[10px] font-medium backdrop-blur">
          <Users className="h-3 w-3" />
          {stream.viewerCount.toLocaleString()}
        </div>

        {/* Elapsed time */}
        <div className="absolute bottom-2 left-2 text-white text-[10px] font-medium drop-shadow">
          {elapsed(stream.startedAt)}
        </div>

        {/* Hover affordance */}
        <div className="absolute inset-0 bg-black/0 group-hover:bg-black/10 transition-colors" />
      </div>

      {/* Meta strip */}
      <div className="flex gap-2 mt-2">
        <img
          src={avatarUrl}
          alt=""
          className="h-8 w-8 rounded-full shrink-0"
          loading="lazy"
        />
        <div className="min-w-0 flex-1">
          <p className="text-xs font-medium line-clamp-1 group-hover:text-foreground text-muted-foreground transition-colors">
            {stream.title}
          </p>
          <p className="text-[11px] text-muted-foreground line-clamp-1">
            {stream.streamerName} · {stream.category}
          </p>
        </div>
      </div>

      {/* Copy party code button — separate from the card navigation */}
      {stream.watchPartyCode && (
        <span
          onClick={copyCode}
          role="button"
          tabIndex={0}
          onKeyDown={(e) => {
            if (e.key === "Enter" || e.key === " ") {
              e.preventDefault();
              copyCode(e as any);
            }
          }}
          className="mt-2 w-full flex items-center justify-center gap-1.5 text-[10px] font-medium px-2 py-1.5 rounded-md border border-border bg-muted/40 hover:bg-muted transition-colors min-h-[32px] cursor-pointer"
        >
          {copied ? (
            <>
              <Check className="h-3 w-3 text-emerald-500" />
              Copied {stream.watchPartyCode}
            </>
          ) : (
            <>
              <Copy className="h-3 w-3" />
              Copy code: {stream.watchPartyCode}
            </>
          )}
        </span>
      )}
    </button>
  );
}
