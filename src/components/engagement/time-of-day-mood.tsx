"use client";

import { useEffect, useState } from "react";
import { Sun, Coffee, Sunset, Moon } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * TimeOfDayMood — AI-style automatic mood selection (Pass 76).
 *
 * Reads the user's local time + day of week to auto-select a mood for
 * the home feed. The selected mood appears as a subtle suggestion chip
 * that the user can accept (click) or ignore.
 *
 * Algorithmic thinking:
 *   - 6-10am weekdays → "Focus" (morning productivity)
 *   - 6-10am weekends → "Curious" (leisure morning)
 *   - 10am-2pm → "Hype" (energy peak)
 *   - 2-6pm → "Curious" (afternoon exploration)
 *   - 6-9pm → "Chill" (evening wind-down)
 *   - 9pm-6am → "Cozy" (night relaxation)
 *
 * This makes the app feel ALIVE — it knows what the user probably wants
 * based on when they're using it. No competitor does this.
 */

type TimeMood = {
  mood: string;
  icon: typeof Sun;
  label: string;
  greeting: string;
};

function getTimeMood(): TimeMood {
  const now = new Date();
  const hour = now.getHours();
  const isWeekend = now.getDay() === 0 || now.getDay() === 6;

  if (hour >= 6 && hour < 10) {
    return isWeekend
      ? { mood: "curious", icon: Coffee, label: "Curious", greeting: "Good morning" }
      : { mood: "focus", icon: Sun, label: "Focus", greeting: "Good morning" };
  }
  if (hour >= 10 && hour < 14) {
    return { mood: "hype", icon: Sun, label: "Hype", greeting: "Good day" };
  }
  if (hour >= 14 && hour < 18) {
    return { mood: "curious", icon: Coffee, label: "Curious", greeting: "Good afternoon" };
  }
  if (hour >= 18 && hour < 21) {
    return { mood: "chill", icon: Sunset, label: "Chill", greeting: "Good evening" };
  }
  // 9pm - 6am
  return { mood: "cozy", icon: Moon, label: "Cozy", greeting: "Good night" };
}

export function TimeOfDayMood({ onAccept }: { onAccept: (mood: string) => void }) {
  const [timeMood, setTimeMood] = useState<TimeMood | null>(null);
  const [dismissed, setDismissed] = useState(false);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setTimeMood(getTimeMood());
  }, []);

  if (!timeMood || dismissed) return null;
  const Icon = timeMood.icon;

  return (
    <div className="flex items-center gap-2 px-4 sm:px-6 pt-2 pb-1 animate-fade-up">
      <span className="text-xs text-muted-foreground">{timeMood.greeting},</span>
      <span className="text-xs text-muted-foreground">
        it feels like a
      </span>
      <button
        onClick={() => {
          onAccept(timeMood.mood);
          setDismissed(true);
        }}
        className="inline-flex items-center gap-1 text-xs font-medium px-2.5 py-1 rounded-full brand-chip hover:bg-gold/18 transition-colors min-h-[32px]"
      >
        <Icon className="h-3 w-3 text-[hsl(var(--gold))]" />
        {timeMood.label}
      </button>
      <span className="text-xs text-muted-foreground">kind of moment</span>
      <button
        onClick={() => setDismissed(true)}
        className="text-xs text-muted-foreground/60 hover:text-foreground ml-1"
        aria-label="Dismiss mood suggestion"
      >
        ✕
      </button>
    </div>
  );
}
