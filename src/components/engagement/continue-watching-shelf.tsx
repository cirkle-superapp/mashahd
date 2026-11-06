"use client";

import { useQuery } from "@tanstack/react-query";
import { Play, Clock } from "lucide-react";
import { useBrowserId } from "@/hooks/use-browser-id";
import { useAppStore } from "@/store/app-store";
import { Skeleton } from "@/components/ui/skeleton";
import { formatDuration, timeAgo, getImageUrl } from "@/lib/format";
import type { Video } from "@/lib/types";

/**
 * ContinueWatchingShelf — shows videos the user has started but not finished,
 * with resume positions. Per spec §32: "Synchronize playback state across devices."
 *
 * Fetches from /api/continue-watching?bid=... — returns items with position +
 * video data. Renders as a horizontal scroll shelf above the main feed.
 *
 * Only shown on the default home view when the user has unfinished videos.
 */
interface ContinueItem {
  videoId: string;
  position: number;
  completed: boolean;
  updatedAt: string;
  video: Video;
}

async function fetchContinueWatching(bid: string): Promise<ContinueItem[]> {
  if (!bid) return [];
  const res = await fetch(`/api/continue-watching?bid=${encodeURIComponent(bid)}`);
  if (!res.ok) return [];
  const data = await res.json();
  return (data.items || []).filter((i: ContinueItem) => i.video);
}

export function ContinueWatchingShelf() {
  const bid = useBrowserId();
  const { navigate } = useAppStore();

  const { data, isLoading } = useQuery({
    queryKey: ["continue-watching", bid],
    queryFn: () => fetchContinueWatching(bid),
    enabled: !!bid,
    staleTime: 30_000,
  });

  // Don't render the shelf if there are no items (or still loading with no cache).
  if (!isLoading && (!data || data.length === 0)) return null;

  return (
    <section className="px-4 sm:px-6 py-3" aria-label="Continue watching">
      <div className="flex items-center gap-2 mb-3">
        <Clock className="h-4 w-4 text-[hsl(var(--gold))]" aria-hidden />
        <h2 className="text-sm font-semibold shelf-heading">Continue watching</h2>
      </div>
      <div className="flex gap-3 overflow-x-auto custom-scroll-x pb-2">
        {isLoading
          ? Array.from({ length: 3 }).map((_, i) => (
              <div key={i} className="w-64 shrink-0">
                <Skeleton className="aspect-video w-full rounded-lg" />
                <Skeleton className="h-4 w-3/4 mt-2" />
              </div>
            ))
          : data?.map((item) => {
              const v = item.video;
              const pct = Math.min(100, Math.round((item.position / Math.max(1, v.durationSec)) * 100));
              return (
                <button
                  key={item.videoId}
                  onClick={() => navigate({ kind: "watch", videoId: v.id })}
                  className="w-64 shrink-0 group text-left"
                  aria-label={`Continue watching ${v.title} from ${formatDuration(item.position)}`}
                >
                  {/* Thumbnail with progress bar + play overlay */}
                  <div className="relative aspect-video w-full overflow-hidden rounded-lg bg-muted">
                    <img
                      src={getImageUrl(v.thumbnailUrl, v.title)}
                      alt={v.title}
                      loading="lazy"
                      className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
                    />
                    {/* Dark overlay on hover with play icon */}
                    <div className="absolute inset-0 bg-black/0 group-hover:bg-black/40 transition-colors flex items-center justify-center">
                      <div className="opacity-0 group-hover:opacity-100 transition-opacity grid place-items-center h-12 w-12 rounded-full bg-white/90 text-charcoal">
                        <Play className="h-5 w-5 fill-current ml-0.5" />
                      </div>
                    </div>
                    {/* Resume position badge */}
                    <span className="absolute bottom-1.5 left-1.5 bg-black/85 text-white text-[11px] font-medium px-1.5 py-0.5 rounded leading-none tabular-nums flex items-center gap-1">
                      <Clock className="h-3 w-3" aria-hidden />
                      {formatDuration(item.position)}
                    </span>
                    {/* Progress bar */}
                    <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/40">
                      <div
                        className="h-full bg-[hsl(var(--gold))]"
                        style={{ width: `${pct}%` }}
                      />
                    </div>
                  </div>
                  {/* Meta */}
                  <h3 className="text-sm font-medium leading-snug line-clamp-2 mt-2">
                    {v.title}
                  </h3>
                  <p className="text-xs text-muted-foreground mt-0.5 truncate">
                    {v.channel.name} • {timeAgo(new Date(item.updatedAt))}
                  </p>
                </button>
              );
            })}
      </div>
    </section>
  );
}
