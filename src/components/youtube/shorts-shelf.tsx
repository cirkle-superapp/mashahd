"use client";

import { useQuery } from "@tanstack/react-query";
import { Flame, Play } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/store/app-store";
import type { Video } from "@/lib/types";

async function fetchShorts() {
  // Shorts = the 8 most-viewed videos, repurposed as vertical shorts.
  const res = await fetch("/api/videos?sort=popular");
  if (!res.ok) throw new Error("failed");
  const data = await res.json();
  return (data.videos as Video[]).slice(0, 10);
}

/**
 * ShortsShelf — a horizontal carousel of vertical short-form videos.
 * Adapted from CIRKLE's mosaic-stories overlay. Each short is a tall card
 * with the thumbnail, a play affordance, and a compact meta strip.
 */
export function ShortsShelf() {
  const { data, isLoading } = useQuery({
    queryKey: ["videos", "shorts"],
    queryFn: fetchShorts,
  });
  const { navigate } = useAppStore();

  if (!isLoading && (!data || data.length === 0)) return null;

  return (
    <section className="px-4 sm:px-6 pt-4 pb-2">
      <div className="flex items-center gap-2 mb-3">
        <Flame className="h-5 w-5 text-gold" />
        <h2 className="text-base font-semibold font-display">Shorts</h2>
        <span className="text-xs text-muted-foreground">— bite-sized picks</span>
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 custom-scroll-x">
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="shrink-0 w-40 sm:w-44">
                <Skeleton className="aspect-[9/16] w-full rounded-xl" />
                <Skeleton className="h-3 w-3/4 mt-2" />
                <Skeleton className="h-2.5 w-1/2 mt-1" />
              </div>
            ))
          : data!.map((v) => (
              <button
                key={v.id}
                onClick={() => navigate({ kind: "watch", videoId: v.id })}
                className="shrink-0 w-40 sm:w-44 group text-left"
              >
                <div className="relative aspect-[9/16] w-full overflow-hidden rounded-xl bg-muted shadow-soft">
                  <img
                    src={v.thumbnailUrl}
                    alt={v.title}
                    loading="lazy"
                    className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-105"
                  />
                  {/* gradient overlay */}
                  <div className="absolute inset-0 bg-gradient-to-t from-black/70 via-transparent to-transparent" />
                  {/* play affordance on hover */}
                  <div className="absolute inset-0 grid place-items-center opacity-0 group-hover:opacity-100 transition-opacity">
                    <span className="grid place-items-center h-11 w-11 rounded-full bg-white/90 text-charcoal shadow-glass">
                      <Play className="h-5 w-5 fill-current ml-0.5" />
                    </span>
                  </div>
                  {/* views badge */}
                  <span className="absolute bottom-2 left-2 text-white text-[11px] font-medium tabular-nums">
                    {formatShort(v.views)} views
                  </span>
                </div>
                <p className="mt-1.5 text-xs font-medium leading-snug line-clamp-2">
                  {v.title}
                </p>
                <p className="text-[11px] text-muted-foreground truncate">
                  {v.channel.name}
                </p>
              </button>
            ))}
      </div>
    </section>
  );
}

function formatShort(n: number) {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
