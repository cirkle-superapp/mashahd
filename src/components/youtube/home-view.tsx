"use client";

import { useState, useMemo } from "react";
import { useQuery } from "@tanstack/react-query";
import { VideoCard } from "./video-card";
import { CategoryChips } from "./category-chips";
import { MoodFilter, moodToCategory, type MoodId } from "./mood-filter";
import { Skeleton } from "@/components/ui/skeleton";
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

export function HomeView() {
  const [category, setCategory] = useState("All");
  const [mood, setMood] = useState<MoodId | null>(null);

  // When a mood is active, derive a category from it (overrides the chip
  // selection so the two don't fight each other).
  const effectiveCategory = useMemo(() => {
    if (mood) return moodToCategory(mood) || "All";
    return category;
  }, [mood, category]);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["videos", "home", effectiveCategory],
    queryFn: () => fetchVideos({ category: effectiveCategory, sort: "recent" }),
  });

  return (
    <div>
      <CategoryChips active={mood ? "All" : category} onSelect={(c) => { setCategory(c); setMood(null); }} />
      <div className="pt-2 pb-1">
        <MoodFilter active={mood} onSelect={setMood} />
      </div>
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
          {isLoading
            ? Array.from({ length: 18 }).map((_, i) => <VideoCardSkeleton key={i} />)
            : data?.map((v) => <VideoCard key={v.id} video={v} />)}
        </div>
        {!isLoading && data && data.length === 0 && (
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
