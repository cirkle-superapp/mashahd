"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { VideoCard } from "./video-card";
import { CategoryChips } from "./category-chips";
import { MoodFilter, moodToCategory, type MoodId } from "./mood-filter";
import { ShortsShelf } from "./shorts-shelf";
import { TrendingDigest } from "./trending-digest";
import { ContinueWatchingShelf } from "./continue-watching-shelf";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrowserId } from "@/hooks/use-browser-id";
import type { Video } from "@/lib/types";

async function fetchVideos(params: { category?: string; sort?: string }) {
  const sp = new URLSearchParams();
  if (params.category && params.category !== "All") sp.set("category", params.category);
  if (params.sort) sp.set("sort", params.sort);
  const res = await fetch(`/api/videos?${sp.toString()}`);
  if (!res.ok) throw new Error("failed");
  const data = await res.json();
  return data.videos as Video[];
}

// Pass 4 upgrade: personalized "For You" feed via /api/feed/for-you.
// Uses the signed browserId to build a category + channel affinity profile.
// Pass 5 upgrade: also surfaces the `reasons` array per video (§8 transparency).
interface ForYouPayload {
  videos: Video[];
  reasons: string[][];
}

async function fetchForYou(bid: string): Promise<ForYouPayload> {
  if (!bid) return { videos: [], reasons: [] };
  const res = await fetch(`/api/feed/for-you?bid=${encodeURIComponent(bid)}&limit=24`);
  if (!res.ok) return { videos: [], reasons: [] };
  const data = await res.json();
  return {
    videos: (data.videos as Video[]) || [],
    reasons: (data.reasons as string[][]) || [],
  };
}

export function HomeView() {
  const [category, setCategory] = useState("All");
  const [mood, setMood] = useState<MoodId | null>(null);
  const bid = useBrowserId();

  // When a mood is active, derive a category from it (overrides the chip
  // selection so the two don't fight each other).
  const effectiveCategory = useMemo(() => {
    if (mood) return moodToCategory(mood) || "All";
    return category;
  }, [mood, category]);

  // Personalized FYP feed — only on the default home view (no mood, "All"
  // category). This is the YouTube-style "For You" experience.
  const isDefaultHome = !mood && effectiveCategory === "All";
  const { data: fypData, isLoading: fypLoading } = useQuery({
    queryKey: ["feed", "for-you", bid],
    queryFn: () => fetchForYou(bid),
    enabled: isDefaultHome && !!bid,
    staleTime: 60_000, // 1 min — personalized feed doesn't need to be real-time
  });

  // Category-specific feed — used when a category chip or mood is active,
  // or as a fallback when FYP isn't ready yet.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["videos", "home", effectiveCategory],
    queryFn: () => fetchVideos({ category: effectiveCategory, sort: "recent" }),
    enabled: !isDefaultHome || !fypData,
  });

  // On the default home, prefer FYP data; otherwise use the category feed.
  const showFyp = isDefaultHome && fypData && fypData.videos.length > 0;
  const displayVideos = showFyp ? fypData.videos : data;
  // Reasons are only meaningful on the personalized FYP — category/mood
  // feeds don't return a `reasons` array.
  const displayReasons = showFyp ? fypData.reasons : undefined;
  const displayLoading = showFyp ? fypLoading : isLoading;

  return (
    <div>
      <CategoryChips active={mood ? "All" : category} onSelect={(c) => { setCategory(c); setMood(null); }} />
      <div className="pt-2 pb-1">
        <MoodFilter active={mood} onSelect={setMood} />
      </div>
      {/* AI Trending Digest — only on the default home feed, where it
          reinforces Mashahd's AI-native identity with a curated editorial
          wrap-up of today's trending videos. */}
      {isDefaultHome && <TrendingDigest />}
      {/* Continue Watching shelf — shows unfinished videos with resume positions.
          Per spec §32. Only on the default home view. */}
      {isDefaultHome && <ContinueWatchingShelf />}
      {/* Shorts shelf — only on the default home feed (not when a mood or
          specific category is selected). */}
      {isDefaultHome && <ShortsShelf />}
      {/* "For You" badge — signals to the user that the feed is personalized. */}
      {showFyp && (
        <div className="px-4 sm:px-6 pt-3 pb-1">
          <span className="inline-flex items-center gap-1.5 text-xs font-medium text-gold bg-gold/10 rounded-full px-3 py-1">
            <span className="h-1.5 w-1.5 rounded-full bg-gold animate-pulse" aria-hidden />
            For You — personalized recommendations
          </span>
        </div>
      )}
      <div className="px-4 sm:px-6 py-4">
        {mood && (
          <p className="text-xs text-muted-foreground mb-3">
            Showing{" "}
            <span className="text-[hsl(var(--gold))] font-medium">{mood}</span> picks
            from {effectiveCategory === "All" ? "all categories" : effectiveCategory}.
          </p>
        )}
        {isError && (
          <p className="text-destructive text-sm py-12 text-center">
            Could not load videos. Please try again.
          </p>
        )}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-4 gap-y-6">
          {displayLoading
            ? Array.from({ length: 18 }).map((_, i) => <VideoCardSkeleton key={i} />)
            : displayVideos?.map((v, i) => (
                <VideoCard
                  key={v.id}
                  video={v}
                  reasons={displayReasons?.[i]}
                />
              ))}
        </div>
        {!displayLoading && displayVideos && displayVideos.length === 0 && (
          <div className="text-center py-24 text-muted-foreground">
            <p className="text-lg font-medium">No videos in this category yet</p>
            <p className="text-sm mt-1">Try another category chip above.</p>
          </div>
        )}
      </div>
    </div>
  );
}

export function VideoCardSkeleton() {
  return (
    <div className="flex flex-col">
      <Skeleton className="aspect-video w-full rounded-xl" />
      <div className="flex gap-3 mt-3">
        <Skeleton className="h-9 w-9 rounded-full" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-4 w-full" />
          <Skeleton className="h-4 w-2/3" />
          <Skeleton className="h-3 w-1/2 mt-2" />
        </div>
      </div>
    </div>
  );
}
