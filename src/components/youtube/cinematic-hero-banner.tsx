"use client";

import { useQuery } from "@tanstack/react-query";
import { Play, Eye, Users } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/store/app-store";
import { getImageUrl } from "@/lib/format";
import type { Video } from "@/lib/types";

/**
 * CinematicHeroBanner — a breath-catching featured video banner at the
 * top of the home page (Pass 80).
 *
 * Takes the most-viewed video from the feed and displays it as a
 * full-width cinematic banner with:
 *   - Blurred gradient backdrop from the thumbnail
 *   - Large title with gradient text
 *   - Channel name + view count + category
 *   - Play button CTA with gold gradient
 *   - Glassmorphism overlay for text legibility
 *   - Subtle entrance animation
 *
 * Algorithmic thinking: the hero is the most-viewed video — the one
 * the algorithm has highest confidence the user will enjoy. It creates
 * a " Netflix-style" premium feel that YouTube lacks on its home page.
 */

async function fetchHero(): Promise<Video | null> {
  const res = await fetch("/api/videos?sort=popular&limit=1");
  if (!res.ok) return null;
  const data = await res.json();
  return data.videos?.[0] || null;
}

export function CinematicHeroBanner() {
  const { navigate } = useAppStore();
  const { data: hero, isLoading } = useQuery({
    queryKey: ["hero-banner"],
    queryFn: fetchHero,
    staleTime: 60_000,
  });

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 pt-4">
        <Skeleton className="aspect-[21/9] w-full rounded-2xl" />
      </div>
    );
  }

  if (!hero) return null;

  return (
    <section
      className="relative px-4 sm:px-6 pt-4 cursor-pointer group animate-scale-in"
      onClick={() => navigate({ kind: "watch", videoId: hero.id })}
    >
      <div className="relative aspect-[21/9] sm:aspect-[21/8] w-full overflow-hidden rounded-2xl shadow-float">
        {/* Background image — fills the banner */}
        <img
          src={getImageUrl(hero.thumbnailUrl, hero.title)}
          alt={hero.title}
          className="absolute inset-0 h-full w-full object-cover transition-transform duration-700 group-hover:scale-105"
        />
        {/* Gradient overlays — left-to-right for text legibility */}
        <div className="absolute inset-0 bg-gradient-to-r from-black/80 via-black/40 to-transparent" />
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent to-transparent" />

        {/* Content overlay */}
        <div className="absolute inset-0 flex flex-col justify-end p-6 sm:p-8 md:p-10">
          {/* Category badge */}
          <div className="flex items-center gap-2 mb-2">
            <span className="px-2.5 py-1 rounded-full bg-[hsl(var(--gold)/0.2)] border border-gold/30 text-[10px] font-bold uppercase tracking-wider text-[hsl(var(--gold-light))] backdrop-blur">
              Featured
            </span>
            <span className="text-[10px] font-medium text-white/70 uppercase tracking-wider">
              {hero.category}
            </span>
          </div>

          {/* Title — large, gradient, cinematic */}
          <h1 className="text-xl sm:text-2xl md:text-3xl lg:text-4xl font-bold font-display text-white max-w-2xl leading-tight mb-2 line-clamp-2 drop-shadow-lg">
            {hero.title}
          </h1>

          {/* Meta row */}
          <div className="flex items-center gap-4 text-white/80 text-xs sm:text-sm mb-4">
            <span className="flex items-center gap-1.5">
              <Eye className="h-3.5 w-3.5" />
              {hero.views.toLocaleString()} views
            </span>
            <span className="flex items-center gap-1.5">
              <Users className="h-3.5 w-3.5" />
              {hero.channel?.name || "Unknown"}
            </span>
          </div>

          {/* Play CTA — gold gradient button */}
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate({ kind: "watch", videoId: hero.id });
            }}
            className="flex items-center gap-2 px-5 py-2.5 rounded-full bg-gradient-gold text-charcoal font-semibold text-sm shadow-glow hover:scale-105 transition-transform min-h-[44px] w-fit"
          >
            <Play className="h-4 w-4 fill-current" />
            Watch Now
          </button>
        </div>
      </div>
    </section>
  );
}
