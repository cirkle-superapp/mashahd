"use client";

import { useState, useEffect, useCallback } from "react";
import { cn } from "@/lib/utils";

/**
 * ReactionBurst — floating emoji reactions overlay on the video player
 * (Pass 73).
 *
 * When the viewer clicks a reaction button (👍❤️🔥😂😮), the emoji
 * floats up from the bottom of the video + fades out — like TikTok's
 * live reactions or Twitch chat emotes.
 *
 * Each emoji:
 *   - Starts at a random X position near the bottom
 *   - Floats upward with a slight horizontal drift
 *   - Scales from 0.5 → 1.2 → 0.8 (bounce effect)
 *   - Fades out after 2.5s
 *   - Has a random rotation for organic feel
 *
 * Multiple emojis can be in flight simultaneously. The overlay sits
 * above the video but below the controls (pointer-events-none so it
 * doesn't block clicks).
 *
 * Unique to Mashahd — YouTube has a static "react" bar, but no
 * floating emoji animation. TikTok has live reactions but only on
 * live streams. Mashahd has them on ALL videos.
 */

interface FloatingEmoji {
  id: number;
  emoji: string;
  x: number; // 0-100 (% of video width)
  drift: number; // horizontal drift in px
  rotation: number; // degrees
  scale: number; // initial scale
}

const EMOJI_LIFETIME = 2500; // ms
const MAX_EMOJIS = 30; // cap to prevent perf issues

export function ReactionBurst() {
  const [emojis, setEmojis] = useState<FloatingEmoji[]>([]);
  const idRef = useState(0);

  // Spawn a floating emoji.
  const spawn = useCallback((emoji: string) => {
    const id = Date.now() + Math.random();
    const newEmoji: FloatingEmoji = {
      id,
      emoji,
      x: 15 + Math.random() * 70, // 15-85% of width
      drift: (Math.random() - 0.5) * 80, // -40 to +40px drift
      rotation: (Math.random() - 0.5) * 30, // -15 to +15 degrees
      scale: 0.6 + Math.random() * 0.4, // 0.6-1.0 initial scale
    };

    setEmojis((prev) => {
      // Cap the number of floating emojis.
      const capped = prev.length >= MAX_EMOJIS
        ? [...prev.slice(MAX_EMOJIS - 5), newEmoji]
        : [...prev, newEmoji];
      return capped;
    });

    // Remove the emoji after its lifetime.
    setTimeout(() => {
      setEmojis((prev) => prev.filter((e) => e.id !== id));
    }, EMOJI_LIFETIME);
  }, []);

  // Listen for global reaction events (from the reaction bar or watch view).
  useEffect(() => {
    const onReaction = (e: Event) => {
      const emoji = (e as CustomEvent).detail?.emoji;
      if (emoji) spawn(emoji);
    };
    window.addEventListener("mashahd:reaction", onReaction as EventListener);
    return () => window.removeEventListener("mashahd:reaction", onReaction as EventListener);
  }, [spawn]);

  if (emojis.length === 0) return null;

  return (
    <div className="absolute inset-0 pointer-events-none overflow-hidden z-15">
      {emojis.map((e) => (
        <div
          key={e.id}
          className="absolute bottom-0 text-2xl sm:text-3xl select-none"
          style={{
            left: `${e.x}%`,
            animation: `reaction-float ${EMOJI_LIFETIME}ms ease-out forwards`,
            // CSS custom properties for the keyframe animation
            ["--drift" as any]: `${e.drift}px`,
            ["--rotation" as any]: `${e.rotation}deg`,
            ["--initial-scale" as any]: e.scale,
          }}
        >
          {e.emoji}
        </div>
      ))}
    </div>
  );
}

/**
 * Convenience function to fire a reaction from anywhere.
 * Usage: fireReaction("🔥")
 */
export function fireReaction(emoji: string) {
  window.dispatchEvent(new CustomEvent("mashahd:reaction", { detail: { emoji } }));
}
