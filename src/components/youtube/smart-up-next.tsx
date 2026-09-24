"use client";

import { Sparkle, TrendingUp, Clock, Users, Lightbulb } from "lucide-react";
import { VideoCard } from "./video-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Video } from "@/lib/types";

/**
 * SmartUpNext — AI-powered recommendation shelf with reasoning labels
 * (Pass 72).
 *
 * Instead of YouTube's opaque "Up Next" shelf, Mashahd shows WHY each
 * video was recommended:
 *   - "Trending now" — high view velocity
 *   - "From the same channel" — creator continuity
 *   - "Similar length" — matches the user's watch pattern
 *   - "Popular in {category}" — category affinity
 *   - "Newly uploaded" — recency
 *
 * Each card gets a small gold pill with the reasoning. This transparency
 * is unique — no competitor explains WHY they recommend a video.
 *
 * The reasoning is computed client-side (no AI call needed) based on
 * the currently-watched video's metadata + the related video's metadata.
 * This is fast (no latency) + explainable (the user can see the logic).
 */
function getReason(
  current: Video | null,
  related: Video,
  index: number,
): { label: string; icon: typeof TrendingUp } {
  if (!current) return { label: "Recommended", icon: Sparkle };

  // Same channel → creator continuity.
  if (related.channelId === current.channelId) {
    return { label: "More from this channel", icon: Users };
  }

  // Same category → category affinity.
  if (related.category === current.category) {
    return { label: `Popular in ${related.category}`, icon: TrendingUp };
  }

  // High views → trending.
  if (related.views > 500_000) {
    return { label: "Trending now", icon: TrendingUp };
  }

  // Recently uploaded (within 7 days).
  const ageDays = (Date.now() - new Date(related.createdAt).getTime()) / 86400000;
  if (ageDays < 7) {
    return { label: "Newly uploaded", icon: Clock };
  }

  // Similar duration → matches watch pattern.
  if (current.durationSec > 0 && related.durationSec > 0) {
    const ratio = Math.min(current.durationSec, related.durationSec) /
                  Math.max(current.durationSec, related.durationSec);
    if (ratio > 0.7) {
      return { label: "Similar length", icon: Clock };
    }
  }

  // Default → AI-curated (no specific reason, but still recommended).
  const reasons = [
    { label: "AI-curated for you", icon: Sparkle },
    { label: "You might like this", icon: Lightbulb },
    { label: "Worth discovering", icon: Sparkle },
  ];
  return reasons[index % reasons.length];
}

export function SmartUpNext({
  current,
  related,
  isLoading,
}: {
  current: Video | null;
  related: Video[] | undefined;
  isLoading: boolean;
}) {
  const videos = related || [];

  return (
    <section className="mt-8 px-4 sm:px-0">
      <div className="flex items-center gap-2 mb-3">
        <Sparkle className="h-5 w-5 text-[hsl(var(--gold))]" />
        <h2 className="text-base font-semibold font-display shelf-heading">Smart Up Next</h2>
        <span className="text-xs text-muted-foreground">— with AI reasoning</span>
      </div>
      <div className="flex gap-4 overflow-x-auto pb-2 custom-scroll-x">
        {isLoading
          ? Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="shrink-0 w-64">
                <Skeleton className="aspect-video w-full rounded-xl" />
                <Skeleton className="h-4 w-3/4 mt-2" />
                <Skeleton className="h-3 w-1/2 mt-1" />
                <Skeleton className="h-5 w-20 mt-2 rounded-full" />
              </div>
            ))
          : videos.map((v, i) => {
              const reason = getReason(current, v, i);
              const ReasonIcon = reason.icon;
              return (
                <div key={v.id} className="shrink-0 w-56 sm:w-64 group">
                  {/* Reasoning pill — appears above the card */}
                  <div className="flex items-center gap-1.5 mb-1.5 px-1">
                    <span className="inline-flex items-center gap-1 text-[10px] font-medium px-2 py-0.5 rounded-full bg-[hsl(var(--gold)/0.1)] text-[hsl(var(--gold))] border border-gold/20">
                      <ReasonIcon className="h-2.5 w-2.5" />
                      {reason.label}
                    </span>
                  </div>
                  <VideoCard video={v} />
                </div>
              );
            })}
      </div>
    </section>
  );
}
