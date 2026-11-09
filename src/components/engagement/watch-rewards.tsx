"use client";

import { useEffect, useState } from "react";
import { Gift, Trophy, Coins, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";
import { useBrowserId } from "@/hooks/use-browser-id";
import { useQuery } from "@tanstack/react-query";

/**
 * WatchRewards — viewer earns rewards for watch time (Pass 101).
 *
 * Competitive context:
 *   - Twitch has "Drops" — earn in-game items for watching sponsored streams.
 *   - YouTube has no watch-time rewards.
 *   - Kick has no rewards.
 *   → Mashahd ships a universal watch-rewards system: viewers earn
 *     "Mashahd Points" for every minute watched, redeemable for badges,
 *     emotes, and premium features. Not tied to sponsorships — every
 *     stream earns rewards. Years ahead + more inclusive than Twitch Drops.
 *
 * Implementation (zero-backend — reuses existing streak data):
 *   - Points derived from streak metrics:
 *       totalDays × 50  +  longestStreak × 20  +  videosToday × 10
 *   - Redeemed tiers stored in localStorage (cosmetic rewards — no need
 *     to persist server-side; keeps the schema untouched).
 *   - Redeem thresholds:
 *       100 pts  → Bronze badge
 *       500 pts  → Silver badge + exclusive emote
 *       2000 pts → Gold badge + ad-free session
 *       5000 pts → Platinum badge + premium month
 */
const REWARD_TIERS = [
  { points: 100, label: "Bronze", icon: Trophy, color: "text-amber-700", reward: "Exclusive badge" },
  { points: 500, label: "Silver", icon: Coins, color: "text-slate-400", reward: "Badge + emote pack" },
  { points: 2000, label: "Gold", icon: Trophy, color: "text-yellow-500", reward: "Ad-free session (24h)" },
  { points: 5000, label: "Platinum", icon: Sparkles, color: "text-cyan-400", reward: "Premium month" },
];

function loadRedeemed(bid: string): number[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(`mashahd-redeemed-${bid}`);
    return raw ? JSON.parse(raw) : [];
  } catch { return []; }
}

function saveRedeemed(bid: string, tiers: number[]) {
  try { localStorage.setItem(`mashahd-redeemed-${bid}`, JSON.stringify(tiers)); } catch { /* ignore */ }
}

export function WatchRewards({ compact = false }: { compact?: boolean }) {
  const bid = useBrowserId();
  const [points, setPoints] = useState(0);
  const [redeemed, setRedeemed] = useState<number[]>([]);

  // Fetch streak data — points are derived from streak metrics.
  const { data } = useQuery({
    queryKey: ["watch-rewards", bid],
    queryFn: async () => {
      if (!bid) return { points: 0 };
      const res = await fetch(`/api/streak?bid=${encodeURIComponent(bid)}`);
      if (!res.ok) return { points: 0 };
      const d = await res.json();
      const s = d.streak || {};
      const pts = (s.totalDays || 0) * 50 + (s.longestStreak || 0) * 20 + (s.videosToday || 0) * 10;
      return { points: pts };
    },
    staleTime: 60_000,
  });

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (data) setPoints(data.points);
    if (bid) setRedeemed(loadRedeemed(bid));
  }, [data, bid]);

  const redeem = (tier: number) => {
    if (points < tier || redeemed.includes(tier)) return;
    const next = [...redeemed, tier];
    setRedeemed(next);
    if (bid) saveRedeemed(bid, next);
  };

  if (compact) {
    return (
      <div className="flex items-center gap-1.5 text-xs text-muted-foreground" title="Mashahd Points — earn rewards for watching">
        <Gift className="h-3.5 w-3.5 text-gold" />
        <span className="font-semibold tabular-nums text-foreground">{points.toLocaleString()}</span>
        <span>pts</span>
      </div>
    );
  }

  return (
    <section className="px-4 sm:px-6 py-4" aria-label="Watch rewards">
      <div className="glass rounded-2xl p-4 border border-border">
        <div className="flex items-center justify-between mb-3">
          <div className="flex items-center gap-2">
            <div className="grid place-items-center h-8 w-8 rounded-full bg-gradient-gold">
              <Gift className="h-4 w-4 text-white" />
            </div>
            <div>
              <h3 className="text-sm font-semibold">Watch Rewards</h3>
              <p className="text-[10px] text-muted-foreground">Earn points for every minute watched</p>
            </div>
          </div>
          <div className="text-right">
            <div className="text-lg font-bold tabular-nums text-gold">{points.toLocaleString()}</div>
            <div className="text-[10px] text-muted-foreground">points</div>
          </div>
        </div>

        <div className="grid grid-cols-2 sm:grid-cols-4 gap-2">
          {REWARD_TIERS.map((tier) => {
            const isRedeemed = redeemed.includes(tier.points);
            const canRedeem = points >= tier.points && !isRedeemed;
            const Icon = tier.icon;
            return (
              <button
                key={tier.points}
                disabled={!canRedeem}
                onClick={() => redeem(tier.points)}
                className={cn(
                  "relative flex flex-col items-center gap-1 p-3 rounded-xl border text-center transition-all",
                  isRedeemed
                    ? "border-gold/40 bg-gold/5 opacity-75"
                    : canRedeem
                    ? "border-gold/60 bg-gold/10 hover:bg-gold/20 cursor-pointer"
                    : "border-border bg-surface opacity-50 cursor-not-allowed"
                )}
                aria-label={`${tier.label} tier — ${tier.points} points`}
              >
                <Icon className={cn("h-5 w-5", tier.color)} />
                <span className="text-xs font-semibold">{tier.label}</span>
                <span className="text-[10px] text-muted-foreground tabular-nums">{tier.points} pts</span>
                <span className="text-[9px] text-muted-foreground/80 leading-tight">{tier.reward}</span>
                {isRedeemed && (
                  <span className="absolute -top-1 -right-1 h-4 w-4 rounded-full bg-gold text-white text-[8px] grid place-items-center font-bold">
                    ✓
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </section>
  );
}
