"use client";

import { useQuery } from "@tanstack/react-query";
import {
  Scissors,
  Play,
  ArrowLeft,
  Loader2,
  Eye,
  ExternalLink,
  User,
} from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAppStore } from "@/store/app-store";
import { MashahdPlayerLazy } from "./mashahd-player-lazy";
import { formatViews, timeAgo } from "@/lib/format";
import { useBrowserId } from "@/hooks/use-browser-id";

/* ────────────────────────────────────────────────────────────────────────
 * ClipView — standalone permalink page for a single clip.
 *
 * Fetches /api/clips/[id] via useQuery and shows the clip title, the video
 * it's from (with a "Watch full video" link), the clip range (start → end),
 * and the clip creator's name. Embeds MashahdPlayerLazy configured with
 * startAt/endAt so the player deep-links into the clip segment and stops
 * at its end — the underlying <video> behaves as if it were a short clip
 * even though the source is the full video file.
 *
 * This closes the "Clips [id] has no standalone permalink page" gap in the
 * FINAL-AUDIT-FIX-PASS-30 worklog (item #5 in "Remaining gaps").
 * ──────────────────────────────────────────────────────────────────────── */

type ClipDetail = {
  clip: {
    id: string;
    videoId: string;
    creatorId: string;
    creatorName: string;
    title: string;
    startSec: number;
    endSec: number;
    note: string;
    views: number;
    createdAt: string;
  };
  video: {
    id: string;
    title: string;
    videoUrl: string;
    thumbnailUrl: string;
    durationSec: number;
    views: number;
    createdAt: string;
    channelId: string;
    channel: { id: string; name: string; handle: string; avatarUrl: string; verified: boolean };
  } | null;
};

async function fetchClip(clipId: string): Promise<ClipDetail> {
  const r = await fetch(`/api/clips/${clipId}`);
  if (!r.ok) {
    const e = await r.json().catch(() => ({}));
    throw new Error((e as { error?: string }).error || "failed");
  }
  return r.json();
}

const fmt = (s: number): string => {
  if (!isFinite(s) || s < 0) s = 0;
  const total = Math.floor(s);
  const m = Math.floor(total / 60);
  const sec = total % 60;
  if (m >= 60) {
    const h = Math.floor(m / 60);
    return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
  }
  return `${m}:${String(sec).padStart(2, "0")}`;
};

export function ClipView({ clipId }: { clipId: string }) {
  const { navigate } = useAppStore();
  const bid = useBrowserId();
  // bid is currently unused in the fetch (the /api/clips/[id] endpoint is
  // public — it doesn't require a browserId). We still grab it so future
  // "report clip" / "save clip" actions have the signed id ready.
  void bid;

  const { data, isLoading, isError } = useQuery({
    queryKey: ["clip", clipId],
    queryFn: () => fetchClip(clipId),
    enabled: !!clipId,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
        <Skeleton className="h-5 w-32" />
        <Skeleton className="aspect-video w-full rounded-2xl" />
        <Skeleton className="h-7 w-2/3" />
        <Skeleton className="h-4 w-1/2" />
        <Skeleton className="h-4 w-1/3" />
      </div>
    );
  }

  if (isError || !data || !data.video) {
    return (
      <div className="p-6 sm:p-10 text-center max-w-md mx-auto">
        <Scissors className="h-12 w-12 mx-auto text-muted-foreground mb-3" />
        <p className="text-lg font-semibold">Clip not found</p>
        <p className="text-sm text-muted-foreground mt-1">
          This clip may have been deleted or the link is invalid.
        </p>
        <Button variant="outline" className="mt-4" onClick={() => navigate({ kind: "home" })}>
          <ArrowLeft className="h-4 w-4 mr-1.5" />
          Back home
        </Button>
      </div>
    );
  }

  const { clip, video } = data;
  const clipLen = Math.max(0, Math.floor(clip.endSec - clip.startSec));

  return (
    <div className="p-4 sm:p-6 max-w-5xl mx-auto space-y-4">
      <Button
        variant="ghost"
        size="sm"
        className="mb-1"
        onClick={() => navigate({ kind: "watch", videoId: video.id })}
      >
        <ArrowLeft className="h-4 w-4 mr-1.5" />
        Back to video
      </Button>

      {/* Player — deep-links into the clip segment via startAt/endAt. */}
      <MashahdPlayerLazy
        key={clip.id /* remount per clip so endFiredRef resets */}
        src={video.videoUrl}
        poster={video.thumbnailUrl}
        videoId={video.id}
        autoPlay
        startAt={clip.startSec}
        endAt={clip.endSec}
      />

      {/* Clip title + range */}
      <div className="space-y-1.5">
        <div className="flex items-center gap-2 text-xs text-muted-foreground">
          <span className="inline-flex items-center gap-1 px-2 py-0.5 rounded-full bg-rose/10 border border-rose/30 text-rose font-medium">
            <Scissors className="h-3 w-3" />
            Clip
          </span>
          <span className="font-mono tabular-nums">
            {fmt(clip.startSec)} → {fmt(clip.endSec)}
          </span>
          <span>·</span>
          <span>{clipLen}s</span>
        </div>
        <h1 className="text-lg sm:text-2xl font-bold leading-tight">{clip.title}</h1>
        {clip.note && (
          <p className="text-sm text-muted-foreground mt-1 whitespace-pre-wrap">{clip.note}</p>
        )}
      </div>

      {/* Creator + views */}
      <div className="flex items-center gap-3 text-sm">
        <Avatar className="h-9 w-9 rounded-full">
          <AvatarImage src="" alt="" />
          <AvatarFallback>
            <User className="h-4 w-4 text-muted-foreground" />
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <p className="font-medium truncate">{clip.creatorName || "Anonymous"}</p>
          <p className="text-xs text-muted-foreground inline-flex items-center gap-1">
            <Eye className="h-3 w-3" />
            {formatViews(clip.views)} view{clip.views === 1 ? "" : "s"}
            {clip.createdAt && (
              <>
                <span>·</span>
                <span>{timeAgo(clip.createdAt)}</span>
              </>
            )}
          </p>
        </div>
      </div>

      {/* Source video card — click through to the full watch view. */}
      <div className="rounded-xl border border-border bg-surface/60 overflow-hidden">
        <div className="px-4 py-3 border-b border-border">
          <p className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            From this video
          </p>
        </div>
        <button
          onClick={() => navigate({ kind: "watch", videoId: video.id })}
          className="w-full flex gap-3 p-3 hover:bg-accent/40 transition-colors text-left"
        >
          <div className="relative w-32 sm:w-40 aspect-video shrink-0 rounded-lg overflow-hidden bg-muted">
            <img
              src={video.thumbnailUrl}
              alt={video.title}
              className="absolute inset-0 w-full h-full object-cover"
            />
            <span className="absolute bottom-1 right-1 px-1.5 py-0.5 rounded bg-black/85 text-white text-[10px] font-medium tabular-nums">
              {fmt(video.durationSec)}
            </span>
          </div>
          <div className="flex-1 min-w-0">
            <h3 className="text-sm font-medium line-clamp-2">{video.title}</h3>
            <p className="mt-1 text-xs text-muted-foreground">
              {video.channel?.name ?? "Unknown channel"}
            </p>
            <p className="mt-0.5 text-xs text-muted-foreground">
              {formatViews(video.views)} views
              {video.createdAt && <> · {timeAgo(video.createdAt)}</>}
            </p>
            <span className="mt-2 inline-flex items-center gap-1 text-xs text-gold font-medium">
              <ExternalLink className="h-3 w-3" />
              Watch full video
            </span>
          </div>
        </button>
      </div>

      {/* Play clip again — re-mount the player by toggling a key. Cheap
          enough to just navigate to the same URL with a state push. */}
      <div className="flex flex-wrap gap-2">
        <Button
          variant="outline"
          onClick={() => {
            // Reload the clip view to restart playback from startAt.
            navigate({ kind: "clip", clipId: clip.id });
          }}
        >
          <Play className="h-4 w-4 mr-1.5 fill-current" />
          Replay clip
        </Button>
      </div>

      {isLoading && (
        <div className="flex items-center justify-center py-4 text-sm text-muted-foreground">
          <Loader2 className="h-4 w-4 animate-spin mr-2" />
          Loading clip…
        </div>
      )}
    </div>
  );
}
