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
import { cn } from "@/lib/utils";
import type { Video } from "@/lib/types";

type FeedMode = "fyp" | "discovery" | "diversity";

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
  reasons?: string[][];
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

// §63 — Discovery feed: intentionally DIFFERENT from what the user normally
// watches. Returns a `reasons` array per video (same shape as FYP) so the
// VideoCard can show the "new_subject / new_creator / international / archived"
// badges alongside each card.
async function fetchDiscoveryFeed(bid: string): Promise<ForYouPayload> {
  if (!bid) return { videos: [], reasons: [] };
  const res = await fetch(`/api/feed/discovery?bid=${encodeURIComponent(bid)}&limit=24`);
  if (!res.ok) return { videos: [], reasons: [] };
  const data = await res.json();
  return {
    videos: (data.videos as Video[]) || [],
    reasons: (data.reasons as string[][]) || [],
  };
}

// §64 — Diversity feed: greedily maximizes diversity across creators,
// topics, formats, dates, and popularity. Returns videos without a reasons
// array (so the VideoCard shows no recommendation rationale for this mode).
async function fetchDiversityFeed(bid: string): Promise<ForYouPayload> {
  if (!bid) return { videos: [], reasons: [] };
  const res = await fetch(`/api/feed/diversity?bid=${encodeURIComponent(bid)}&limit=24`);
  if (!res.ok) return { videos: [], reasons: [] };
  const data = await res.json();
  return {
    videos: (data.videos as Video[]) || [],
    reasons: undefined,
  };
}

export function HomeView() {
  const [category, setCategory] = useState("All");
  const [mood, setMood] = useState<MoodId | null>(null);
  // §63-64 — feed mode toggle. Default is FYP (personalized). User can
  // switch to Discovery (intentionally different) or Diversity (max spread).
  const [feedMode, setFeedMode] = useState<FeedMode>("fyp");
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
    enabled: isDefaultHome && !!bid && feedMode === "fyp",
    staleTime: 60_000, // 1 min — personalized feed doesn't need to be real-time
  });

  // §63 — Discovery feed (intentionally different content).
  const { data: discoveryData, isLoading: discoveryLoading } = useQuery({
    queryKey: ["feed", "discovery", bid],
    queryFn: () => fetchDiscoveryFeed(bid),
    enabled: isDefaultHome && !!bid && feedMode === "discovery",
    staleTime: 60_000,
  });

  // §64 — Diversity feed (max-spread across creators/topics/formats).
  const { data: diversityData, isLoading: diversityLoading } = useQuery({
    queryKey: ["feed", "diversity", bid],
    queryFn: () => fetchDiversityFeed(bid),
    enabled: isDefaultHome && !!bid && feedMode === "diversity",
    staleTime: 60_000,
  });

  // The currently-active feed's data — used to decide whether the category
  // fallback is needed (only when the selected feed isn't ready yet).
  const activeFeedData =
    feedMode === "discovery"
      ? discoveryData
      : feedMode === "diversity"
        ? diversityData
        : fypData;

  // Category-specific feed — used when a category chip or mood is active,
  // or as a fallback when the selected feed isn't ready yet.
  const { data, isLoading, isError } = useQuery({
    queryKey: ["videos", "home", effectiveCategory],
    queryFn: () => fetchVideos({ category: effectiveCategory, sort: "recent" }),
    enabled: !isDefaultHome || !activeFeedData,
  });

  // Pick the active feed payload based on feedMode (only on default home).
  const feedPayload = activeFeedData;
  const feedLoading =
    feedMode === "discovery"
      ? discoveryLoading
      : feedMode === "diversity"
        ? diversityLoading
        : fypLoading;

  // On the default home, prefer the selected feed; otherwise use the
  // category feed. Fallback to category feed if the selected feed is empty.
  const showFeed =
    isDefaultHome && !!feedPayload && feedPayload.videos.length > 0;
  const displayVideos = showFeed ? feedPayload.videos : data;
  // Reasons are only meaningful on the personalized FYP + Discovery feeds —
  // category/mood feeds and Diversity don't return a `reasons` array.
  const displayReasons = showFeed ? feedPayload.reasons : undefined;
  const displayLoading = showFeed ? feedLoading : isLoading;

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
      {/* Feed mode toggles — §63-64. Three small toggle buttons next to
          the FYP badge area. "Discovery" fetches intentionally different
          content; "Diverse" maximizes creator/topic/format spread. */}
      {isDefaultHome && (
        <div className="px-4 sm:px-6 pt-3 pb-1 flex items-center gap-2 flex-wrap">
          <button
            onClick={() => setFeedMode("fyp")}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1 transition-colors",
              feedMode === "fyp"
                ? "text-gold bg-gold/10"
                : "text-muted-foreground hover:text-foreground bg-muted/40"
            )}
            aria-pressed={feedMode === "fyp"}
            title="Personalized for-you feed"
          >
            <span
              className={cn(
                "h-1.5 w-1.5 rounded-full",
                feedMode === "fyp" ? "bg-gold animate-pulse" : "bg-muted-foreground/60"
              )}
              aria-hidden
            />
            For You
          </button>
          <button
            onClick={() => setFeedMode("discovery")}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1 transition-colors",
              feedMode === "discovery"
                ? "text-teal-light bg-teal/20"
                : "text-muted-foreground hover:text-foreground bg-muted/40"
            )}
            aria-pressed={feedMode === "discovery"}
            title="Intentionally different content — new subjects, creators, languages"
          >
            Discovery
          </button>
          <button
            onClick={() => setFeedMode("diversity")}
            className={cn(
              "inline-flex items-center gap-1.5 text-xs font-medium rounded-full px-3 py-1 transition-colors",
              feedMode === "diversity"
                ? "text-rose bg-rose/15"
                : "text-muted-foreground hover:text-foreground bg-muted/40"
            )}
            aria-pressed={feedMode === "diversity"}
            title="Max spread across creators, topics, formats, dates"
          >
            Diverse
          </button>
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
