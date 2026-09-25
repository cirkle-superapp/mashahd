"use client";

import { Film, Coffee, Mountain, Zap, Heart, Brain, Palette } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * VideoMoodRing — AI-style mood tags on video cards (Pass 72).
 *
 * Computes a "mood" for each video based on its metadata (category, tags,
 * duration, view velocity). The mood appears as a small colored pill on
 * the video card thumbnail — like a "mood ring" for content.
 *
 * No AI call needed — the mood is computed deterministically from the
 * video's metadata. This is fast (zero latency) + explainable.
 *
 * Mood categories:
 *   🎬 Cinematic — long + high views + visual tags
 *   ☕ Relaxing — music/travel/nature + long duration
 *   🏔 Epic — gaming/sports + high views
 *   ⚡ Energetic — fitness/sports + short duration
 *   💝 Heartwarming — cooking/art + medium duration
 *   🧠 Educational — tech/science/learning + any duration
 *   🎨 Creative — art + any duration
 */
type Mood = {
  label: string;
  icon: typeof Film;
  color: string;
};

function computeMood(video: { category: string; tags?: string; durationSec: number; views: number }): Mood | null {
  const cat = video.category?.toLowerCase() || "";
  const tags = (video.tags || "").toLowerCase();
  const dur = video.durationSec;
  const views = video.views;

  // Cinematic — long + high views + visual keywords
  if (dur > 600 && views > 100_000 && (tags.includes("cinematic") || tags.includes("film") || cat === "travel" || cat === "nature")) {
    return { label: "Cinematic", icon: Film, color: "text-violet-400 bg-violet-500/10 border-violet-500/30" };
  }

  // Relaxing — music/travel/nature + long
  if ((cat === "music" || cat === "travel" || cat === "nature") && dur > 300) {
    return { label: "Relaxing", icon: Coffee, color: "text-emerald-400 bg-emerald-500/10 border-emerald-500/30" };
  }

  // Epic — gaming/sports + high views
  if ((cat === "gaming" || cat === "cars") && views > 50_000) {
    return { label: "Epic", icon: Mountain, color: "text-amber-400 bg-amber-500/10 border-amber-500/30" };
  }

  // Energetic — fitness/sports + short
  if ((cat === "fitness" || cat === "sports") && dur < 300) {
    return { label: "Energetic", icon: Zap, color: "text-orange-400 bg-orange-500/10 border-orange-500/30" };
  }

  // Heartwarming — cooking/art
  if (cat === "cooking" || cat === "art") {
    return { label: "Heartwarming", icon: Heart, color: "text-rose-400 bg-rose-500/10 border-rose-500/30" };
  }

  // Educational — tech/science/learning
  if (cat === "tech" || cat === "science" || tags.includes("tutorial") || tags.includes("learn")) {
    return { label: "Educational", icon: Brain, color: "text-sky-400 bg-sky-500/10 border-sky-500/30" };
  }

  // Creative — art
  if (cat === "art") {
    return { label: "Creative", icon: Palette, color: "text-fuchsia-400 bg-fuchsia-500/10 border-fuchsia-500/30" };
  }

  // No mood detected — return null (no pill shown).
  return null;
}

export function VideoMoodRing({ video }: { video: { category: string; tags?: string; durationSec: number; views: number } }) {
  const mood = computeMood(video);
  if (!mood) return null;

  const Icon = mood.icon;
  return (
    <span className={cn(
      "inline-flex items-center gap-1 px-1.5 py-0.5 rounded-full text-[9px] font-medium border backdrop-blur-sm",
      mood.color,
    )}>
      <Icon className="h-2.5 w-2.5" />
      {mood.label}
    </span>
  );
}
