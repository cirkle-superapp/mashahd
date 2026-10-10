"use client";

import { useState } from "react";
import { motion, AnimatePresence } from "framer-motion";
import { Sparkles, Zap, Flame, Coffee, Lightbulb, Mountain } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

/**
 * MoodEngine — the #1 feature that sets Mashahd apart from YouTube.
 *
 * Instead of YouTube's algorithmic feed (which optimizes for watch time →
 * doomscrolling), Mashahd optimizes for EMOTIONAL FIT. The user taps a
 * mood and the entire home feed transforms to match that emotional context.
 *
 * 6 moods: Chill, Focus, Hype, Cozy, Curious, Awe
 * Each mood maps to a set of vibe labels (from the CIRKLE BRAIN's AI
 * per-video vibe analysis). The feed filters by matching vibes.
 *
 * This is a fundamentally different discovery paradigm:
 *   YouTube: "what do you want to WATCH?"
 *   Mashahd: "how are you FEELING?"
 */

const MOODS = [
  { id: "chill", label: "Chill", icon: Coffee, color: "text-[hsl(var(--teal))]", bg: "bg-[hsl(var(--teal)/0.1)]", vibes: ["Cozy", "Calm", "Mellow", "Atmospheric", "Reflective"] },
  { id: "focus", label: "Focus", icon: Lightbulb, color: "text-[hsl(var(--gold))]", bg: "bg-[hsl(var(--gold)/0.1)]", vibes: ["Focused", "Analytical", "Curious", "Determined", "Rigorous"] },
  { id: "hype", label: "Hype", icon: Zap, color: "text-[hsl(var(--rose))]", bg: "bg-[hsl(var(--rose)/0.1)]", vibes: ["Energetic", "Intense", "Triumphant", "Adrenaline", "Hype"] },
  { id: "cozy", label: "Cozy", icon: Coffee, color: "text-[hsl(var(--gold))]", bg: "bg-[hsl(var(--gold)/0.15)]", vibes: ["Cozy", "Comforting", "Wholesome", "Mellow", "Calm"] },
  { id: "curious", label: "Curious", icon: Sparkles, color: "text-[hsl(var(--teal))]", bg: "bg-[hsl(var(--teal)/0.15)]", vibes: ["Curious", "Fascinating", "Mind-bending", "Awe", "Inspiring"] },
  { id: "awe", label: "Awe", icon: Mountain, color: "text-[hsl(var(--steel))]", bg: "bg-[hsl(var(--steel)/0.1)]", vibes: ["Awe", "Majestic", "Wild", "Serenity", "Wanderlust"] },
] as const;

export function MoodEngine() {
  const { navigate, searchDraft } = useAppStore();
  const [activeMood, setActiveMood] = useState<string | null>(null);

  const selectMood = (moodId: string | null) => {
    setActiveMood(moodId);
    if (moodId) {
      const mood = MOODS.find(m => m.id === moodId);
      if (mood) {
        // Navigate to search with the vibe as query — the home feed
        // will filter by matching vibe labels.
        navigate({ kind: "search", query: `vibe:${mood.label}` });
      }
    } else {
      navigate({ kind: "home" });
    }
  };

  return (
    <div className="flex flex-col items-center gap-4 py-8">
      <motion.h2
        initial={{ opacity: 0, y: 10 }}
        animate={{ opacity: 1, y: 0 }}
        className="text-2xl font-display text-center gradient-text-gold"
      >
        How are you feeling?
      </motion.h2>
      <p className="text-sm text-muted-foreground text-center max-w-md">
        Mashahd recommends videos by emotional fit, not watch time.
        Pick a mood and the feed transforms.
      </p>
      <div className="flex flex-wrap justify-center gap-3 mt-2">
        {MOODS.map((mood, i) => {
          const Icon = mood.icon;
          const isActive = activeMood === mood.id;
          return (
            <motion.button
              key={mood.id}
              initial={{ opacity: 0, scale: 0.8 }}
              animate={{ opacity: 1, scale: 1 }}
              transition={{ delay: i * 0.08 }}
              whileHover={{ scale: 1.05 }}
              whileTap={{ scale: 0.95 }}
              onClick={() => selectMood(isActive ? null : mood.id)}
              className={cn(
                "flex flex-col items-center gap-2 px-5 py-4 rounded-2xl border transition-all",
                isActive
                  ? cn("border-gold/40 shadow-glow", mood.bg)
                  : "border-border hover:border-gold/20 bg-surface/50"
              )}
            >
              <Icon className={cn("h-7 w-7", isActive ? mood.color : "text-muted-foreground")} />
              <span className={cn("text-sm font-medium", isActive ? "text-foreground" : "text-muted-foreground")}>
                {mood.label}
              </span>
            </motion.button>
          );
        })}
      </div>
      <AnimatePresence>
        {activeMood && (
          <motion.button
            initial={{ opacity: 0 }}
            animate={{ opacity: 1 }}
            exit={{ opacity: 0 }}
            onClick={() => selectMood(null)}
            className="text-xs text-muted-foreground hover:text-foreground mt-2"
          >
            ✕ Clear mood
          </motion.button>
        )}
      </AnimatePresence>
    </div>
  );
}
