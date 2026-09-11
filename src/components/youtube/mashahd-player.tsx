"use client";

import { useEffect, useRef, useState, useCallback } from "react";
import {
  Play,
  Pause,
  Volume2,
  VolumeX,
  Maximize,
  Minimize,
  Settings2,
  PictureInPicture2,
  Gauge,
  Check,
} from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * MashahdPlayer — a custom video player with Mashahd's own UI identity.
 *
 * Replaces the native `<video controls>` with a bespoke control bar so the
 * video scene is visually distinct from YouTube's player. Features:
 *   - Custom play/pause, volume, scrubber
 *   - Fullscreen (native Fullscreen API + `f` key)
 *   - Picture-in-Picture toggle
 *   - Playback speed selector (0.5x – 2x)
 *   - Time display + buffered indicator
 *
 * The control bar is a floating glass pill that fades out when idle and
 * reappears on mouse move — distinct from YouTube's bottom-attached bar.
 */

type SpeedOption = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;
const SPEEDS: SpeedOption[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

export function MashahdPlayer({
  src,
  poster,
  videoId,
  autoPlay = true,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  children,
}: {
  src: string;
  poster: string;
  videoId: string;
  autoPlay?: boolean;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (t: number) => void;
  children?: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const [playing, setPlaying] = useState(false);
  const [muted, setMuted] = useState(false);
  const [volume, setVolume] = useState(1);
  const [current, setCurrent] = useState(0);
  const [duration, setDuration] = useState(0);
  const [buffered, setBuffered] = useState(0);
  const [fullscreen, setFullscreen] = useState(false);
  const [speed, setSpeed] = useState<SpeedOption>(1);
  const [showSpeedMenu, setShowSpeedMenu] = useState(false);
  const [controlsVisible, setControlsVisible] = useState(true);
  const [showVolumeSlider, setShowVolumeSlider] = useState(false);

  // Reset on video change — handled by remounting via `key={videoId}` on
  // the parent component, so we don't need a reset effect here. (Avoids the
  // setState-in-effect lint rule.) Initial state already zeros these.

  // Wire video events.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onLoaded = () => setDuration(v.duration || 0);
    const onTime = () => {
      setCurrent(v.currentTime);
      onTimeUpdate?.(v.currentTime);
      if (v.buffered.length > 0) {
        setBuffered(v.buffered.end(v.buffered.length - 1));
      }
    };
    const onPlayEvt = () => {
      setPlaying(true);
      onPlay?.();
    };
    const onPauseEvt = () => {
      setPlaying(false);
      onPause?.();
    };
    v.addEventListener("loadedmetadata", onLoaded);
    v.addEventListener("timeupdate", onTime);
    v.addEventListener("progress", onTime);
    v.addEventListener("play", onPlayEvt);
    v.addEventListener("pause", onPauseEvt);
    v.addEventListener("ended", onEnded as EventListener);
    return () => {
      v.removeEventListener("loadedmetadata", onLoaded);
      v.removeEventListener("timeupdate", onTime);
      v.removeEventListener("progress", onTime);
      v.removeEventListener("play", onPlayEvt);
      v.removeEventListener("pause", onPauseEvt);
      v.removeEventListener("ended", onEnded as EventListener);
    };
  }, [onPlay, onPause, onEnded, onTimeUpdate]);

  // Fullscreen change listener.
  useEffect(() => {
    const onFsChange = () =>
      setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFsChange);
    return () => document.removeEventListener("fullscreenchange", onFsChange);
  }, []);

  // Player control callbacks (declared before the keyboard handler that
  // references them, to avoid the "used before declared" error).
  const togglePlay = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    if (v.paused) v.play().catch(() => {});
    else v.pause();
  }, []);

  const toggleMute = useCallback(() => {
    const v = videoRef.current;
    if (!v) return;
    v.muted = !v.muted;
    setMuted(v.muted);
  }, []);

  const toggleFullscreen = useCallback(() => {
    const el = containerRef.current;
    if (!el) return;
    if (!document.fullscreenElement) {
      el.requestFullscreen?.().catch(() => {});
    } else {
      document.exitFullscreen?.().catch(() => {});
    }
  }, []);

  // Keyboard shortcuts when the player is focused/hovered.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "f") {
        e.preventDefault();
        toggleFullscreen();
      }
      if (e.key === " " || e.key === "k") {
        const v = videoRef.current;
        if (v && containerRef.current?.matches(":hover")) {
          e.preventDefault();
          togglePlay();
        }
      }
      if (e.key === "m") {
        const v = videoRef.current;
        if (v && containerRef.current?.matches(":hover")) {
          e.preventDefault();
          toggleMute();
        }
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, toggleMute, toggleFullscreen]);

  const changeVolume = (val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    v.muted = val === 0;
    setVolume(val);
    setMuted(val === 0);
  };

  const seek = (frac: number) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    v.currentTime = frac * duration;
    setCurrent(v.currentTime);
  };

  const togglePiP = async () => {
    const v = videoRef.current;
    if (!v) return;
    try {
      if (document.pictureInPictureElement) {
        await document.exitPictureInPicture();
      } else if (document.pictureInPictureEnabled) {
        await v.requestPictureInPicture();
      }
    } catch {
      /* PiP not available */
    }
  };

  const changeSpeed = (s: SpeedOption) => {
    const v = videoRef.current;
    if (!v) return;
    v.playbackRate = s;
    setSpeed(s);
    setShowSpeedMenu(false);
  };

  // Auto-hide controls after 3s of inactivity when playing.
  const showControls = () => {
    setControlsVisible(true);
    clearTimeout(idleTimer.current);
    if (playing) {
      idleTimer.current = setTimeout(() => setControlsVisible(false), 3000);
    }
  };

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const h = Math.floor(m / 60);
    if (h > 0)
      return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  const progressFrac = duration ? current / duration : 0;
  const bufferedFrac = duration ? buffered / duration : 0;

  return (
    <div
      ref={containerRef}
      className="relative w-full bg-black aspect-video overflow-hidden group"
      onMouseMove={showControls}
      onMouseLeave={() => playing && setControlsVisible(false)}
      onClick={(e) => {
        // Click on the video (not the controls) toggles play.
        if (e.target === videoRef.current || e.target === e.currentTarget) {
          togglePlay();
        }
      }}
    >
      <video
        ref={videoRef}
        key={videoId}
        className="w-full h-full"
        autoPlay={autoPlay}
        playsInline
        poster={poster}
        src={src}
      />

      {/* Children overlays (bullet comments, theater toggle, etc.) */}
      {children}

      {/* Center play/pause button (pulses on state change) */}
      {!playing && (
        <button
          onClick={togglePlay}
          className="absolute inset-0 grid place-items-center z-10"
          aria-label="Play"
        >
          <span className="grid place-items-center h-16 w-16 rounded-full glass-strong text-white shadow-glow border border-white/30 group-hover:scale-110 transition-transform">
            <Play className="h-7 w-7 fill-current ml-1" />
          </span>
        </button>
      )}

      {/* Floating glass control bar — Mashahd's unique player UI */}
      <div
        className={cn(
          "absolute bottom-3 left-3 right-3 z-20 transition-all duration-300",
          controlsVisible
            ? "opacity-100 translate-y-0"
            : "opacity-0 translate-y-2 pointer-events-none"
        )}
      >
        {/* Scrubber — above the control bar, full width */}
        <div
          className="relative h-1.5 rounded-full bg-white/20 mb-2 cursor-pointer group/scrub"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek((e.clientX - rect.left) / rect.width);
          }}
        >
          {/* Buffered */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-white/30"
            style={{ width: `${bufferedFrac * 100}%` }}
          />
          {/* Progress */}
          <div
            className="absolute inset-y-0 left-0 rounded-full bg-gradient-gold"
            style={{ width: `${progressFrac * 100}%` }}
          >
            {/* Scrub handle */}
            <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-3.5 w-3.5 rounded-full bg-gold-light shadow-glow opacity-0 group-hover/scrub:opacity-100 transition-opacity" />
          </div>
        </div>

        {/* Control bar — floating glass pill */}
        <div className="glass-strong rounded-full px-2 py-1.5 flex items-center gap-1 shadow-glass border border-white/10">
          {/* Play/Pause */}
          <button
            onClick={togglePlay}
            className="grid place-items-center h-8 w-8 rounded-full hover:bg-white/15 text-white transition-colors"
            aria-label={playing ? "Pause" : "Play"}
          >
            {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
          </button>

          {/* Volume */}
          <div
            className="flex items-center"
            onMouseEnter={() => setShowVolumeSlider(true)}
            onMouseLeave={() => setShowVolumeSlider(false)}
          >
            <button
              onClick={toggleMute}
              className="grid place-items-center h-8 w-8 rounded-full hover:bg-white/15 text-white transition-colors"
              aria-label={muted ? "Unmute" : "Mute"}
            >
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            {showVolumeSlider && (
              <input
                type="range"
                min={0}
                max={1}
                step={0.05}
                value={muted ? 0 : volume}
                onChange={(e) => changeVolume(Number(e.target.value))}
                className="w-20 ml-1 accent-[hsl(var(--gold))]"
                aria-label="Volume"
              />
            )}
          </div>

          {/* Time */}
          <span className="text-white text-xs tabular-nums px-1 select-none">
            {fmt(current)} <span className="text-white/50">/ {fmt(duration)}</span>
          </span>

          <div className="flex-1" />

          {/* Speed */}
          <div className="relative">
            <button
              onClick={() => setShowSpeedMenu((s) => !s)}
              className="flex items-center gap-1 h-8 px-2 rounded-full hover:bg-white/15 text-white text-xs font-medium transition-colors"
              aria-label="Playback speed"
              title="Playback speed"
            >
              <Gauge className="h-3.5 w-3.5" />
              {speed}x
            </button>
            {showSpeedMenu && (
              <div className="absolute bottom-10 right-0 glass-strong rounded-xl border border-white/10 shadow-float overflow-hidden py-1 min-w-20">
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => changeSpeed(s)}
                    className={cn(
                      "w-full px-4 py-1.5 text-left text-xs hover:bg-white/15 flex items-center justify-between gap-2",
                      speed === s ? "text-[hsl(var(--gold-light))] font-medium" : "text-white"
                    )}
                  >
                    {s}x
                    {speed === s && <Check className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            )}
          </div>

          {/* PiP */}
          {document.pictureInPictureEnabled !== undefined && (
            <button
              onClick={togglePiP}
              className="grid place-items-center h-8 w-8 rounded-full hover:bg-white/15 text-white transition-colors"
              aria-label="Picture in picture"
              title="Picture in picture"
            >
              <PictureInPicture2 className="h-4 w-4" />
            </button>
          )}

          {/* Settings (placeholder — opens speed menu for now) */}
          <button
            onClick={() => setShowSpeedMenu((s) => !s)}
            className="grid place-items-center h-8 w-8 rounded-full hover:bg-white/15 text-white transition-colors"
            aria-label="Settings"
            title="Settings"
          >
            <Settings2 className="h-4 w-4" />
          </button>

          {/* Fullscreen */}
          <button
            onClick={toggleFullscreen}
            className="grid place-items-center h-8 w-8 rounded-full hover:bg-white/15 text-white transition-colors"
            aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}
            title={fullscreen ? "Exit fullscreen (f)" : "Fullscreen (f)"}
          >
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}
