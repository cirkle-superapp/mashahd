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
  Activity,
} from "lucide-react";
import Hls from "hls.js";
import { HlsJsP2PEngine } from "p2p-media-loader-hlsjs";
import { cn } from "@/lib/utils";
import {
  readNetworkInfo,
  evaluatePolicy,
  DEFAULT_P2P_CONFIG,
  type P2PPolicy,
} from "@/lib/p2p-policy";

/**
 * MashahdPlayer — a production-grade HLS player with WebRTC P2P acceleration.
 *
 * Architecture (per the master spec):
 *   1. Loads HLS via hls.js (authoritative fallback — always works).
 *   2. Evaluates P2P policy (cellular/saveData/background → off; Wi-Fi → on).
 *   3. If P2P is allowed, initializes p2p-media-loader-hlsjs to accelerate
 *      segment delivery via WebRTC peers.
 *   4. If P2P fails, is unavailable, or peers are insufficient:
 *      playback continues through normal HLS HTTP/CDN fallback.
 *   5. Exposes a developer-toggleable analytics HUD with real P2P/CDN stats.
 *
 * The player NEVER interrupts playback due to a P2P failure.
 */

type SpeedOption = 0.5 | 0.75 | 1 | 1.25 | 1.5 | 2;
const SPEEDS: SpeedOption[] = [0.5, 0.75, 1, 1.25, 1.5, 2];

interface P2PStats {
  p2pBytes: number;
  cdnBytes: number;
  peerCount: number;
  p2pRatio: number;
}

export function MashahdPlayer({
  src,
  poster,
  videoId,
  manifestVersion = "v1",
  swarmId,
  autoPlay = true,
  startAt,
  endAt,
  onPlay,
  onPause,
  onEnded,
  onTimeUpdate,
  children,
}: {
  src: string;
  poster?: string;
  videoId: string;
  manifestVersion?: string;
  swarmId?: string | null;
  autoPlay?: boolean;
  /** Optional start position (seconds). The player seeks here once metadata
   *  has loaded — used by the clip permalink page to deep-link to a segment. */
  startAt?: number;
  /** Optional end position (seconds). When playback reaches endAt, the player
   *  pauses + fires onEnded so the host UI can show the up-next state. */
  endAt?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (t: number) => void;
  children?: React.ReactNode;
}) {
  const containerRef = useRef<HTMLDivElement | null>(null);
  const videoRef = useRef<HTMLVideoElement | null>(null);
  const hlsRef = useRef<Hls | null>(null);
  const engineRef = useRef<HlsJsP2PEngine | null>(null);
  const idleTimer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  const telemetryTimer = useRef<ReturnType<typeof setInterval> | undefined>(undefined);
  const sessionIdRef = useRef<string>("");
  const startTimeRef = useRef<number>(0);

  // ── Refs that mirror state for the telemetry interval ──
  // The interval captures values in its closure, but we want it to read
  // the LATEST values (not the stale ones from when the interval was
  // created). These refs are updated alongside their corresponding state.
  const hudStatsRef = useRef<P2PStats>({ p2pBytes: 0, cdnBytes: 0, peerCount: 0, p2pRatio: 0 });
  const rebufferCountRef = useRef(0);
  const startupTimeRef2 = useRef(0);
  const p2pPolicyRef = useRef<P2PPolicy | null>(null);

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
  const [showHud, setShowHud] = useState(false);
  // PiP support flag — computed after mount to avoid hydration mismatch
  // (document.pictureInPictureEnabled is undefined on the server).
  const [pipSupported, setPipSupported] = useState(false);
  const [hudStats, setHudStats] = useState<P2PStats>({
    p2pBytes: 0,
    cdnBytes: 0,
    peerCount: 0,
    p2pRatio: 0,
  });
  const [p2pPolicy, setP2pPolicy] = useState<P2PPolicy | null>(null);
  const [rebufferCount, setRebufferCount] = useState(0);
  const [startupTime, setStartupTime] = useState(0);

  // Sync refs with state so the telemetry interval reads latest values.
  useEffect(() => { hudStatsRef.current = hudStats; }, [hudStats]);
  useEffect(() => { rebufferCountRef.current = rebufferCount; }, [rebufferCount]);
  useEffect(() => { startupTimeRef2.current = startupTime; }, [startupTime]);
  useEffect(() => { p2pPolicyRef.current = p2pPolicy; }, [p2pPolicy]);

  // ── Initialize HLS + P2P on mount / video change ──
  useEffect(() => {
    const video = videoRef.current;
    if (!video) return;

    // Detect PiP support after mount (avoids hydration mismatch —
    // document.pictureInPictureEnabled is undefined on the server).
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setPipSupported(
      typeof document !== "undefined" &&
      document.pictureInPictureEnabled !== undefined
    );

    startTimeRef.current = performance.now();
    sessionIdRef.current = `s_${Math.random().toString(36).slice(2, 12)}`;

    // Evaluate P2P policy.
    const net = readNetworkInfo();
    const policy = evaluatePolicy(net, DEFAULT_P2P_CONFIG, {
      pageVisible: document.visibilityState === "visible",
      userOptOut: false,
    });
    setP2pPolicy(policy);

    let hls: Hls;
    let engine: HlsJsP2PEngine | null = null;

    // ── Detect source type ──
    // HLS manifests end in .m3u8 (or are served as application/vnd.apple.mpegurl).
    // Anything else (e.g. .mp4, .webm) is a direct video file — use the native
    // <video> element, which handles MP4/WebM natively across all browsers.
    // hls.js CANNOT parse direct MP4 URLs (it expects HLS manifests).
    const isHlsSource = /\.m3u8(\?|$)/i.test(src) || src.includes("manifest/master");

    if (!isHlsSource) {
      // Direct video file (MP4/WebM) — native playback, no hls.js needed.
      video.src = src;
      video.load();
      if (autoPlay) {
        video.play().catch(() => {});
      }
      // Mark startup complete once metadata loads.
      const onMeta = () => {
        setStartupTime((performance.now() - startTimeRef.current) / 1000);
        if (video.buffered.length > 0) {
          setBuffered(video.buffered.end(video.buffered.length - 1));
        }
      };
      video.addEventListener("loadedmetadata", onMeta);
      setP2pPolicy({ ...policy, enabled: false }); // P2P only applies to HLS
    } else if (Hls.isSupported()) {
      hls = new Hls({
        enableWorker: true,
        lowLatencyMode: false,
      });
      hlsRef.current = hls;

      // If P2P is enabled and we have a swarmId, attach the P2P engine.
      if (policy.enabled && swarmId) {
        try {
          // p2p-media-loader-hlsjs v4 API: HlsJsP2PEngine takes a config
          // where swarmId is a top-level property. The type definitions
          // may be incomplete, so we cast to the constructor with the
          // extended config shape.
          const P2PEngine = HlsJsP2PEngine as unknown as new (config: {
            swarmId: string;
            maxPeerConnections: number;
          }) => { initHlsJsEvents: (hls: Hls) => void; destroy: () => void; core?: any };
          engine = new P2PEngine({
            swarmId,
            maxPeerConnections: policy.maxPeers,
          }) as any;
          // Wire the P2P engine into hls.js events.
          (engine as any).initHlsJsEvents(hls);
          engineRef.current = engine;

          // Wire P2P stats for the HUD.
          // The engine exposes a core instance with event handlers.
          const core = (engine as any).core;
          if (core?.on) {
            core.on("segment-stats-loaded", (stats: any) => {
              const p2p = stats.p2pDownloadedBytes || 0;
              const cdn = stats.httpDownloadedBytes || 0;
              setHudStats({
                p2pBytes: p2p,
                cdnBytes: cdn,
                peerCount: stats.peers?.length || 0,
                p2pRatio: p2p + cdn > 0 ? p2p / (p2p + cdn) : 0,
              });
            });
          }
        } catch (e) {
          // P2P init failed — silently fall back to HTTP. Playback continues.
          console.warn("[MashahdPlayer] P2P init failed, using HTTP fallback:", e);
        }
      }

      hls.loadSource(src);
      hls.attachMedia(video);

      hls.on(Hls.Events.MANIFEST_PARSED, () => {
        if (autoPlay) video.play().catch(() => {});
        setStartupTime((performance.now() - startTimeRef.current) / 1000);
      });

      // Track rebuffers.
      hls.on(Hls.Events.FRAG_BUFFERED, () => {
        if (video.buffered.length > 0) {
          setBuffered(video.buffered.end(video.buffered.length - 1));
        }
      });
    } else if (video.canPlayType("application/vnd.apple.mpegurl")) {
      // Native HLS (Safari).
      video.src = src;
      if (autoPlay) video.play().catch(() => {});
    }

    // Telemetry — batched every 20s. Reads from refs (not state) so the
    // interval always sends the LATEST values, not stale closure captures.
    telemetryTimer.current = setInterval(() => {
      sendTelemetry({
        sessionId: sessionIdRef.current,
        videoId,
        cdnBytes: hudStatsRef.current.cdnBytes,
        p2pBytes: hudStatsRef.current.p2pBytes,
        rebufferCount: rebufferCountRef.current,
        startupTime: startupTimeRef2.current,
        peerCount: hudStatsRef.current.peerCount,
        currentRendition: hlsRef.current?.levels?.[hlsRef.current.currentLevel || 0]?.height
          ? `${hlsRef.current.levels[hlsRef.current.currentLevel || 0].height}p`
          : "",
        p2pEnabled: p2pPolicyRef.current?.enabled ?? false,
      });
    }, 20000);

    return () => {
      hlsRef.current?.destroy();
      engineRef.current?.destroy();
      if (telemetryTimer.current) clearInterval(telemetryTimer.current);
    };
  }, [src, videoId, swarmId, autoPlay]);

  // ── Fullscreen change listener ──
  useEffect(() => {
    const onFs = () => setFullscreen(Boolean(document.fullscreenElement));
    document.addEventListener("fullscreenchange", onFs);
    return () => document.removeEventListener("fullscreenchange", onFs);
  }, []);

  // ── Keyboard shortcuts ──
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
    if (!document.fullscreenElement) el.requestFullscreen?.().catch(() => {});
    else document.exitFullscreen?.().catch(() => {});
  }, []);

  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      const target = e.target as HTMLElement;
      if (target.tagName === "INPUT" || target.tagName === "TEXTAREA") return;
      if (e.key === "f") {
        e.preventDefault();
        toggleFullscreen();
      }
      if ((e.key === " " || e.key === "k") && containerRef.current?.matches(":hover")) {
        e.preventDefault();
        togglePlay();
      }
      if (e.key === "m" && containerRef.current?.matches(":hover")) {
        e.preventDefault();
        toggleMute();
      }
      if (e.key === "d" && containerRef.current?.matches(":hover")) {
        e.preventDefault();
        setShowHud((s) => !s);
      }
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [togglePlay, toggleMute, toggleFullscreen]);

  // ── Rebuffer detection ──
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    const onWaiting = () => setRebufferCount((c) => c + 1);
    v.addEventListener("waiting", onWaiting);
    return () => v.removeEventListener("waiting", onWaiting);
  }, []);

  // ── Clip range: seek to startAt once metadata loads + track endAt.
  //
  // The clip permalink page passes startAt/endAt so the player deep-links
  // into a segment and stops at its end. We attach a one-time loadedmetadata
  // listener (separate from the init effect) so we don't have to thread
  // startAt through the source-detection branches — the listener fires
  // for direct MP4, hls.js, AND native HLS (Safari) alike.
  const endFiredRef = useRef(false);
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (typeof startAt !== "number" || !isFinite(startAt) || startAt <= 0) return;
    const onMeta = () => {
      // Clamp to a sane range — startAt can't exceed the clip's endAt (if
      // provided) or the video's duration.
      const cap = typeof endAt === "number" && isFinite(endAt) ? Math.min(endAt, v.duration || Infinity) : (v.duration || Infinity);
      const target = Math.max(0, Math.min(startAt, cap));
      try {
        // Setting currentTime may throw if the media isn't seekable yet;
        // we retry on the next seeked event by ignoring the error.
        v.currentTime = target;
      } catch {
        /* not seekable yet — ignore */
      }
    };
    v.addEventListener("loadedmetadata", onMeta);
    return () => v.removeEventListener("loadedmetadata", onMeta);
  }, [startAt, endAt]);

  const changeVolume = (val: number) => {
    const v = videoRef.current;
    if (!v) return;
    v.volume = val;
    v.muted = val === 0;
    setVolume(val);
    setMuted(val === 0);
  };

  // Seek to an absolute position (in seconds). Used by keyboard handlers
  // on the scrubber so arrow keys move by fixed deltas.
  const seekTo = useCallback((seconds: number) => {
    const v = videoRef.current;
    if (!v || !duration) return;
    const clamped = Math.max(0, Math.min(duration, seconds));
    v.currentTime = clamped;
    setCurrent(clamped);
  }, [duration]);

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
      if (document.pictureInPictureElement) await document.exitPictureInPicture();
      else if (document.pictureInPictureEnabled) await v.requestPictureInPicture();
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

  const showControls = () => {
    setControlsVisible(true);
    clearTimeout(idleTimer.current);
    if (playing) idleTimer.current = setTimeout(() => setControlsVisible(false), 3000);
  };

  const fmt = (s: number) => {
    if (!s || !isFinite(s)) return "0:00";
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    const h = Math.floor(m / 60);
    if (h > 0) return `${h}:${String(m % 60).padStart(2, "0")}:${String(sec).padStart(2, "0")}`;
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
        if (e.target === videoRef.current || e.target === e.currentTarget) togglePlay();
      }}
    >
      <video
        ref={videoRef}
        className="w-full h-full"
        playsInline
        poster={poster}
        onPlay={() => { setPlaying(true); onPlay?.(); }}
        onPause={() => { setPlaying(false); onPause?.(); }}
        onTimeUpdate={() => {
          if (videoRef.current) {
            setCurrent(videoRef.current.currentTime);
            onTimeUpdate?.(videoRef.current.currentTime);
            if (videoRef.current.buffered.length > 0) {
              setBuffered(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
            }
            // Clip range: when playback crosses endAt, pause + fire onEnded
            // so the host UI can show the up-next state. Guarded by a ref
            // so onEnded fires exactly once per clip view.
            if (
              typeof endAt === "number" &&
              isFinite(endAt) &&
              videoRef.current.currentTime >= endAt &&
              !endFiredRef.current
            ) {
              endFiredRef.current = true;
              try { videoRef.current.pause(); } catch { /* ignore */ }
              onEnded?.();
            }
          }
        }}
        onEnded={onEnded}
      />

      {children}

      {/* Center play button */}
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

      {/* P2P badge — shows the policy decision (non-intrusive) */}
      {p2pPolicy && (
        <div className="absolute top-2 left-2 z-15 flex items-center gap-1 px-2 py-0.5 rounded-full bg-black/60 text-white text-[10px] font-medium backdrop-blur">
          {p2pPolicy.enabled ? (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-emerald-400 animate-pulse" />
              P2P
            </>
          ) : (
            <>
              <span className="h-1.5 w-1.5 rounded-full bg-amber-400" />
              HTTP
            </>
          )}
        </div>
      )}

      {/* Developer analytics HUD — toggle with 'd' key */}
      {showHud && (
        <div className="absolute top-10 left-2 z-20 glass-strong rounded-lg p-3 text-xs text-white font-mono space-y-1 min-w-48">
          <div className="flex items-center gap-1 font-sans font-semibold text-[hsl(var(--gold))] mb-1">
            <Activity className="h-3 w-3" /> Analytics HUD
          </div>
          <div>Network: {p2pPolicy?.reason || "evaluating"}</div>
          <div>P2P: {hudStats.peerCount} peers</div>
          <div>P2P DL: {(hudStats.p2pBytes / 1048576).toFixed(1)} MB</div>
          <div>CDN DL: {(hudStats.cdnBytes / 1048576).toFixed(1)} MB</div>
          <div>P2P ratio: {(hudStats.p2pRatio * 100).toFixed(0)}%</div>
          <div>Buffer: {buffered ? `${(buffered - current).toFixed(1)}s` : "—"}</div>
          <div>Rebuffers: {rebufferCount}</div>
          <div>Startup: {startupTime.toFixed(2)}s</div>
          <div className="text-[hsl(var(--gold-light))] mt-1">
            Savings: {(hudStats.p2pRatio * 100).toFixed(0)}% origin offload
          </div>
        </div>
      )}

      {/* Floating glass control bar */}
      <div
        className={cn(
          "absolute bottom-3 left-3 right-3 z-20 transition-all duration-300",
          controlsVisible ? "opacity-100 translate-y-0" : "opacity-0 translate-y-2 pointer-events-none"
        )}
      >
        {/* Scrubber */}
        <div
          role="slider"
          tabIndex={0}
          aria-label="Video progress"
          aria-valuemin={0}
          aria-valuemax={duration || 0}
          aria-valuenow={Math.floor(current)}
          onKeyDown={(e) => {
            if (e.key === "ArrowLeft") {
              e.preventDefault();
              seekTo(current - 5);
            } else if (e.key === "ArrowRight") {
              e.preventDefault();
              seekTo(current + 5);
            } else if (e.key === "Home") {
              e.preventDefault();
              seekTo(0);
            } else if (e.key === "End") {
              e.preventDefault();
              seekTo(duration);
            }
          }}
          className="relative h-1.5 rounded-full bg-white/20 mb-2 cursor-pointer group/scrub focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-gold/60"
          onClick={(e) => {
            const rect = e.currentTarget.getBoundingClientRect();
            seek((e.clientX - rect.left) / rect.width);
          }}
        >
          <div className="absolute inset-y-0 left-0 rounded-full bg-white/30" style={{ width: `${bufferedFrac * 100}%` }} />
          <div className="absolute inset-y-0 left-0 rounded-full bg-gradient-gold" style={{ width: `${progressFrac * 100}%` }}>
            <span className="absolute right-0 top-1/2 -translate-y-1/2 translate-x-1/2 h-3.5 w-3.5 rounded-full bg-gold-light shadow-glow opacity-0 group-hover/scrub:opacity-100 transition-opacity" />
          </div>
        </div>

        <div className="glass-strong rounded-full px-2 py-1.5 flex items-center gap-1 shadow-glass border border-white/10">
          <button onClick={togglePlay} className="grid place-items-center h-8 w-8 rounded-full hover:bg-white/15 text-white" aria-label={playing ? "Pause" : "Play"}>
            {playing ? <Pause className="h-4 w-4 fill-current" /> : <Play className="h-4 w-4 fill-current ml-0.5" />}
          </button>
          <div className="flex items-center" onMouseEnter={() => setShowVolumeSlider(true)} onMouseLeave={() => setShowVolumeSlider(false)}>
            <button onClick={toggleMute} className="grid place-items-center h-8 w-8 rounded-full hover:bg-white/15 text-white" aria-label={muted ? "Unmute" : "Mute"}>
              {muted || volume === 0 ? <VolumeX className="h-4 w-4" /> : <Volume2 className="h-4 w-4" />}
            </button>
            {showVolumeSlider && (
              <input type="range" min={0} max={1} step={0.05} value={muted ? 0 : volume} onChange={(e) => changeVolume(Number(e.target.value))} className="w-20 ml-1 accent-[hsl(var(--gold))]" />
            )}
          </div>
          <span className="text-white text-xs tabular-nums px-1 select-none">
            {fmt(current)} <span className="text-white/50">/ {fmt(duration)}</span>
          </span>
          <div className="flex-1" />
          <div className="relative">
            <button onClick={() => setShowSpeedMenu((s) => !s)} className="flex items-center gap-1 h-8 px-2 rounded-full hover:bg-white/15 text-white text-xs font-medium" aria-label="Playback speed">
              <Gauge className="h-3.5 w-3.5" />{speed}x
            </button>
            {showSpeedMenu && (
              <div className="absolute bottom-10 right-0 glass-strong rounded-xl border border-white/10 shadow-float overflow-hidden py-1 min-w-20">
                {SPEEDS.map((s) => (
                  <button key={s} onClick={() => changeSpeed(s)} className={cn("w-full px-4 py-1.5 text-left text-xs hover:bg-white/15 flex items-center justify-between gap-2", speed === s ? "text-[hsl(var(--gold-light))] font-medium" : "text-white")}>
                    {s}x {speed === s && <Check className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {pipSupported && (
            <button onClick={togglePiP} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15 text-white" aria-label="Picture in picture">
              <PictureInPicture2 className="h-4 w-4" />
            </button>
          )}
          <button onClick={() => setShowSpeedMenu((s) => !s)} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15 text-white" aria-label="Settings">
            <Settings2 className="h-4 w-4" />
          </button>
          <button onClick={toggleFullscreen} className="grid place-items-center h-9 w-9 rounded-full hover:bg-white/15 text-white" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
            {fullscreen ? <Minimize className="h-4 w-4" /> : <Maximize className="h-4 w-4" />}
          </button>
        </div>
      </div>
    </div>
  );
}

/** Send a telemetry batch to the backend. */
async function sendTelemetry(data: Record<string, unknown>) {
  try {
    await fetch("/api/media/telemetry", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(data),
    });
  } catch {
    /* telemetry is best-effort — never block playback */
  }
}
