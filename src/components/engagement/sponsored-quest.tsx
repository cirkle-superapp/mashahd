"use client";

import { useState } from "react";
import { Gift, Play, Check, X, Loader2 } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { toast } from "sonner";

/**
 * SponsoredQuest — gamified micro-ads → Watch Rewards (Pass 102).
 *
 * THE UNIQUE AD FORMAT NO COMPETITOR HAS:
 *   Twitch has "Drops" (earn in-game items for watching sponsored streams).
 *   YouTube has "TrueView" (skippable pre-roll). Both are interruptive or
 *   tied to specific content.
 *
 *   Mashahd's SponsoredQuest is the OPPOSITE: users CHOOSE to engage with
 *   a brand's 15-second micro-experience (a product tour, a creator collab
 *   clip, a brand story). In return, they earn 50 Mashahd Points (redeemable
 *   for badges, emotes, premium features via the Watch Rewards system).
 *
 *   The ad is OPT-IN, GAMIFIED, and REWARD-DRIVEN. It feels like a mini-game,
 *   not an ad. Brands pay for genuine attention (not skip-bait), and viewers
 *   are compensated for their time. Win-win-win.
 *
 * Placement: appears as a compact card in the Watch Rewards section of the
 * watch view. Users tap "Start Quest" → a 15s branded overlay plays → points
 * are credited → quest card shows "Completed".
 *
 * Identity: ties into Mashahd's rewards/gamification identity (streaks,
 * watch rewards, hype trains). The quest is a natural extension of the
 * platform's engagement economy, not an injected ad unit.
 */
interface QuestAd {
  id: string;
  advertiser: string;
  headline: string;
  rewardPoints: number;
  durationSec: number;
  questType: string;
  targetUrl: string;
  disclosure: string;
}

export function SponsoredQuest() {
  const [active, setActive] = useState<QuestAd | null>(null);
  const [completed, setCompleted] = useState<string[]>([]);
  const [progress, setProgress] = useState(0);

  const { data } = useQuery<{ quests: QuestAd[] }>({
    queryKey: ["sponsored-quests"],
    queryFn: async () => {
      const res = await fetch("/api/ads?format=quests");
      if (!res.ok) return { quests: [] };
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const quests = data?.quests || [];
  if (quests.length === 0) return null;

  const startQuest = (q: QuestAd) => {
    setActive(q);
    setProgress(0);
  };

  // Simulate the 15s quest experience (in production, this would play a
  // real branded video clip). Progress bar fills over durationSec.
  const runQuest = (q: QuestAd) => {
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / (q.durationSec * 1000)) * 100);
      setProgress(pct);
      if (pct >= 100) {
        clearInterval(tick);
        setCompleted((c) => [...c, q.id]);
        setActive(null);
        setProgress(0);
        toast.success(`Quest complete! +${q.rewardPoints} points`, {
          description: `Thanks for engaging with ${q.advertiser}.`,
        });
        // Persist completion in localStorage (cosmetic — ties to Watch Rewards).
        try {
          const key = "mashahd-quest-completed";
          const prev = JSON.parse(localStorage.getItem(key) || "[]");
          localStorage.setItem(key, JSON.stringify([...prev, q.id]));
        } catch { /* ignore */ }
      }
    }, 100);
  };

  return (
    <>
      {/* Quest cards — compact, reward-forward */}
      <div className="space-y-2">
        {quests.filter((q) => !completed.includes(q.id)).slice(0, 1).map((q) => (
          <button
            key={q.id}
            onClick={() => startQuest(q)}
            className="w-full flex items-center gap-3 p-3 rounded-xl border border-gold/30 bg-gold/5 hover:bg-gold/10 transition-colors text-left group"
            aria-label={`Start sponsored quest: ${q.headline}. Earn ${q.rewardPoints} points.`}
          >
            <div className="grid place-items-center h-10 w-10 rounded-full bg-gradient-gold shrink-0">
              <Gift className="h-5 w-5 text-white" />
            </div>
            <div className="flex-1 min-w-0">
              <div className="flex items-center gap-1.5">
                <span className="text-[9px] text-muted-foreground uppercase tracking-wide">Sponsored Quest</span>
                <span className="text-[9px] text-gold font-semibold">+{q.rewardPoints} pts</span>
              </div>
              <div className="text-xs font-medium truncate">{q.headline}</div>
              <div className="text-[10px] text-muted-foreground">{q.durationSec}s · {q.advertiser}</div>
            </div>
            <Play className="h-4 w-4 text-gold group-hover:scale-110 transition-transform shrink-0" />
          </button>
        ))}
        {completed.length > 0 && (
          <div className="flex items-center gap-2 p-2 text-[10px] text-muted-foreground">
            <Check className="h-3 w-3 text-emerald-500" />
            {completed.length} quest{completed.length > 1 ? "s" : ""} completed this session
          </div>
        )}
      </div>

      {/* Quest overlay — the branded micro-experience */}
      {active && (
        <div className="fixed inset-0 z-[90] bg-black/90 backdrop-blur grid place-items-center p-4">
          <div className="relative w-full max-w-md aspect-video rounded-2xl overflow-hidden bg-gradient-to-br from-gold/20 to-black border border-gold/30">
            {/* Close (forfeits quest — no points) */}
            <button
              onClick={() => { setActive(null); setProgress(0); }}
              className="absolute top-2 right-2 z-20 text-white/70 hover:text-white p-1.5 rounded-full bg-black/40"
              aria-label="Forfeit quest"
            >
              <X className="h-4 w-4" />
            </button>

            {/* Branded content placeholder — in production this plays a real clip */}
            <div className="absolute inset-0 grid place-items-center text-center p-6">
              <div>
                <div className="text-4xl mb-3">✨</div>
                <div className="text-white/60 text-[10px] uppercase tracking-wide mb-1">{active.advertiser}</div>
                <div className="text-white font-semibold text-lg mb-2">{active.headline}</div>
                <div className="text-white/50 text-xs">{active.disclosure}</div>
              </div>
            </div>

            {/* Progress bar — fills over durationSec */}
            <div className="absolute bottom-0 left-0 right-0 h-1 bg-white/10">
              <div
                className="h-full bg-gradient-gold transition-[width] duration-100 ease-linear"
                style={{ width: `${progress}%` }}
              />
            </div>

            {/* Start button — kicks off the timer */}
            {progress === 0 && (
              <button
                onClick={() => runQuest(active)}
                className="absolute bottom-4 left-1/2 -translate-x-1/2 inline-flex items-center gap-1.5 px-5 py-2 rounded-full bg-gradient-gold text-white text-sm font-medium hover:scale-105 transition-transform"
              >
                <Play className="h-4 w-4 fill-current" /> Start Quest (+{active.rewardPoints} pts)
              </button>
            )}

            {progress > 0 && progress < 100 && (
              <div className="absolute bottom-4 left-1/2 -translate-x-1/2 text-white/80 text-xs flex items-center gap-1.5">
                <Loader2 className="h-3 w-3 animate-spin" /> Watching… {Math.round(progress)}%
              </div>
            )}
          </div>
        </div>
      )}
    </>
  );
}
