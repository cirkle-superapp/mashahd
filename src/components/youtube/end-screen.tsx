"use client";

import { useState, useEffect } from "react";
import { Play, X, ChevronRight, RotateCcw } from "lucide-react";
import type { Video } from "@/lib/types";
import { cn } from "@/lib/utils";

/**
 * EndScreen — a proper video-end overlay that shows on top of the player
 * when the video finishes. Displays:
 *   - A "Replay" button to restart the current video.
 *   - Up to 3 "Up next" video cards the viewer can click to continue.
 *   - A 10-second auto-advance countdown (cancelable).
 *
 * Replaces the simple toast notification with a richer, more engaging end
 * experience (competitive with YouTube's end screen).
 */
export function EndScreen({
  show,
  videos,
  onReplay,
  onPlayNext,
  onDismiss,
}: {
  show: boolean;
  videos: Video[];
  onReplay: () => void;
  onPlayNext: (videoId: string) => void;
  onDismiss: () => void;
}) {
  const [countdown, setCountdown] = useState(10);

  // When `show` becomes true, start a 10s countdown. We reset countdown
  // via the `key` prop on the parent (the EndScreen is keyed by `show` so
  // it remounts fresh each time the video ends). When countdown hits 0,
  // play the first up-next video.
  useEffect(() => {
    if (!show || videos.length === 0) return;
    const interval = setInterval(() => {
      setCountdown((c) => {
        if (c <= 1) {
          clearInterval(interval);
          onPlayNext(videos[0].id);
          return 0;
        }
        return c - 1;
      });
    }, 1000);
    return () => clearInterval(interval);
  }, [show, videos, onPlayNext]);

  if (!show) return null;

  const upNext = videos.slice(0, 3);

  return (
    <div className="absolute inset-0 z-30 bg-black/85 backdrop-blur-sm flex flex-col">
      {/* Close button */}
      <button
        onClick={onDismiss}
        className="absolute top-3 right-3 z-10 grid place-items-center h-9 w-9 rounded-full bg-white/10 hover:bg-white/20 text-white"
        aria-label="Dismiss end screen"
      >
        <X className="h-4 w-4" />
      </button>

      {/* Center — Replay button + countdown */}
      <div className="flex-1 flex flex-col items-center justify-center gap-4 px-4">
        <button
          onClick={onReplay}
          className="group flex flex-col items-center gap-2"
          aria-label="Replay video"
        >
          <span className="grid place-items-center h-16 w-16 rounded-full bg-white/10 group-hover:bg-white/20 border border-white/30 group-hover:scale-105 transition-all">
            <RotateCcw className="h-7 w-7 text-white" />
          </span>
          <span className="text-white text-sm font-medium">Replay</span>
        </button>

        {upNext.length > 0 && (
          <p className="text-white/70 text-xs">
            Next video in <span className="font-mono tabular-nums text-white font-bold">{countdown}s</span>
          </p>
        )}
      </div>

      {/* Bottom — Up next cards */}
      {upNext.length > 0 && (
        <div className="p-4 sm:p-6 space-y-3">
          <div className="flex items-center gap-2 text-white">
            <ChevronRight className="h-4 w-4" />
            <h3 className="text-sm font-semibold uppercase tracking-wide">Up next</h3>
          </div>
          <div className="grid grid-cols-1 sm:grid-cols-3 gap-3">
            {upNext.map((v, i) => (
              <button
                key={v.id}
                onClick={() => onPlayNext(v.id)}
                className={cn(
                  "group text-left rounded-lg overflow-hidden bg-white/5 hover:bg-white/15 border border-white/10 hover:border-white/30 transition-colors",
                  i === 0 && "sm:col-span-1 ring-1 ring-[hsl(var(--gold))]/40"
                )}
              >
                <div className="relative aspect-video bg-muted">
                  <img
                    src={v.thumbnailUrl}
                    alt=""
                    className="absolute inset-0 w-full h-full object-cover"
                  />
                  {i === 0 && (
                    <div className="absolute top-2 left-2 px-2 py-0.5 rounded-full bg-[hsl(var(--gold))] text-black text-[10px] font-bold uppercase tracking-wide">
                      Up next
                    </div>
                  )}
                  <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="grid place-items-center h-10 w-10 rounded-full bg-black/70">
                      <Play className="h-4 w-4 text-white fill-current ml-0.5" />
                    </span>
                  </div>
                </div>
                <div className="p-2">
                  <p className="text-xs font-medium text-white line-clamp-2">{v.title}</p>
                  <p className="text-[10px] text-white/60 mt-0.5">{v.channel?.name || ""}</p>
                </div>
              </button>
            ))}
          </div>
        </div>
      )}
    </div>
  );
}
