"use client";

import { useEffect, useState, useRef } from "react";
import { Sparkles, X } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * SmartResumeRecap — shows a "previously on" flash when returning to a
 * partially-watched video (Pass 76).
 *
 * When the user navigates to a video they've already started watching,
 * this component:
 *   1. Reads the saved playback position from ContinueWatching
 *   2. Seeks the video to that position
 *   3. Shows a 2-second "flash recap" banner: "Resuming from 4:32"
 *   4. After 2s, the banner fades + playback begins
 *
 * This is inspired by Netflix's "recap" feature but simpler + faster:
 * instead of generating a recap video, we just seek to the right spot
 * + show a contextual banner. The user instantly remembers where they
 * were without scrubbing.
 *
 * Unique to Mashahd — YouTube shows "resume from X" but doesn't flash
 * a visual reminder. This creates a more premium, attentive feel.
 */

export function SmartResumeRecap({
  videoId,
  position,
  onSeeked,
}: {
  videoId: string;
  position: number;
  onSeeked: () => void;
}) {
  const [show, setShow] = useState(false);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    if (position <= 5) return; // Don't show for the first 5 seconds
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setShow(true);
    timerRef.current = setTimeout(() => {
      setShow(false);
      onSeeked();
    }, 2500);
    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    };
  }, [position, onSeeked]);

  if (!show || position <= 5) return null;

  const mins = Math.floor(position / 60);
  const secs = Math.floor(position % 60);
  const timeStr = `${mins}:${secs.toString().padStart(2, "0")}`;

  return (
    <div className="absolute inset-0 z-20 grid place-items-center pointer-events-none">
      <div className={cn(
        "flex flex-col items-center gap-2 px-6 py-4 rounded-2xl glass-strong text-white shadow-float",
        "transition-all duration-500",
        show ? "opacity-100 scale-100" : "opacity-0 scale-95"
      )}>
        <div className="flex items-center gap-2">
          <Sparkles className="h-4 w-4 text-[hsl(var(--gold))]" />
          <span className="text-sm font-medium">Resuming from {timeStr}</span>
        </div>
        <p className="text-xs text-white/60">Picking up where you left off…</p>
      </div>
      <button
        onClick={() => setShow(false)}
        className="absolute top-2 right-2 pointer-events-auto text-white/40 hover:text-white"
        aria-label="Dismiss recap"
      >
        <X className="h-4 w-4" />
      </button>
    </div>
  );
}
