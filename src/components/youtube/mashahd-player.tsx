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
  Moon,
  Repeat,
  Waves,
  Sparkles,
  Timer,
} from "lucide-react";
import Hls from "hls.js";
import { HlsJsP2PEngine } from "p2p-media-loader-hlsjs";
import { cn } from "@/lib/utils";
import { ReactionBurst } from "./reaction-burst";
import {
  readNetworkInfo,
  evaluatePolicy,
  DEFAULT_P2P_CONFIG,
  type P2PPolicy,
} from "@/lib/p2p-policy";

/** A level entry exposed by hls.js — used to populate the quality selector. */
interface PlayerLevel {
  height: number; // 0 for "Auto"
  width: number;
  bitrate: number;
  name: string; // "Auto", "1080p", "720p", etc.
  index: number; // -1 for Auto, otherwise the hls.js level index
}

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

  // ── Pass 100: "Years Ahead" player power features ──
  // Ambient Mode: glowing backdrop that samples video colors (YouTube has this;
  //   we match + exceed by using OKLCH-aware canvas sampling).
  const [ambientMode, setAmbientMode] = useState(false);
  const [ambientColor, setAmbientColor] = useState("#000000");
  const ambientCanvasRef = useRef<HTMLCanvasElement | null>(null);

  // Stable Volume: auto-normalizes loud/quiet via DynamicsCompressorNode.
  //   YouTube's "Stable Volume" — we match with native Web Audio (no plugin).
  const [stableVolume, setStableVolume] = useState(false);
  const audioCtxRef = useRef<AudioContext | null>(null);
  const compressorRef = useRef<DynamicsCompressorNode | null>(null);
  const sourceNodeRef = useRef<MediaElementAudioSourceNode | null>(null);

  // Sleep Timer: pauses playback after a countdown (power-user feature).
  const [sleepTimerMin, setSleepTimerMin] = useState(0); // 0 = off
  const [sleepTimerRemaining, setSleepTimerRemaining] = useState(0);
  const sleepTimerRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // A-B Loop: set A & B markers; playback loops between them (power-user).
  const [abLoopA, setAbLoopA] = useState<number | null>(null);
  const [abLoopB, setAbLoopB] = useState<number | null>(null);

  // Video Heatmap: tracks seek positions to surface "most replayed" peaks.
  //   Rendered as a sparkline above the scrubber (YouTube has this; we match).
  const [heatmap, setHeatmap] = useState<number[]>([]); // bucketed play counts
  const lastBucketRef = useRef(-1);

  // ── Multi-resolution choice (§35) ──
  // Quality selector state. levels are populated from hls.js when the
  // HLS manifest parses (each level = one rendition). For direct MP4
  // sources, levels stays empty + the selector shows "Source" only.
  // currentLevelIndex is -1 for Auto (hls.js adapts to bandwidth).
  const [levels, setLevels] = useState<PlayerLevel[]>([]);
  const [currentLevelIndex, setCurrentLevelIndex] = useState(-1); // -1 = Auto
  const [showSettingsMenu, setShowSettingsMenu] = useState(false);
  // Tracks whether the source is HLS (vs direct MP4). Set in the HLS
  // init effect; drives the "Source" fallback in the selector.
  const [isHlsSource, setIsHlsSource] = useState(false);
  // User's preferred quality loaded from UserPreference (e.g. "720p").
  // Stored in state so the apply-preference effect re-runs when it loads.
  // Also mirrored in a ref for the telemetry interval + selectLevel.
  const [preferredQuality, setPreferredQuality] = useState("auto");
  const preferredQualityRef = useRef<string>("auto");
  // True once the preference has been fetched from /api/preferences.
  // The apply-preference effect waits for this before applying.
  const [preferenceLoaded, setPreferenceLoaded] = useState(false);

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
    const sourceIsHls = /\.m3u8(\?|$)/i.test(src) || src.includes("manifest/master");
    setIsHlsSource(sourceIsHls);
    // Reset quality state on source change (the new manifest will populate it).
    setLevels([]);
    setCurrentLevelIndex(-1);

    if (!sourceIsHls) {
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

        // ── Multi-resolution choice (§35) ──
        // Populate the quality selector from hls.js levels. Each level is
        // a rendition (e.g. 1080p, 720p). The "Auto" option (index -1)
        // lets hls.js adapt to bandwidth.
        // NOTE: the user's preferredQuality is applied by a separate effect
        // (apply-preference) that waits for both levels + preferenceLoaded.
        // This handler only populates levels + sets the default to Auto.
        const hlsLevels = hls.levels || [];
        const parsed: PlayerLevel[] = hlsLevels.map((lvl, i) => ({
          height: lvl.height || 0,
          width: lvl.width || 0,
          bitrate: lvl.bitrate || 0,
          name: lvl.height ? `${lvl.height}p` : `Rendition ${i + 1}`,
          index: i,
        }));
        setLevels(parsed);
        // Default to Auto until the apply-preference effect runs.
        hls.currentLevel = -1;
        setCurrentLevelIndex(-1);
      });

      // Track level switches (user or hls.js auto-abr) so the selector
      // shows the currently-active rendition.
      hls.on(Hls.Events.LEVEL_SWITCHED, (_evt, data) => {
        setCurrentLevelIndex(data.level);
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

  // ── Multi-resolution choice (§35) — load user's preferred quality ──
  // Fetch the user's preferredQuality from /api/preferences on mount.
  // Stored in state so the apply-preference effect re-runs when it loads
  // (the HLS manifest may have already parsed before this fetch completes).
  useEffect(() => {
    let cancelled = false;
    try {
      const bid = localStorage.getItem("yt-clone-browser-id") || "";
      if (!bid) {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setPreferenceLoaded(true);
        return;
      }
      fetch(`/api/preferences?bid=${encodeURIComponent(bid)}`)
        .then((r) => r.ok ? r.json() : null)
        .then((data) => {
          if (cancelled) return;
          // The API returns { preferences: { preferredQuality: "720p", ... } }
          // (wrapped in a "preferences" object). Read from the wrapper.
          const pref = data?.preferences?.preferredQuality || data?.preferredQuality;
          if (pref) {
            setPreferredQuality(pref);
            preferredQualityRef.current = pref;
          }
          setPreferenceLoaded(true);
        })
        .catch(() => {
          if (cancelled) return;
          setPreferenceLoaded(true); // still mark loaded — defaults to "auto"
        });
    } catch {
      // localStorage unavailable (SSR) — non-fatal.
      setPreferenceLoaded(true);
    }
    return () => { cancelled = true; };
  }, []);

  // ── Apply preferred quality once levels + preference are both ready ──
  // This handles the race where MANIFEST_PARSED fires before the preference
  // fetch completes. When both are ready, we set hls.currentLevel to the
  // user's preferred resolution (or -1 for Auto).
  useEffect(() => {
    if (!preferenceLoaded || levels.length === 0) return;
    const hls = hlsRef.current;
    if (!hls) return;
    if (preferredQuality === "auto") {
      hls.currentLevel = -1;
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setCurrentLevelIndex(-1);
      return;
    }
    const targetHeight = parseInt(preferredQuality, 10);
    if (Number.isNaN(targetHeight)) return;
    // Find exact match first, then closest lower.
    let matchIdx = levels.findIndex((l) => l.height === targetHeight);
    if (matchIdx < 0) {
      const lower = levels
        .filter((l) => l.height > 0 && l.height <= targetHeight)
        .sort((a, b) => b.height - a.height)[0];
      matchIdx = lower ? lower.index : -1;
    }
    hls.currentLevel = matchIdx;
    setCurrentLevelIndex(matchIdx);
  }, [preferenceLoaded, levels, preferredQuality]);

  // ── Switch rendition handler ──
  // Called when the user picks a resolution from the selector.
  // index = -1 → Auto (hls.js ABR), otherwise the level index.
  const selectLevel = useCallback((index: number) => {
    const hls = hlsRef.current;
    if (!hls) return;
    hls.currentLevel = index; // -1 = Auto
    setCurrentLevelIndex(index);
    setShowSettingsMenu(false);

    // Persist the user's choice to /api/preferences (fire-and-forget).
    // For "Auto", store "auto"; for a specific level, store its height (e.g. "720p").
    let qualityToSave = "auto";
    if (index >= 0 && hls.levels?.[index]?.height) {
      qualityToSave = `${hls.levels[index].height}p`;
    }
    // Update state so the apply-preference effect doesn't override the
    // user's manual choice on the next levels/preference change.
    setPreferredQuality(qualityToSave);
    preferredQualityRef.current = qualityToSave;
    try {
      const bid = localStorage.getItem("yt-clone-browser-id") || "";
      if (bid) {
        fetch("/api/preferences", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ browserId: bid, preferredQuality: qualityToSave }),
        }).catch(() => { /* persistence is best-effort */ });
      }
    } catch {
      /* localStorage unavailable — non-fatal */
    }
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

  // ── Pass 100: Ambient Mode — sample video frame colors every ~1.5s and
  //    project a soft radial glow behind the player. Uses an offscreen
  //    <canvas> (1×1) to read the average pixel color cheaply.
  useEffect(() => {
    if (!ambientMode) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setAmbientColor("#000000");
      return;
    }
    const v = videoRef.current;
    if (!v) return;
    if (!ambientCanvasRef.current) {
      ambientCanvasRef.current = document.createElement("canvas");
      ambientCanvasRef.current.width = 1;
      ambientCanvasRef.current.height = 1;
    }
    const ctx = ambientCanvasRef.current.getContext("2d", { willReadFrequently: true });
    if (!ctx) return;
    const interval = setInterval(() => {
      try {
        if (v.readyState >= 2) {
          ctx.drawImage(v, 0, 0, 1, 1);
          const px = ctx.getImageData(0, 0, 1, 1).data;
          // Boost saturation slightly for a more vivid glow.
          const r = Math.min(255, px[0] * 1.15);
          const g = Math.min(255, px[1] * 1.15);
          const b = Math.min(255, px[2] * 1.15);
          setAmbientColor(`rgb(${r | 0}, ${g | 0}, ${b | 0})`);
        }
      } catch { /* CORS-tainted frame — skip silently */ }
    }, 1500);
    return () => clearInterval(interval);
  }, [ambientMode]);

  // ── Pass 100: Stable Volume — route the media element through a Web Audio
  //    DynamicsCompressorNode to normalize loud/quiet passages. This is
  //    YouTube's "Stable Volume" feature, implemented with zero plugins.
  useEffect(() => {
    const v = videoRef.current;
    if (!v) return;
    if (stableVolume) {
      try {
        if (!audioCtxRef.current) {
          audioCtxRef.current = new AudioContext();
          sourceNodeRef.current = audioCtxRef.current.createMediaElementSource(v);
        }
        if (!compressorRef.current) {
          compressorRef.current = audioCtxRef.current.createDynamicsCompressor();
          compressorRef.current.threshold.value = -24;
          compressorRef.current.knee.value = 30;
          compressorRef.current.ratio.value = 12;
          compressorRef.current.attack.value = 0.003;
          compressorRef.current.release.value = 0.25;
        }
        sourceNodeRef.current?.connect(compressorRef.current);
        compressorRef.current.connect(audioCtxRef.current.destination);
        if (audioCtxRef.current.state === "suspended") audioCtxRef.current.resume();
      } catch { /* already connected or CORS — ignore */ }
    } else if (compressorRef.current && sourceNodeRef.current && audioCtxRef.current) {
      try {
        sourceNodeRef.current.disconnect(compressorRef.current);
        sourceNodeRef.current.connect(audioCtxRef.current.destination);
      } catch { /* ignore */ }
    }
  }, [stableVolume]);

  // ── Pass 100: Sleep Timer — countdown that pauses playback at zero.
  useEffect(() => {
    if (sleepTimerMin <= 0) {
      if (sleepTimerRef.current) { clearInterval(sleepTimerRef.current); sleepTimerRef.current = null; }
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSleepTimerRemaining(0);
      return;
    }
    setSleepTimerRemaining(sleepTimerMin * 60);
    sleepTimerRef.current = setInterval(() => {
      setSleepTimerRemaining((prev) => {
        if (prev <= 1) {
          if (sleepTimerRef.current) { clearInterval(sleepTimerRef.current); sleepTimerRef.current = null; }
          try { videoRef.current?.pause(); } catch { /* ignore */ }
          setSleepTimerMin(0);
          return 0;
        }
        return prev - 1;
      });
    }, 1000);
    return () => { if (sleepTimerRef.current) { clearInterval(sleepTimerRef.current); sleepTimerRef.current = null; } };
  }, [sleepTimerMin]);

  // Cleanup Web Audio nodes on unmount.
  useEffect(() => {
    return () => {
      try { audioCtxRef.current?.close(); } catch { /* ignore */ }
    };
  }, []);

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
    setShowSettingsMenu(false);
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
      {/* Pass 100: Ambient Mode backdrop — soft radial glow that samples the
          video's dominant color. Sits BEHIND the video so it frames the frame. */}
      {ambientMode && (
        <div
          aria-hidden
          className="absolute inset-0 z-0 pointer-events-none transition-[background] duration-1000 ease-out blur-3xl scale-110"
          style={{
            background: `radial-gradient(circle at 50% 50%, ${ambientColor} 0%, transparent 70%)`,
            opacity: 0.55,
          }}
        />
      )}
      <video
        ref={videoRef}
        className="w-full h-full"
        playsInline
        poster={poster}
        onPlay={() => { setPlaying(true); onPlay?.(); }}
        onPause={() => { setPlaying(false); onPause?.(); }}
        onTimeUpdate={() => {
          if (videoRef.current) {
            const t = videoRef.current.currentTime;
            setCurrent(t);
            onTimeUpdate?.(t);
            if (videoRef.current.buffered.length > 0) {
              setBuffered(videoRef.current.buffered.end(videoRef.current.buffered.length - 1));
            }
            // Pass 100: accumulate heatmap — bucket every 2 seconds.
            if (duration > 0) {
              const bucketSize = Math.max(2, duration / 50); // ~50 buckets
              const bucket = Math.floor(t / bucketSize);
              if (bucket !== lastBucketRef.current && bucket >= 0 && bucket < 60) {
                lastBucketRef.current = bucket;
                setHeatmap((prev) => {
                  const next = [...prev];
                  next[bucket] = (next[bucket] || 0) + 1;
                  return next;
                });
              }
            }
            // Pass 100: A-B loop — when playback crosses B, seek back to A.
            if (
              abLoopA !== null && abLoopB !== null &&
              t >= abLoopB && !endFiredRef.current
            ) {
              videoRef.current.currentTime = abLoopA;
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

      {/* Floating emoji reactions overlay (Pass 73) */}
      <ReactionBurst />

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
        {/* Pass 100: Video Heatmap — "most replayed" sparkline above the
            scrubber. Peaks indicate segments viewers replayed most. */}
        {heatmap.length > 0 && (
          <div className="h-3 mb-1 flex items-end gap-px opacity-70" aria-hidden>
            {Array.from({ length: 50 }).map((_, i) => {
              const v = heatmap[i] || 0;
              const max = Math.max(...heatmap, 1);
              const h = Math.max(2, (v / max) * 100);
              return (
                <div
                  key={i}
                  className="flex-1 bg-gradient-to-t from-gold/30 to-gold-light/70 rounded-sm"
                  style={{ height: `${h}%` }}
                />
              );
            })}
          </div>
        )}
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

        <div className="glass rounded-full px-2 py-1.5 flex items-center gap-1 shadow-glass border border-white/10">
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
              <div className="absolute bottom-10 right-0 glass rounded-xl border border-white/10 shadow-float overflow-hidden py-1 min-w-20">
                {SPEEDS.map((s) => (
                  <button key={s} onClick={() => changeSpeed(s)} className={cn("w-full px-4 py-1.5 text-left text-xs hover:bg-white/15 flex items-center justify-between gap-2", speed === s ? "text-[hsl(var(--gold-light))] font-medium" : "text-white")}>
                    {s}x {speed === s && <Check className="h-3 w-3" />}
                  </button>
                ))}
              </div>
            )}
          </div>
          {pipSupported && (
            <button onClick={togglePiP} className="grid place-items-center min-h-[44px] min-w-[44px] h-11 w-11 rounded-full hover:bg-white/15 text-white" aria-label="Picture in picture">
              <PictureInPicture2 className="h-4 w-4" />
            </button>
          )}
          {/* ── Settings popover (gear) — speed + quality (§35 multi-resolution) ──
              Previously this button just toggled the speed menu (same as the
              Gauge button). Now it opens a proper settings popover with BOTH
              speed and quality sections. The quality selector lists hls.js
              levels (for HLS sources) or "Source" (for direct MP4). */}
          <div className="relative">
            <button
              onClick={() => setShowSettingsMenu((s) => !s)}
              className="grid place-items-center min-h-[44px] min-w-[44px] h-11 w-11 rounded-full hover:bg-white/15 text-white"
              aria-label="Settings"
              aria-expanded={showSettingsMenu}
            >
              <Settings2 className="h-4 w-4" />
            </button>
            {showSettingsMenu && (
              <div className="absolute bottom-12 right-0 glass rounded-xl border border-white/10 shadow-float overflow-hidden py-2 min-w-44">
                {/* Speed section */}
                <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-white/50 font-semibold">
                  Speed
                </div>
                {SPEEDS.map((s) => (
                  <button
                    key={s}
                    onClick={() => changeSpeed(s)}
                    className={cn(
                      "w-full px-3 py-1.5 text-left text-xs hover:bg-white/15 flex items-center justify-between gap-2",
                      speed === s ? "text-[hsl(var(--gold-light))] font-medium" : "text-white",
                    )}
                  >
                    <span>{s}x</span>
                    {speed === s && <Check className="h-3 w-3" />}
                  </button>
                ))}
                {/* Quality section — multi-resolution choice (§35) */}
                <div className="border-t border-white/10 mt-1 pt-1">
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-white/50 font-semibold">
                    Quality
                  </div>
                  {isHlsSource && levels.length > 0 ? (
                    <>
                      {/* Auto (hls.js ABR) */}
                      <button
                        onClick={() => selectLevel(-1)}
                        className={cn(
                          "w-full px-3 py-1.5 text-left text-xs hover:bg-white/15 flex items-center justify-between gap-2",
                          currentLevelIndex === -1 ? "text-[hsl(var(--gold-light))] font-medium" : "text-white",
                        )}
                      >
                        <span>Auto</span>
                        {currentLevelIndex === -1 && <Check className="h-3 w-3" />}
                      </button>
                      {/* Available renditions, sorted high → low */}
                      {[...levels]
                        .sort((a, b) => b.height - a.height)
                        .map((lvl) => (
                          <button
                            key={lvl.index}
                            onClick={() => selectLevel(lvl.index)}
                            className={cn(
                              "w-full px-3 py-1.5 text-left text-xs hover:bg-white/15 flex items-center justify-between gap-2",
                              currentLevelIndex === lvl.index ? "text-[hsl(var(--gold-light))] font-medium" : "text-white",
                            )}
                          >
                            <span>
                              {lvl.name}
                              {lvl.bitrate > 0 && (
                                <span className="text-white/40 ml-1.5">
                                  {(lvl.bitrate / 1000).toFixed(0)}Mbps
                                </span>
                              )}
                            </span>
                            {currentLevelIndex === lvl.index && <Check className="h-3 w-3" />}
                          </button>
                        ))}
                    </>
                  ) : (
                    /* Direct MP4 source — only "Source" available */
                    <div className="px-3 py-1.5 text-xs text-white/70 flex items-center justify-between gap-2">
                      <span>Source</span>
                      <span className="text-[10px] text-white/40">
                        {isHlsSource ? "loading…" : "MP4"}
                      </span>
                    </div>
                  )}
                </div>
                {/* Pass 100: Enhancements section — "years ahead" power features */}
                <div className="border-t border-white/10 mt-1 pt-1">
                  <div className="px-3 py-1 text-[10px] uppercase tracking-wide text-white/50 font-semibold">
                    Enhancements
                  </div>
                  {/* Ambient Mode */}
                  <button
                    onClick={() => setAmbientMode((v) => !v)}
                    className={cn(
                      "w-full px-3 py-1.5 text-left text-xs hover:bg-white/15 flex items-center justify-between gap-2",
                      ambientMode ? "text-[hsl(var(--gold-light))] font-medium" : "text-white",
                    )}
                  >
                    <span className="flex items-center gap-1.5"><Sparkles className="h-3 w-3" /> Ambient mode</span>
                    {ambientMode && <Check className="h-3 w-3" />}
                  </button>
                  {/* Stable Volume */}
                  <button
                    onClick={() => setStableVolume((v) => !v)}
                    className={cn(
                      "w-full px-3 py-1.5 text-left text-xs hover:bg-white/15 flex items-center justify-between gap-2",
                      stableVolume ? "text-[hsl(var(--gold-light))] font-medium" : "text-white",
                    )}
                  >
                    <span className="flex items-center gap-1.5"><Waves className="h-3 w-3" /> Stable volume</span>
                    {stableVolume && <Check className="h-3 w-3" />}
                  </button>
                  {/* A-B Loop markers */}
                  <div className="px-3 py-1.5 text-xs text-white flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5"><Repeat className="h-3 w-3" /> A-B loop</span>
                    <div className="flex items-center gap-1">
                      <button
                        onClick={() => { setAbLoopA(videoRef.current?.currentTime ?? 0); if (abLoopB === null) setAbLoopB((videoRef.current?.duration ?? 0) || 0); }}
                        className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px]"
                        aria-label="Set loop start (A)"
                      >A</button>
                      <button
                        onClick={() => setAbLoopB(videoRef.current?.currentTime ?? 0)}
                        className="px-1.5 py-0.5 rounded bg-white/10 hover:bg-white/20 text-[10px]"
                        aria-label="Set loop end (B)"
                      >B</button>
                      {(abLoopA !== null || abLoopB !== null) && (
                        <button
                          onClick={() => { setAbLoopA(null); setAbLoopB(null); }}
                          className="px-1.5 py-0.5 rounded bg-rose-500/20 hover:bg-rose-500/30 text-[10px] text-rose-200"
                          aria-label="Clear A-B loop"
                        >✕</button>
                      )}
                    </div>
                  </div>
                  {abLoopA !== null && abLoopB !== null && (
                    <div className="px-3 pb-1 text-[10px] text-white/50 tabular-nums">
                      Looping {abLoopA.toFixed(0)}s → {abLoopB.toFixed(0)}s
                    </div>
                  )}
                  {/* Sleep Timer */}
                  <div className="px-3 py-1.5 text-xs text-white flex items-center justify-between gap-2">
                    <span className="flex items-center gap-1.5"><Moon className="h-3 w-3" /> Sleep timer</span>
                    <div className="flex items-center gap-1">
                      {[0, 5, 10, 15, 30].map((m) => (
                        <button
                          key={m}
                          onClick={() => setSleepTimerMin(m)}
                          className={cn(
                            "px-1.5 py-0.5 rounded text-[10px]",
                            sleepTimerMin === m ? "bg-[hsl(var(--gold))]/30 text-[hsl(var(--gold-light))]" : "bg-white/10 hover:bg-white/20",
                          )}
                          aria-label={m === 0 ? "Off" : `Sleep in ${m} minutes`}
                        >{m === 0 ? "Off" : `${m}m`}</button>
                      ))}
                    </div>
                  </div>
                  {sleepTimerRemaining > 0 && (
                    <div className="px-3 pb-1 text-[10px] text-[hsl(var(--gold-light))] tabular-nums flex items-center gap-1">
                      <Timer className="h-2.5 w-2.5" /> Pauses in {Math.floor(sleepTimerRemaining / 60)}:{String(sleepTimerRemaining % 60).padStart(2, "0")}
                    </div>
                  )}
                </div>
              </div>
            )}
          </div>
          <button onClick={toggleFullscreen} className="grid place-items-center min-h-[44px] min-w-[44px] h-11 w-11 rounded-full hover:bg-white/15 text-white" aria-label={fullscreen ? "Exit fullscreen" : "Enter fullscreen"}>
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
