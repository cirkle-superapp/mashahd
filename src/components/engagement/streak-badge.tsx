"use client";

import { useQuery } from "@tanstack/react-query";
import { Flame, Trophy, Target } from "lucide-react";
import { useBrowserId } from "@/hooks/use-browser-id";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * StreakBadge — a gamification badge showing the user's watch streak.
 *
 * Unique to Mashahd (no competitor does this — like Duolingo's flame
 * but for video watching). Shows:
 *   - Current streak (consecutive days watched) with a flame icon
 *   - Daily goal progress (X/Y videos today)
 *   - Longest streak (all-time best) with a trophy icon
 *
 * The badge animates when the streak increments (isNewStreak=true).
 * Fetches from /api/streak?bid=<bid>. Updates when a video is watched
 * (the watch view POSTs to /api/streak on playback start).
 *
 * Placement: top-right of the home feed, above the category chips.
 */
async function fetchStreak(bid: string) {
  if (!bid) return null;
  const res = await fetch(`/api/streak?bid=${encodeURIComponent(bid)}`);
  if (!res.ok) return null;
  const data = await res.json();
  return data.streak;
}

export function StreakBadge() {
  const bid = useBrowserId();
  const { data: streak } = useQuery({
    queryKey: ["streak", bid],
    queryFn: () => fetchStreak(bid),
    enabled: !!bid,
    refetchInterval: 60_000, // refresh every 60s
  });

  if (!bid || !streak || streak.currentStreak === 0) return null;

  const goalMet = streak.videosToday >= streak.dailyGoal;
  const progressPct = Math.min(100, (streak.videosToday / streak.dailyGoal) * 100);

  return (
    <div className="flex items-center gap-2 px-3 py-1.5 rounded-full bg-card border border-gold/20 shadow-soft">
      {/* Flame — current streak */}
      <div className="flex items-center gap-1">
        <Flame
          className={cn(
            "h-4 w-4 transition-all",
            streak.currentStreak >= 7 ? "text-orange-500 fill-orange-500/20" : "text-gold",
            streak.currentStreak >= 3 && "animate-pulse"
          )}
        />
        <span className="text-sm font-bold tabular-nums text-foreground">
          {streak.currentStreak}
        </span>
      </div>

      {/* Separator */}
      <div className="h-4 w-px bg-border" />

      {/* Daily goal progress */}
      <div className="flex items-center gap-1.5">
        <Target className="h-3.5 w-3.5 text-muted-foreground" />
        <div className="flex items-center gap-1">
          <span className={cn("text-xs font-medium tabular-nums", goalMet ? "text-emerald-500" : "text-muted-foreground")}>
            {streak.videosToday}
          </span>
          <span className="text-xs text-muted-foreground">/ {streak.dailyGoal}</span>
        </div>
        {/* Mini progress bar */}
        <div className="w-12 h-1.5 rounded-full bg-muted overflow-hidden">
          <div
            className={cn(
              "h-full transition-all duration-500",
              goalMet ? "bg-emerald-500" : "bg-gradient-gold"
            )}
            style={{ width: `${progressPct}%` }}
          />
        </div>
      </div>

      {/* Longest streak — only show if > current */}
      {streak.longestStreak > streak.currentStreak && (
        <>
          <div className="h-4 w-px bg-border" />
          <div className="flex items-center gap-1" title={`Longest streak: ${streak.longestStreak} days`}>
            <Trophy className="h-3.5 w-3.5 text-amber-500" />
            <span className="text-xs font-medium tabular-nums text-muted-foreground">
              {streak.longestStreak}
            </span>
          </div>
        </>
      )}
    </div>
  );
}
