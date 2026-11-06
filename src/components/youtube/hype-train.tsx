"use client";

import { useEffect, useRef, useState } from "react";
import { Flame, Zap, Gift, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * HypeTrain — live stream engagement meter (Pass 101).
 *
 * Competitive context:
 *   - Twitch ships "Hype Train" — a community contribution meter that
 *     fills as viewers sub/donate/cheer, unlocking emote rewards at
 *     milestones. It's Twitch's #1 engagement driver during peak moments.
 *   - YouTube has no equivalent. Kick has no equivalent.
 *   → Mashahd ships a Hype Train that fills from ANY engagement signal
 *     (likes, comments, reactions, watch-party joins, clip creates) —
 *     not just paid actions. This is MORE inclusive than Twitch's
 *     pay-walled version: every viewer contributes, not just payers.
 *
 * Implementation:
 *   - Mounted inside the live stream view.
 *   - Listens for engagement events (dispatched via window CustomEvents).
 *   - Meter fills 0→100% over the train duration (default 5 min).
 *   - At each milestone (25%, 50%, 75%, 100%) a reward emote unlocks.
 *   - When the train completes (100%) or times out, it enters cooldown.
 *   - Visual: gradient progress bar with flame icon, pulsing at high hype.
 */
interface HypeTrainProps {
  /** Stream ID — used to scope engagement events. */
  streamId: string;
  /** Train duration in seconds (default 300 = 5 min). */
  durationSec?: number;
}

const MILESTONES = [
  { pct: 25, label: "🎉 Lvl 1", reward: "Bronze emote unlocked" },
  { pct: 50, label: "🔥 Lvl 2", reward: "Silver emote unlocked" },
  { pct: 75, label: "⚡ Lvl 3", reward: "Gold emote unlocked" },
  { pct: 100, label: "👑 MAX", reward: "Diamond emote + badge unlocked" },
];

export function HypeTrain({ streamId, durationSec = 300 }: HypeTrainProps) {
  const [active, setActive] = useState(false);
  const [level, setLevel] = useState(0); // 0-100
  const [unlockedMilestones, setUnlockedMilestones] = useState<number[]>([]);
  const [showReward, setShowReward] = useState<string | null>(null);
  const expiryRef = useRef<number>(0);

  // Listen for engagement events scoped to this stream.
  useEffect(() => {
    const onEngagement = (e: Event) => {
      const detail = (e as CustomEvent).detail || {};
      if (detail.streamId !== streamId) return;
      const boost = Number(detail.boost) || 5; // each event adds 5% by default
      const now = Date.now();
      if (!active || now > expiryRef.current) {
        setActive(true);
        setLevel(0);
        setUnlockedMilestones([]);
        expiryRef.current = now + durationSec * 1000;
      }
      setLevel((prev) => {
        const next = Math.min(100, prev + boost);
        // Check for milestone unlocks.
        for (const m of MILESTONES) {
          if (next >= m.pct && !unlockedMilestones.includes(m.pct)) {
            setUnlockedMilestones((u) => [...u, m.pct]);
            setShowReward(`${m.label} — ${m.reward}`);
            setTimeout(() => setShowReward(null), 4000);
          }
        }
        if (next >= 100) {
          // Train completed — enter cooldown after 10s celebration.
          setTimeout(() => { setActive(false); setLevel(0); setUnlockedMilestones([]); }, 10000);
        }
        return next;
      });
    };
    window.addEventListener("mashahd:engagement", onEngagement as EventListener);
    return () => window.removeEventListener("mashahd:engagement", onEngagement as EventListener);
  }, [streamId, active, durationSec, unlockedMilestones]);

  // Auto-expire the train if time runs out.
  useEffect(() => {
    if (!active) return;
    const tick = setInterval(() => {
      if (Date.now() > expiryRef.current) {
        setActive(false);
        setLevel(0);
        setUnlockedMilestones([]);
      }
    }, 1000);
    return () => clearInterval(tick);
  }, [active]);

  if (!active && level === 0) return null;

  const isHot = level >= 75;

  return (
    <div className="relative">
      {/* Floating reward toast */}
      {showReward && (
        <div className="absolute -top-12 left-1/2 -translate-x-1/2 z-50 glass-strong rounded-full px-4 py-2 text-xs font-semibold text-white border border-gold/40 shadow-glow animate-fade-up whitespace-nowrap">
          <Gift className="inline h-3 w-3 mr-1 text-gold-light" />
          {showReward}
        </div>
      )}

      {/* Hype meter */}
      <div
        className={cn(
          "flex items-center gap-2 px-3 py-1.5 rounded-full glass border transition-all",
          isHot ? "border-gold/60 shadow-glow animate-pulse" : "border-white/10"
        )}
        role="status"
        aria-label={`Hype train at ${level}%`}
      >
        <Flame className={cn("h-4 w-4", isHot ? "text-orange-400" : "text-muted-foreground")} />
        <div className="flex-1 min-w-[120px] h-2 rounded-full bg-black/30 overflow-hidden">
          <div
            className="h-full rounded-full transition-all duration-500 ease-out"
            style={{
              width: `${level}%`,
              background: isHot
                ? "linear-gradient(90deg, #f59e0b, #ef4444, #ec4899)"
                : "linear-gradient(90deg, hsl(var(--gold)), hsl(var(--gold-light)))",
            }}
          />
        </div>
        <span className={cn("text-xs font-bold tabular-nums", isHot ? "text-orange-300" : "text-muted-foreground")}>
          {level}%
        </span>
        {isHot && <Zap className="h-3 w-3 text-yellow-300 animate-pulse" />}
      </div>
    </div>
  );
}

/**
 * Dispatch an engagement event to feed the Hype Train.
 * Call from any UI that wants to contribute (like button, comment post,
 * reaction burst, watch-party join, clip create, etc.).
 */
export function dispatchEngagement(streamId: string, boost = 5) {
  if (typeof window === "undefined") return;
  window.dispatchEvent(new CustomEvent("mashahd:engagement", { detail: { streamId, boost } }));
}
