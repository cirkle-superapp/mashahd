"use client";

import { useQuery } from "@tanstack/react-query";
import { Tv, Users, Radio } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

/**
 * LiveTVShelf — premium shelf showing live TV channels on the home page.
 *
 * Displays TV channels as horizontal cards with:
 *   - Channel logo
 *   - LIVE badge with pulse animation
 *   - Current program (nowPlaying)
 *   - Viewer count
 *   - Category badge
 *
 * Clicking a card navigates to the live TV channel watch view.
 *
 * Unique to Mashahd — no competitor has live TV channels integrated
 * alongside user-generated content in a single unified platform.
 */

interface LiveTVChannel {
  id: string;
  name: string;
  slug: string;
  logoUrl: string;
  description: string;
  category: string;
  country: string;
  language: string;
  streamUrl: string;
  streamType: string;
  isLive: boolean;
  isVerified: boolean;
  nowPlaying: string;
  nextProgram: string;
  viewers: number;
}

async function fetchLiveTV(): Promise<{ channels: LiveTVChannel[]; count: number }> {
  const res = await fetch("/api/live-tv-channels?limit=20");
  if (!res.ok) return { channels: [], count: 0 };
  return res.json();
}

export function LiveTVShelf() {
  const { navigate } = useAppStore();
  const { data, isLoading } = useQuery({
    queryKey: ["live-tv-channels"],
    queryFn: fetchLiveTV,
    refetchInterval: 30_000,
  });

  if (!isLoading && (!data?.channels || data.channels.length === 0)) return null;

  return (
    <section className="px-4 sm:px-6 pt-4 pb-2 animate-fade-up">
      <div className="flex items-center gap-2 mb-3">
        <span className="grid place-items-center h-7 w-7 rounded-full bg-red-600 text-white">
          <Tv className="h-3.5 w-3.5" />
        </span>
        <h2 className="text-base font-semibold font-display shelf-heading">Live TV</h2>
        <span className="text-xs text-muted-foreground">— channels streaming now</span>
        {data?.count ? (
          <span className="ml-2 text-xs font-medium px-2 py-0.5 rounded-full bg-red-600/10 text-red-600">
            {data.count} channels
          </span>
        ) : null}
      </div>
      <div className="flex gap-3 overflow-x-auto pb-2 custom-scroll-x">
        {isLoading
          ? Array.from({ length: 4 }).map((_, i) => (
              <div key={i} className="shrink-0 w-44">
                <Skeleton className="aspect-video w-full rounded-xl" />
                <Skeleton className="h-3 w-3/4 mt-2" />
                <Skeleton className="h-2.5 w-1/2 mt-1" />
              </div>
            ))
          : data!.channels.map((ch) => (
              <button
                key={ch.id}
                onClick={() => navigate({ kind: "live-tv", channelId: ch.id } as any)}
                className="shrink-0 w-44 sm:w-48 group text-left"
              >
                <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-soft transition-all duration-500 group-hover:shadow-glow group-hover:rounded-2xl">
                  {/* Channel logo or gradient background */}
                  {ch.logoUrl ? (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-black/40 to-black/80">
                      <img
                        src={ch.logoUrl}
                        alt={ch.name}
                        className="h-12 w-12 rounded-lg object-cover opacity-90"
                        loading="lazy"
                      />
                    </div>
                  ) : (
                    <div className="absolute inset-0 flex items-center justify-center bg-gradient-to-br from-[hsl(var(--gold)/0.15)] to-black/80">
                      <span className="text-2xl font-bold text-white/80">{ch.name.slice(0, 2)}</span>
                    </div>
                  )}

                  {/* LIVE badge */}
                  {ch.isLive && (
                    <div className="absolute top-2 left-2 flex items-center gap-1 px-2 py-0.5 rounded-full bg-red-600 text-white text-[10px] font-bold">
                      <span className="h-1.5 w-1.5 rounded-full bg-white animate-pulse" />
                      LIVE
                    </div>
                  )}

                  {/* Viewer count */}
                  {ch.viewers > 0 && (
                    <div className="absolute top-2 right-2 flex items-center gap-1 px-1.5 py-0.5 rounded-full bg-black/70 text-white text-[10px] font-medium backdrop-blur">
                      <Users className="h-2.5 w-2.5" />
                      {ch.viewers > 999 ? `${(ch.viewers / 1000).toFixed(1)}K` : ch.viewers}
                    </div>
                  )}

                  {/* Now playing */}
                  {ch.nowPlaying && (
                    <div className="absolute bottom-2 left-2 right-2">
                      <p className="text-white text-[10px] font-medium drop-shadow line-clamp-1">
                        {ch.nowPlaying}
                      </p>
                    </div>
                  )}
                </div>

                {/* Meta strip */}
                <div className="mt-2">
                  <p className="text-xs font-medium line-clamp-1 group-hover:text-foreground text-muted-foreground transition-colors">
                    {ch.name}
                  </p>
                  <p className="text-[11px] text-muted-foreground line-clamp-1">
                    {ch.category} {ch.country ? `· ${ch.country}` : ""}
                  </p>
                </div>
              </button>
            ))}
      </div>
    </section>
  );
}
