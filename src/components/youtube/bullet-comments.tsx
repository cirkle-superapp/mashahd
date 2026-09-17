"use client";

import { useEffect, useState, useRef, useCallback } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { MessageSquarePlus, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * BulletComments — floating danmaku-style comments that drift across the
 * video player. Adapted from CIRKLE's bullet-comments overlay.
 *
 * When real comments are available (via the comments API), they're used as
 * the bullet pool. Otherwise, a set of generic reactions is used as a
 * fallback so the feature always has content to display.
 */

type Bullet = {
  id: number;
  text: string;
  color: string;
  track: number;
  duration: number;
};

const FALLBACK_BULLETS: { text: string; color?: string }[] = [
  { text: "this is fire 🔥", color: "text-rose" },
  { text: "wait what just happened", color: "text-gold" },
  { text: "underrated channel fr", color: "text-teal-light" },
  { text: "anyone else replay this?", color: "text-foreground" },
  { text: "the editing tho", color: "text-rose" },
  { text: "goated explanation", color: "text-gold" },
  { text: "subscribed instantly", color: "text-teal-light" },
  { text: "the soundtrack ✨", color: "text-rose" },
];

const COLORS = ["text-rose", "text-gold", "text-teal-light", "text-foreground"];
const TRACKS = 5;
const TRACK_HEIGHT = 28;

export function BulletComments({
  enabled,
  onToggle,
  paused,
  videoId,
}: {
  enabled: boolean;
  onToggle: () => void;
  paused: boolean;
  videoId: string;
}) {
  const [bullets, setBullets] = useState<Bullet[]>([]);
  const [commentPool, setCommentPool] = useState<{ text: string; color: string }[]>([]);
  const idRef = useRef(0);
  const poolIdx = useRef(0);

  // Fetch real comments to use as bullet pool.
  useEffect(() => {
    fetch(`/api/videos/${videoId}/comments`)
      .then((r) => r.json())
      .then((data) => {
        if (data.comments && data.comments.length > 0) {
          const pool = data.comments.map((c: any, i: number) => ({
            text: c.text.slice(0, 80),
            color: COLORS[i % COLORS.length],
          }));
          setCommentPool(pool);
        }
      })
      .catch(() => {});
  }, [videoId]);

  const spawn = useCallback(() => {
    const pool = commentPool.length > 0 ? commentPool : FALLBACK_BULLETS;
    const b = pool[poolIdx.current % pool.length];
    poolIdx.current++;
    const bullet: Bullet = {
      id: idRef.current++,
      text: b.text,
      color: b.color || "text-foreground",
      track: Math.floor(Math.random() * TRACKS),
      duration: 9 + Math.random() * 4,
    };
    setBullets((cur) => [...cur.slice(-12), bullet]);
    setTimeout(() => {
      setBullets((cur) => cur.filter((x) => x.id !== bullet.id));
    }, bullet.duration * 1000 + 500);
  }, [commentPool]);

  useEffect(() => {
    if (!enabled || paused) return;
    const interval = setInterval(spawn, 1800);
    spawn();
    return () => clearInterval(interval);
  }, [enabled, paused, spawn, videoId]);

  // Clear all bullets when disabled.
  useEffect(() => {
    if (!enabled) {
      // Intentional external-state sync — clearing the bullet queue when
      // the user toggles the overlay off.
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setBullets([]);
    }
  }, [enabled]);

  return (
    <>
      {/* Toggle button — top-left of the player */}
      <button
        onClick={onToggle}
        className={cn(
          "absolute top-2 left-2 z-10 px-2.5 py-1 rounded-full text-xs font-medium backdrop-blur flex items-center gap-1.5 transition-colors",
          enabled
            ? "bg-gold/90 text-charcoal hover:bg-gold"
            : "bg-black/70 text-white hover:bg-black/90"
        )}
        aria-label={enabled ? "Hide bullet comments" : "Show bullet comments"}
        title={enabled ? "Hide bullet comments" : "Show bullet comments"}
      >
        <MessageSquarePlus className="h-3.5 w-3.5" />
        {enabled ? "Bullets on" : "Bullets"}
      </button>

      {/* Floating bullet layer — only visible when enabled */}
      {enabled && (
        <div className="absolute inset-0 pointer-events-none overflow-hidden">
          <AnimatePresence>
            {bullets.map((b) => (
              <motion.div
                key={b.id}
                initial={{ x: "100%", opacity: 0 }}
                animate={{ x: "-110%", opacity: 1 }}
                exit={{ opacity: 0 }}
                transition={{
                  duration: b.duration,
                  ease: "linear",
                  opacity: { duration: 0.3 },
                }}
                className={cn(
                  "absolute whitespace-nowrap text-sm font-medium drop-shadow-[0_1px_2px_rgba(0,0,0,0.8)]",
                  b.color
                )}
                style={{ top: `${b.track * TRACK_HEIGHT + 8}px` }}
              >
                {b.text}
              </motion.div>
            ))}
          </AnimatePresence>
        </div>
      )}
    </>
  );
}

/* ── Standalone composer for posting a bullet ── */

export function BulletComposer({
  onPost,
  onClose,
}: {
  onPost: (text: string) => void;
  onClose: () => void;
}) {
  const [text, setText] = useState("");
  return (
    <div className="absolute bottom-16 left-1/2 -translate-x-1/2 z-20 w-[min(90%,400px)] glass-strong rounded-xl border border-gold/20 p-3 shadow-float">
      <div className="flex items-center justify-between mb-2">
        <span className="text-xs font-semibold uppercase tracking-wide text-muted-foreground">
          Post a bullet comment
        </span>
        <button
          onClick={onClose}
          className="p-1 rounded-full hover:bg-accent"
          aria-label="Close"
        >
          <X className="h-3.5 w-3.5" />
        </button>
      </div>
      <input
        autoFocus
        value={text}
        onChange={(e) => setText(e.target.value)}
        onKeyDown={(e) => {
          if (e.key === "Enter" && text.trim()) {
            onPost(text.trim());
            setText("");
            onClose();
          }
          if (e.key === "Escape") onClose();
        }}
        placeholder="Type a short comment that drifts across…"
        aria-label="Type a bullet comment"
        maxLength={80}
        className="w-full bg-transparent border-b border-border pb-1 text-sm focus:outline-none focus:border-gold"
      />
      <div className="flex justify-end gap-2 mt-2">
        <button
          onClick={onClose}
          className="text-xs px-3 py-1 rounded-full hover:bg-accent"
        >
          Cancel
        </button>
        <button
          onClick={() => {
            if (text.trim()) {
              onPost(text.trim());
              setText("");
              onClose();
            }
          }}
          disabled={!text.trim()}
          className="text-xs px-3 py-1 rounded-full bg-primary text-primary-foreground disabled:opacity-50"
        >
          Send
        </button>
      </div>
    </div>
  );
}
