"use client";

import { useQuery } from "@tanstack/react-query";
import { VideoCard } from "./video-card";
import { Skeleton } from "@/components/ui/skeleton";
import type { Video } from "@/lib/types";

async function fetchByCategory(category: string) {
  const sp = new URLSearchParams();
  sp.set("category", category);
  sp.set("sort", "recent");
  const res = await fetch(`/api/videos?${sp.toString()}`);
  if (!res.ok) throw new Error("failed");
  const data = await res.json();
  return data.videos as Video[];
}

const META: Record<string, { tagline: string }> = {
  Music: { tagline: "Live sessions, lo-fi mixes, and original finds." },
  Gaming: { tagline: "High-skill gameplay, builds, and breakdowns." },
  News: { tagline: "What's happening, from people who were there." },
  Sports: { tagline: "Highlights, analysis, and the moments that mattered." },
  Learning: { tagline: "Curiosity, explained clearly." },
  Travel: { tagline: "Cinematic films from every corner of the globe." },
  Cooking: { tagline: "Approachable recipes you'll actually want to cook." },
  Fitness: { tagline: "Science-backed workouts for every level." },
  Tech: { tagline: "Modern web dev, deep-dives, and practical tutorials." },
  Science: { tagline: "How the world actually works." },
  Art: { tagline: "Painting, illustration, and creative process." },
  Nature: { tagline: "Documentary-grade wildlife footage." },
  Cars: { tagline: "Reviews, restorations, and the occasional bad idea." },
  Live: { tagline: "Broadcasting right now." },
};

/**
 * CategoryView — a full-screen browse for a single category, reached from
 * the sidebar "Explore" section. Every sidebar Explore item routes here.
 */
export function CategoryView({ category }: { category: string }) {
  const { data, isLoading, isError } = useQuery({
    queryKey: ["videos", "category", category],
    queryFn: () => fetchByCategory(category),
  });

  const meta = META[category];

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1500px] mx-auto">
      {/* Category header */}
      <div className="mb-6">
        <div className="flex items-baseline gap-3 flex-wrap">
          <h1 className="text-2xl sm:text-3xl font-bold font-display">{category}</h1>
          <span className="text-sm text-muted-foreground">
            {data?.length ?? 0} video{(data?.length || 0) === 1 ? "" : "s"}
          </span>
        </div>
        {meta?.tagline && (
          <p className="mt-1 text-sm text-muted-foreground">{meta.tagline}</p>
        )}
      </div>

      {isError && (
        <p className="text-destructive text-sm py-12 text-center">
          Could not load videos. Please try again.
        </p>
      )}

      <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 gap-x-4 gap-y-6">
        {isLoading
          ? Array.from({ length: 12 }).map((_, i) => (
              <div key={i} className="flex flex-col">
                <Skeleton className="aspect-video w-full rounded-xl" />
                <div className="flex gap-3 mt-3">
                  <Skeleton className="h-9 w-9 rounded-full" />
                  <div className="flex-1 space-y-2">
                    <Skeleton className="h-4 w-full" />
                    <Skeleton className="h-3 w-2/3" />
                  </div>
                </div>
              </div>
            ))
          : data?.map((v) => <VideoCard key={v.id} video={v} />)}
      </div>

      {!isLoading && data && data.length === 0 && (
        <div className="text-center py-24 text-muted-foreground">
          <p className="text-lg font-medium">No {category} videos yet</p>
          <p className="text-sm mt-1">Check back soon — new content is added regularly.</p>
        </div>
      )}
    </div>
  );
}
