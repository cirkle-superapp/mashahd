"use client";

import { useState, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { ChevronUp, ChevronDown, Pause, Play, Heart, MessageSquare, Share2, Music2 } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { cn } from "@/lib/utils";
import { useAppStore } from "@/store/app-store";
import { useBrowserId } from "@/hooks/use-browser-id";
import { formatViews } from "@/lib/format";
import { toast } from "sonner";
import type { Video } from "@/lib/types";

/**
 * ShortsFeedView — a TikTok-style vertical-swipe Shorts feed (§16).
 *
 * Shows short videos (durationSec < 120) in a full-screen vertical player
 * with swipe navigation (up/down). Each short has:
 *   - Full-screen video (object-cover)
 *   - Creator avatar + name + caption overlay
 *   - Right-side action rail (like, comment, share, music)
 *   - Swipe up/down to navigate between shorts
 *
 * Per spec §16: "Create distinct experiences for: Videos, Shorts, Live..."
 * Per spec §63: "Intentional discovery" — shorts are a distinct format.
 */

async function fetchShorts(): Promise<Video[]> {
  const res = await fetch("/api/videos?sort=popular&limit=20");
  if (!res.ok) throw new Error("failed");
  const data = await res.json();
  // Filter to only short videos (under 2 minutes).
  return (data.videos as Video[]).filter((v) => v.durationSec < 120);
}

export function ShortsFeedView() {
  const { navigate } = useAppStore();
  const bid = useBrowserId();
  const [index, setIndex] = useState(0);
  const [paused, setPaused] = useState(false);
  const [liked, setLiked] = useState<Set<string>>(new Set());
  const videoRefs = useRef<(HTMLVideoElement | null)[]>([]);
  const containerRef = useRef<HTMLDivElement>(null);
  const touchStartY = useRef(0);

  const { data: shorts, isLoading, isError } = useQuery({
    queryKey: ["videos", "shorts"],
    queryFn: fetchShorts,
  });

  // Handle keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "ArrowDown" || e.key === "ArrowUp") {
        e.preventDefault();
        if (!shorts) return;
        if (e.key === "ArrowDown" && index < shorts.length - 1) {
          setIndex((i) => i + 1);
        } else if (e.key === "ArrowUp" && index > 0) {
          setIndex((i) => i - 1);
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [index, shorts]);

  // Play the current video, pause others.
  useEffect(() => {
    videoRefs.current.forEach((v, i) => {
      if (!v) return;
      if (i === index && !paused) {
        v.play().catch(() => {});
      } else {
        v.pause();
      }
    });
  }, [index, paused, shorts]);

  // Touch swipe handling.
  const onTouchStart = (e: React.TouchEvent) => {
    touchStartY.current = e.touches[0].clientY;
  };
  const onTouchEnd = (e: React.TouchEvent) => {
    if (!shorts) return;
    const delta = touchStartY.current - e.changedTouches[0].clientY;
    if (Math.abs(delta) > 50) {
      if (delta > 0 && index < shorts.length - 1) {
        setIndex((i) => i + 1);
      } else if (delta < 0 && index > 0) {
        setIndex((i) => i - 1);
      }
    }
  };

  const toggleLike = async (videoId: string) => {
    const next = new Set(liked);
    if (next.has(videoId)) {
      next.delete(videoId);
    } else {
      next.add(videoId);
      toast.success("Liked!");
    }
    setLiked(next);
    try {
      await fetch(`/api/videos/${videoId}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, action: next.has(videoId) ? "like" : "unlike" }),
      });
    } catch { /* non-critical */ }
  };

  if (isLoading) {
    return (
      <div className="flex items-center justify-center h-[calc(100vh-80px)] bg-black">
        <div className="animate-pulse text-muted-foreground">Loading shorts…</div>
      </div>
    );
  }

  if (isError) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-80px)] gap-4 bg-black">
        <p className="text-lg font-medium text-white/80">Couldn&apos;t load shorts</p>
        <p className="text-sm text-muted-foreground">
          Check your connection and try again.
        </p>
        <button
          onClick={() => navigate({ kind: "home" })}
          className="text-sm text-[hsl(var(--gold))] hover:underline"
        >
          Back to home
        </button>
      </div>
    );
  }

  if (!shorts || shorts.length === 0) {
    return (
      <div className="flex flex-col items-center justify-center h-[calc(100vh-80px)] gap-4 bg-black">
        <p className="text-lg font-medium text-white/80">No shorts available</p>
        <button
          onClick={() => navigate({ kind: "home" })}
          className="text-sm text-[hsl(var(--gold))] hover:underline"
        >
          Back to home
        </button>
      </div>
    );
  }

  return (
    <div
      ref={containerRef}
      className="relative h-[calc(100vh-80px)] overflow-hidden bg-black snap-y snap-mandatory"
      onTouchStart={onTouchStart}
      onTouchEnd={onTouchEnd}
    >
      {shorts.map((video, i) => (
        <div
          key={video.id}
          className={cn(
            "absolute inset-0 flex items-center justify-center transition-transform duration-300",
            i === index ? "translate-y-0" : i < index ? "-translate-y-full" : "translate-y-full"
          )}
        >
          <video
            ref={(el) => { videoRefs.current[i] = el; }}
            src={video.videoUrl}
            poster={video.thumbnailUrl}
            loop
            playsInline
            muted={false}
            className="h-full w-full object-cover"
            onClick={() => setPaused((p) => !p)}
          />

          {/* Gradient overlay for text legibility */}
          <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-black/30 pointer-events-none" />

          {/* Pause indicator */}
          {paused && i === index && (
            <div className="absolute inset-0 flex items-center justify-center pointer-events-none">
              <div className="grid place-items-center h-16 w-16 rounded-full bg-black/50 backdrop-blur">
                <Play className="h-8 w-8 text-white fill-current ml-1" />
              </div>
            </div>
          )}

          {/* Bottom-left: creator + caption */}
          <div className="absolute bottom-4 left-4 right-20 space-y-2">
            <div className="flex items-center gap-2">
              <button
                onClick={(e) => { e.stopPropagation(); navigate({ kind: "channel", channelId: video.channelId }); }}
                className="flex items-center gap-2"
              >
                <Avatar className="h-8 w-8 rounded-full border border-white/20">
                  <AvatarImage src={video.channel.avatarUrl} alt="" />
                  <AvatarFallback className="text-xs">{video.channel.name.slice(0, 1)}</AvatarFallback>
                </Avatar>
                <span className="text-sm font-medium text-white">{video.channel.name}</span>
              </button>
            </div>
            <p className="text-sm text-white/90 line-clamp-2">{video.title}</p>
            <div className="flex items-center gap-1.5 text-xs text-white/70">
              <Music2 className="h-3 w-3" />
              <span className="truncate">Original audio • {formatViews(video.views)} views</span>
            </div>
          </div>

          {/* Right-side action rail */}
          <div className="absolute right-3 bottom-4 flex flex-col items-center gap-4">
            <button
              onClick={(e) => { e.stopPropagation(); toggleLike(video.id); }}
              className="flex flex-col items-center gap-1"
              aria-label={liked.has(video.id) ? "Unlike" : "Like"}
            >
              <div className={cn(
                "grid place-items-center h-12 w-12 rounded-full backdrop-blur transition-colors",
                liked.has(video.id) ? "bg-rose text-white" : "bg-white/10 text-white hover:bg-white/20"
              )}>
                <Heart className={cn("h-6 w-6", liked.has(video.id) && "fill-current")} />
              </div>
              <span className="text-xs text-white/80">{formatViews(video.likes + (liked.has(video.id) ? 1 : 0))}</span>
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); navigate({ kind: "watch", videoId: video.id }); }}
              className="flex flex-col items-center gap-1"
              aria-label="Comments"
            >
              <div className="grid place-items-center h-12 w-12 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur transition-colors">
                <MessageSquare className="h-6 w-6" />
              </div>
              <span className="text-xs text-white/80">Comments</span>
            </button>

            <button
              onClick={(e) => { e.stopPropagation(); navigate({ kind: "watch", videoId: video.id }); }}
              className="flex flex-col items-center gap-1"
              aria-label="Share"
            >
              <div className="grid place-items-center h-12 w-12 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur transition-colors">
                <Share2 className="h-6 w-6" />
              </div>
              <span className="text-xs text-white/80">Share</span>
            </button>
          </div>

          {/* Navigation arrows (desktop) */}
          {i === index && (
            <>
              {index > 0 && (
                <button
                  onClick={() => setIndex((i) => i - 1)}
                  className="absolute top-4 left-1/2 -translate-x-1/2 grid place-items-center h-10 w-10 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur transition-colors"
                  aria-label="Previous short"
                >
                  <ChevronUp className="h-5 w-5" />
                </button>
              )}
              {index < shorts.length - 1 && (
                <button
                  onClick={() => setIndex((i) => i + 1)}
                  className="absolute bottom-4 left-1/2 -translate-x-1/2 grid place-items-center h-10 w-10 rounded-full bg-white/10 text-white hover:bg-white/20 backdrop-blur transition-colors"
                  aria-label="Next short"
                >
                  <ChevronDown className="h-5 w-5" />
                </button>
              )}
            </>
          )}
        </div>
      ))}

      {/* Progress indicator */}
      <div className="absolute top-2 right-2 flex flex-col gap-1">
        {shorts.map((_, i) => (
          <div
            key={i}
            className={cn(
              "w-1 rounded-full transition-all",
              i === index ? "h-6 bg-[hsl(var(--gold))]" : "h-2 bg-white/30"
            )}
          />
        ))}
      </div>
    </div>
  );
}
