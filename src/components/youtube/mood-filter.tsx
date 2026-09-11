"use client";

import { Coffee, Brain, Zap, Home as HomeIcon, Compass, Sparkles } from "lucide-react";
import { cn } from "@/lib/utils";

export const MOODS = [
  { id: "chill", label: "Chill", icon: Coffee, cats: ["Music", "Travel", "Nature"] },
  { id: "focus", label: "Focus", icon: Brain, cats: ["Tech", "Science", "Art"] },
  { id: "hype", label: "Hype", icon: Zap, cats: ["Gaming", "Cars", "Music"] },
  { id: "cozy", label: "Cozy", icon: HomeIcon, cats: ["Cooking", "Art", "Music"] },
  { id: "curious", label: "Curious", icon: Compass, cats: ["Science", "Tech", "Nature"] },
  { id: "awe", label: "Awe", icon: Sparkles, cats: ["Nature", "Travel", "Music"] },
] as const;

export type MoodId = (typeof MOODS)[number]["id"];

/**
 * Mood filter row — Mashahd, adapted from CIRKLE's mood-feed overlay.
 * Picking a mood cycles the home feed through the categories that match it.
 */
export function MoodFilter({
  active,
  onSelect,
}: {
  active: MoodId | null;
  onSelect: (m: MoodId | null) => void;
}) {
  return (
    <div className="flex items-center gap-2 overflow-x-auto px-4 sm:px-6 pb-1 custom-scroll-x">
      <span className="text-xs text-muted-foreground shrink-0 pr-1">Mood:</span>
      {MOODS.map((m) => {
        const Icon = m.icon;
        const isActive = active === m.id;
        return (
          <button
            key={m.id}
            onClick={() => onSelect(isActive ? null : m.id)}
            className={cn(
              "shrink-0 inline-flex items-center gap-1.5 px-3 py-1.5 rounded-full text-xs font-medium whitespace-nowrap transition-all border",
              isActive
                ? "border-transparent bg-gradient-to-br from-[hsl(var(--gold))] to-[hsl(var(--gold-dark))] text-black shadow-sm"
                : "border-border bg-muted/50 text-foreground hover:bg-accent"
            )}
          >
            <Icon className="h-3.5 w-3.5" />
            {m.label}
          </button>
        );
      })}
    </div>
  );
}

/** Resolve a mood to one of its matching categories (cycles on each call). */
export function moodToCategory(mood: MoodId | null): string | null {
  if (!mood) return null;
  const def = MOODS.find((m) => m.id === mood);
  if (!def) return null;
  return def.cats[Math.floor(Math.random() * def.cats.length)];
}
