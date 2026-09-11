"use client";

import { useEffect, useRef, useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { X, Play, Pause, Volume2, VolumeX, ChevronUp } from "lucide-react";
import { useMiniPlayer } from "@/store/mini-player-store";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

/**
 * MiniPlayer — a floating picture-in-picture-style player that keeps a video
 * playing in the bottom-right corner when the user navigates away from the
 * watch page. Clicking it returns to the full watch page (resuming from the
 * mini-player's currentTime).
 *
 * The watch page populates the mini-player store on unmount with the current
 * video + playback position; this component renders when a video is set AND
 * the current view isn't the watch page for that same video.
 */
export function MiniPlayer() {
  const mini = useMiniPlayer();
  const { view, navigate } = useAppStore();
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const [muted, setMuted] = useState(false);
  const [playing, setPlaying] = useState(true);

  // Should the mini-player show? Only when there's a video and we're not
  // already on that video's watch page.
  const shouldShow =
    mini.videoId &&
    !(view.kind === "watch" && view.videoId === mini.videoId);

  // Resume from saved position when the mini-player mounts.
  useEffect(() => {
    if (shouldShow && videoRef.current && mini.currentTime > 0) {
      videoRef.current.currentTime = mini.currentTime;
      videoRef.current.play().catch(() => setPlaying(false));
    }
  }, [shouldShow, mini.currentTime]);

  // Track playback position so returning to the full watch page resumes here.
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !shouldShow) return;
    const onTime = () => mini.updateCurrentTime(v.currentTime);
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [shouldShow, mini]);

  const expand = () => {
    if (mini.videoId) {
      // The watch page will pick up currentTime from the store on mount.
      navigate({ kind: "watch", videoId: mini.videoId });
    }
  };

  const close = () => {
    // Stop playback and clear the store.
    if (videoRef.current) videoRef.current.pause();
    mini.close();
  };

  return (
    <AnimatePresence>
      {shouldShow && (
        <motion.div
          initial={{ opacity: 0, y: 40, scale: 0.9 }}
          animate={{ opacity: 1, y: 0, scale: 1 }}
          exit={{ opacity: 0, y: 40, scale: 0.9 }}
          transition={{ duration: 0.3, ease: [0.16, 1, 0.3, 1] }}
          className="fixed bottom-4 right-4 z-40 w-72 sm:w-80 glass-strong rounded-xl shadow-float border border-gold/20 overflow-hidden"
        >
          {/* Video element */}
          <div className="relative aspect-video bg-black">
            <video
              ref={videoRef}
              src={mini.videoUrl || undefined}
              poster={mini.thumbnailUrl || undefined}
              className="w-full h-full"
              autoPlay
              muted={muted}
              playsInline
              onClick={() => setPlaying((p) => {
                const v = videoRef.current;
                if (!v) return !p;
                if (p) v.pause();
                else v.play().catch(() => {});
                return !p;
              })}
            />
            {/* Expand-to-full overlay button */}
            <button
              onClick={expand}
              className="absolute top-1.5 right-1.5 grid place-items-center h-7 w-7 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur"
              aria-label="Expand to full player"
              title="Back to watch page"
            >
              <ChevronUp className="h-4 w-4" />
            </button>
            <button
              onClick={close}
              className="absolute top-1.5 left-1.5 grid place-items-center h-7 w-7 rounded-full bg-black/60 hover:bg-black/80 text-white backdrop-blur"
              aria-label="Close mini player"
              title="Close"
            >
              <X className="h-4 w-4" />
            </button>
          </div>

          {/* Meta + controls */}
          <div className="px-3 py-2">
            <p className="text-xs font-medium line-clamp-1">{mini.videoTitle}</p>
            <p className="text-[11px] text-muted-foreground line-clamp-1 mt-0.5">
              {mini.channelName}
            </p>
            <div className="flex items-center justify-between mt-2">
              <button
                onClick={() => setPlaying((p) => {
                  const v = videoRef.current;
                  if (!v) return !p;
                  if (p) v.pause();
                  else v.play().catch(() => {});
                  return !p;
                })}
                className="grid place-items-center h-7 w-7 rounded-full hover:bg-accent text-foreground"
                aria-label={playing ? "Pause" : "Play"}
              >
                {playing ? <Pause className="h-4 w-4" /> : <Play className="h-4 w-4" />}
              </button>
              <button
                onClick={() => {
                  setMuted((m) => {
                    if (videoRef.current) videoRef.current.muted = !m;
                    return !m;
                  });
                }}
                className="grid place-items-center h-7 w-7 rounded-full hover:bg-accent text-foreground"
                aria-label={muted ? "Unmute" : "Mute"}
              >
                {muted ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
              </button>
            </div>
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}
