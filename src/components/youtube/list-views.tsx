"use client";

import { useState } from "react";
import { useQuery } from "@tanstack/react-query";
import { Heart, Bookmark } from "lucide-react";
import { VideoCardHorizontal, VideoCard } from "./video-card";
import { Skeleton } from "@/components/ui/skeleton";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import type { Video } from "@/lib/types";
import { useAppStore } from "@/store/app-store";
import { useBrowserId } from "@/hooks/use-browser-id";
import { SmartPlaylistCreator } from "./smart-playlist-creator";

// Spec §12 — deterministic search sort options. The backend /api/videos
// endpoint supports all of these. `relevance` is the default for searches;
// non-search list views keep using `recent` (the API default).
type SearchSort =
  | "relevance"
  | "newest"
  | "oldest"
  | "most_viewed"
  | "least_viewed"
  | "longest"
  | "shortest";

const SEARCH_SORTS: { value: SearchSort; label: string }[] = [
  { value: "relevance", label: "Relevance" },
  { value: "newest", label: "Newest" },
  { value: "oldest", label: "Oldest" },
  { value: "most_viewed", label: "Most viewed" },
  { value: "least_viewed", label: "Least viewed" },
  { value: "longest", label: "Longest" },
  { value: "shortest", label: "Shortest" },
];

async function fetchVideosRaw(params: Record<string, string>) {
  const sp = new URLSearchParams(params);
  const res = await fetch(`/api/videos?${sp.toString()}`);
  if (!res.ok) throw new Error("failed");
  const data = await res.json();
  return data.videos as Video[];
}

async function fetchUserState(bid: string) {
  if (!bid) return { likedVideoIds: [], subscribedChannelIds: [], watchedVideoIds: [] };
  const res = await fetch(`/api/user-state?bid=${bid}`);
  if (!res.ok) throw new Error("failed");
  return res.json();
}

export function SearchView({ query }: { query: string }) {
  const [sort, setSort] = useState<SearchSort>("relevance");
  const { data, isLoading } = useQuery({
    queryKey: ["videos", "search", query, sort],
    queryFn: () => fetchVideosRaw({ q: query, sort }),
  });

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1100px] mx-auto">
      <h1 className="text-sm text-muted-foreground mb-3">
        Showing results for{" "}
        <span className="text-foreground font-medium">&ldquo;{query}&rdquo;</span>
        {data && (
          <span className="ml-2">— {data.length} video{data.length === 1 ? "" : "s"}</span>
        )}
      </h1>
      {/* Sort dropdown — spec §12 deterministic search sorts. Replaces the
          old 2-button filter with the full 7-option set backed by /api/videos. */}
      <div className="flex items-center gap-2 mb-4">
        <span className="text-xs text-muted-foreground">Sort:</span>
        <Select value={sort} onValueChange={(v) => setSort(v as SearchSort)}>
          <SelectTrigger size="sm" className="h-8 w-[160px] text-xs">
            <SelectValue />
          </SelectTrigger>
          <SelectContent>
            {SEARCH_SORTS.map((s) => (
              <SelectItem key={s.value} value={s.value}>
                {s.label}
              </SelectItem>
            ))}
          </SelectContent>
        </Select>
      </div>
      <div className="flex flex-col gap-4">
        {isLoading
          ? Array.from({ length: 8 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="w-[168px] sm:w-[280px] aspect-video rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                </div>
              </div>
            ))
          : data?.map((v) => <VideoCardHorizontal key={v.id} video={v} />)}
        {!isLoading && data && data.length === 0 && (
          <div className="py-16 text-center">
            <p className="text-lg font-medium">No results found</p>
            <p className="text-sm text-muted-foreground mt-1">
              Try different keywords or remove search filters.
            </p>
          </div>
        )}
      </div>
    </div>
  );
}

export function TrendingView() {
  const { data, isLoading } = useQuery({
    queryKey: ["videos", "trending"],
    queryFn: () => fetchVideosRaw({ sort: "trending" }),
  });

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto">
      <h1 className="text-2xl font-bold mb-6">Trending</h1>
      <div className="flex flex-col gap-5">
        {isLoading
          ? Array.from({ length: 10 }).map((_, i) => (
              <div key={i} className="flex gap-3">
                <Skeleton className="w-[280px] sm:w-[360px] aspect-video rounded-lg shrink-0" />
                <div className="flex-1 space-y-2">
                  <Skeleton className="h-5 w-3/4" />
                  <Skeleton className="h-4 w-1/2" />
                  <Skeleton className="h-3 w-1/3" />
                  <Skeleton className="h-3 w-2/3" />
                </div>
              </div>
            ))
          : data?.map((v, i) => <TrendingCard key={v.id} video={v} rank={i + 1} />)}
      </div>
    </div>
  );
}

function TrendingCard({ video, rank }: { video: Video; rank: number }) {
  const { navigate } = useAppStore();
  return (
    <div
      className="flex gap-4 cursor-pointer group"
      onClick={() => navigate({ kind: "watch", videoId: video.id })}
    >
      <div className="relative w-[240px] sm:w-[360px] shrink-0 aspect-video overflow-hidden rounded-xl bg-muted">
        <img
          src={video.thumbnailUrl}
          alt={video.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
        <span className="absolute bottom-1.5 right-1.5 bg-black/85 text-white text-[11px] font-medium px-1.5 py-0.5 rounded leading-none tabular-nums">
          {Math.floor(video.durationSec / 60)}:
          {String(video.durationSec % 60).padStart(2, "0")}
        </span>
      </div>
      <div className="hidden sm:flex items-start text-sm font-bold text-[hsl(var(--gold))] pt-1 shrink-0 w-6">
        {rank}
      </div>
      <div className="min-w-0 flex-1">
        <h3 className="text-base sm:text-lg font-medium leading-snug line-clamp-2">
          {video.title}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {video.channel.name} • {formatViewsShort(video.views)} views •{" "}
          {timeAgoShort(video.createdAt)}
        </p>
        <p className="mt-2 text-sm text-muted-foreground line-clamp-2 hidden md:block">
          {video.description}
        </p>
      </div>
    </div>
  );
}

function formatViewsShort(n: number) {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
}
function timeAgoShort(d: string) {
  const diff = Date.now() - new Date(d).getTime();
  const day = Math.floor(diff / (1000 * 60 * 60 * 24));
  if (day < 1) return "today";
  if (day < 7) return `${day} day${day === 1 ? "" : "s"} ago`;
  if (day < 30) return `${Math.floor(day / 7)} week${Math.floor(day / 7) === 1 ? "" : "s"} ago`;
  if (day < 365) return `${Math.floor(day / 30)} month${Math.floor(day / 30) === 1 ? "" : "s"} ago`;
  return `${Math.floor(day / 365)} year${Math.floor(day / 365) === 1 ? "" : "s"} ago`;
}

export function SubscriptionsView() {
  const bid = useBrowserId();
  // §48: subscription feed filters.
  const [filter, setFilter] = useState<"all" | "new" | "unwatched" | "long" | "short">("all");
  const { data: state } = useQuery({
    queryKey: ["user-state", bid],
    queryFn: () => fetchUserState(bid),
    enabled: !!bid,
  });
  const subIds = state?.subscribedChannelIds || [];
  const watchedIds = new Set(state?.watchedVideoIds || []);

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto">
      <div className="flex items-center justify-between gap-4 mb-2 flex-wrap">
        <h1 className="text-2xl font-bold">Subscriptions</h1>
        {subIds.length > 0 && (
          <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
            <SelectTrigger className="w-36 rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All videos</SelectItem>
              <SelectItem value="new">New (last 24h)</SelectItem>
              <SelectItem value="unwatched">Unwatched</SelectItem>
              <SelectItem value="long">Long-form (15min+)</SelectItem>
              <SelectItem value="short">Short (under 5min)</SelectItem>
            </SelectContent>
          </Select>
        )}
      </div>
      <p className="text-sm text-muted-foreground mb-6">
        Latest videos from channels you follow.
      </p>
      {subIds.length === 0 ? (
        <EmptyState
          title="No subscriptions yet"
          body="Subscribe to channels to see their newest uploads here."
        />
      ) : (
        <SubscriptionGrid subIds={subIds} filter={filter} watchedIds={watchedIds} />
      )}
    </div>
  );
}

function SubscriptionGrid({ subIds, filter, watchedIds }: { subIds: string[]; filter: string; watchedIds: Set<string> }) {
  // We fetch videos for all subscribed channels by passing channelId... but our
  // API only accepts a single channelId. So we fan out — fine for demo size.
  const queries = useQueriesForChannels(subIds);
  let all = queries.flatMap((q) => q.data || []);
  all.sort(
    (a, b) =>
      new Date(b.createdAt).getTime() - new Date(a.createdAt).getTime()
  );

  // §48: apply filter.
  if (filter === "new") {
    const oneDayAgo = Date.now() - 24 * 60 * 60 * 1000;
    all = all.filter((v) => new Date(v.createdAt).getTime() > oneDayAgo);
  } else if (filter === "unwatched") {
    all = all.filter((v) => !watchedIds.has(v.id));
  } else if (filter === "long") {
    all = all.filter((v) => v.durationSec >= 900);
  } else if (filter === "short") {
    all = all.filter((v) => v.durationSec < 300);
  }

  if (all.length === 0) {
    return (
      <EmptyState
        title={filter === "all" ? "No videos yet" : "No videos match this filter"}
        body={filter === "all"
          ? "The channels you follow haven't posted anything recently."
          : "Try a different filter or check back later."}
      />
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
      {all.map((v) => (
        <VideoCard key={v.id} video={v} />
      ))}
    </div>
  );
}

// helper hook for fan-out fetches
import { useQueries } from "@tanstack/react-query";
function useQueriesForChannels(channelIds: string[]) {
  return useQueries({
    queries: channelIds.map((id) => ({
      queryKey: ["videos", "channel", id],
      queryFn: () => fetchVideosRaw({ channelId: id, sort: "recent" }),
      enabled: !!id,
    })),
  });
}

export function HistoryView() {
  const bid = useBrowserId();
  // §25 filters: search query, creator, topic, duration, completed, saved.
  const [searchQuery, setSearchQuery] = useState("");
  const [categoryFilter, setCategoryFilter] = useState("all");
  const [durationFilter, setDurationFilter] = useState("all");
  const [showSavedOnly, setShowSavedOnly] = useState(false);
  const [sort, setSort] = useState<"recent" | "oldest" | "shortest" | "longest">("recent");

  const { data: state, isLoading } = useQuery({
    queryKey: ["user-state", bid],
    queryFn: () => fetchUserState(bid),
    enabled: !!bid,
  });
  const ids = state?.watchedVideoIds || [];
  const savedIds = new Set(state?.favoriteVideoIds || []);
  const { data, isLoading: vLoading } = useQuery({
    queryKey: ["videos", "history", ids.join("|")],
    queryFn: () =>
      fetchVideosRaw({ ids: ids.join("|"), sort: "recent" }),
    enabled: ids.length > 0,
  });

  // Apply client-side filters (§25).
  let filtered = data || [];
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter((v) =>
      v.title.toLowerCase().includes(q) ||
      v.channel.name.toLowerCase().includes(q) ||
      v.tags.toLowerCase().includes(q)
    );
  }
  if (categoryFilter !== "all") {
    filtered = filtered.filter((v) => v.category === categoryFilter);
  }
  if (durationFilter !== "all") {
    filtered = filtered.filter((v) => {
      const d = v.durationSec;
      if (durationFilter === "short") return d < 300;
      if (durationFilter === "medium") return d >= 300 && d <= 900;
      if (durationFilter === "long") return d > 900;
      return true;
    });
  }
  if (showSavedOnly) {
    filtered = filtered.filter((v) => savedIds.has(v.id));
  }
  // Sort.
  if (sort === "oldest") {
    // History is stored most-recent-first; reverse for oldest.
    filtered = [...filtered].reverse();
  } else if (sort === "shortest") {
    filtered = [...filtered].sort((a, b) => a.durationSec - b.durationSec);
  } else if (sort === "longest") {
    filtered = [...filtered].sort((a, b) => b.durationSec - a.durationSec);
  }

  // Collect unique categories from history for the filter dropdown.
  const categories = Array.from(new Set((data || []).map((v) => v.category))).filter(Boolean);

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1100px] mx-auto">
      <div className="flex items-center justify-between gap-4 mb-4 flex-wrap">
        <h1 className="text-2xl font-bold">Watch history</h1>
        {ids.length > 0 && (
          <span className="text-sm text-muted-foreground">{filtered.length} of {ids.length} videos</span>
        )}
      </div>

      {/* §25: Search + filters */}
      {ids.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 mb-6">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search watch history..."
            className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
            aria-label="Search watch history"
          />
          <Select value={categoryFilter} onValueChange={setCategoryFilter}>
            <SelectTrigger className="w-full sm:w-40 rounded-full">
              <SelectValue placeholder="Category" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All categories</SelectItem>
              {categories.map((c) => (
                <SelectItem key={c} value={c}>{c}</SelectItem>
              ))}
            </SelectContent>
          </Select>
          <Select value={durationFilter} onValueChange={setDurationFilter}>
            <SelectTrigger className="w-full sm:w-36 rounded-full">
              <SelectValue placeholder="Duration" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">Any duration</SelectItem>
              <SelectItem value="short">Under 5 min</SelectItem>
              <SelectItem value="medium">5–15 min</SelectItem>
              <SelectItem value="long">Over 15 min</SelectItem>
            </SelectContent>
          </Select>
          <Select value={sort} onValueChange={(v) => setSort(v as any)}>
            <SelectTrigger className="w-full sm:w-36 rounded-full">
              <SelectValue placeholder="Sort" />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="recent">Most recent</SelectItem>
              <SelectItem value="oldest">Oldest first</SelectItem>
              <SelectItem value="shortest">Shortest first</SelectItem>
              <SelectItem value="longest">Longest first</SelectItem>
            </SelectContent>
          </Select>
          <button
            onClick={() => setShowSavedOnly((s) => !s)}
            className={`inline-flex items-center gap-1.5 px-4 py-2 rounded-full text-sm border transition-colors whitespace-nowrap ${
              showSavedOnly
                ? "bg-rose/15 border-rose/40 text-rose"
                : "border-border hover:bg-muted"
            }`}
            aria-pressed={showSavedOnly}
          >
            <Heart className={`h-4 w-4 ${showSavedOnly ? "fill-current" : ""}`} />
            Saved only
          </button>
        </div>
      )}

      {isLoading || vLoading ? (
        <div className="space-y-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="w-[168px] sm:w-[280px] aspect-video rounded-lg shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : ids.length === 0 ? (
        <EmptyState
          title="No watch history yet"
          body="Videos you watch will show up here, in the order you watched them."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No videos match your filters"
          body="Try adjusting your search or filters above."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((v) => (
            <div key={v.id} className="relative">
              <VideoCardHorizontal video={v} />
              {savedIds.has(v.id) && (
                <span className="absolute top-2 right-2 text-rose" title="Saved">
                  <Heart className="h-4 w-4 fill-current" />
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

export function LikedView() {
  const bid = useBrowserId();
  const { data: state, isLoading } = useQuery({
    queryKey: ["user-state", bid],
    queryFn: () => fetchUserState(bid),
    enabled: !!bid,
  });
  const ids = state?.likedVideoIds || [];
  const { data, isLoading: vLoading } = useQuery({
    queryKey: ["videos", "liked", ids.join("|")],
    queryFn: () => fetchVideosRaw({ ids: ids.join("|") }),
    enabled: ids.length > 0,
  });

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto">
      <h1 className="text-2xl font-bold mb-6">Liked videos</h1>
      {isLoading || vLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-3/4 mt-2" />
            </div>
          ))}
        </div>
      ) : ids.length === 0 ? (
        <EmptyState
          title="No liked videos yet"
          body="Tap the thumbs-up on a video you enjoy and it'll be saved here."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
          {data?.map((v) => (
            <VideoCard key={v.id} video={v} />
          ))}
        </div>
      )}
    </div>
  );
}

export function LibraryView() {
  const bid = useBrowserId();
  const { data: state } = useQuery({
    queryKey: ["user-state", bid],
    queryFn: () => fetchUserState(bid),
    enabled: !!bid,
  });
  const { data: playlists } = useQuery({
    queryKey: ["playlists", bid],
    queryFn: async () => {
      const r = await fetch(`/api/playlists?bid=${bid}`);
      if (!r.ok) return [];
      return (await r.json()).playlists as {
        id: string; title: string; itemCount: number; coverUrl: string;
      }[];
    },
    enabled: !!bid,
  });

  const liked = state?.likedVideoIds?.length || 0;
  const subs = state?.subscribedChannelIds?.length || 0;
  const hist = state?.watchedVideoIds?.length || 0;
  const favs = state?.favoriteVideoIds?.length || 0;
  const wl = state?.watchLaterIds?.length || 0;
  const plCount = playlists?.length || 0;

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1200px] mx-auto space-y-8">
      <h1 className="text-2xl font-bold">Your library</h1>
      <div className="grid grid-cols-1 sm:grid-cols-3 gap-4">
        <LibraryCard title="History" count={hist} view={{ kind: "history" }} />
        <LibraryCard title="Liked videos" count={liked} view={{ kind: "liked" }} />
        <LibraryCard title="Subscriptions" count={subs} view={{ kind: "subscriptions" }} />
        <LibraryCard title="Favorites" count={favs} view={{ kind: "favorites" }} />
        <LibraryCard title="Watch Later" count={wl} view={{ kind: "watchLater" }} />
      </div>

      {/* Smart playlists (§30) — rule-based dynamic playlists.
          Rendered above regular playlists per task spec. */}
      <SmartPlaylistCreator />

      {/* Playlists — Mashahd's user-created video collections */}
      <div className="space-y-4">
        <div className="flex items-baseline justify-between">
          <h2 className="text-lg font-semibold">Your playlists</h2>
          <span className="text-xs text-muted-foreground">
            {plCount === 1 ? "1 playlist" : `${plCount} playlists`}
          </span>
        </div>
        {plCount === 0 ? (
          <div className="rounded-xl border border-dashed border-border p-8 text-center">
            <p className="text-sm text-muted-foreground">
              You haven&apos;t created any playlists yet.
            </p>
            <p className="text-xs text-muted-foreground mt-1">
              Open any video and tap <span className="font-medium text-foreground">Save</span> to start one.
            </p>
          </div>
        ) : (
          <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-4 gap-4">
            {playlists!.map((p) => (
              <PlaylistRow key={p.id} playlist={p} />
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

function PlaylistRow({
  playlist,
}: {
  playlist: { id: string; title: string; itemCount: number; coverUrl: string };
}) {
  const { navigate } = useAppStore();
  return (
    <button
      onClick={() => navigate({ kind: "playlist", playlistId: playlist.id })}
      className="text-left group"
    >
      <div className="relative aspect-video rounded-xl overflow-hidden bg-muted">
        {playlist.coverUrl ? (
          <img
            src={playlist.coverUrl}
            alt={playlist.title}
            className="absolute inset-0 w-full h-full object-cover group-hover:scale-105 transition-transform"
          />
        ) : (
          <div className="absolute inset-0 grid place-items-center text-muted-foreground">
            <ListMusicIcon />
          </div>
        )}
        <div className="absolute inset-0 bg-gradient-to-t from-black/60 via-transparent" />
        <div className="absolute bottom-2 left-2 right-2 flex items-center justify-between text-white text-xs">
          <span className="px-1.5 py-0.5 rounded bg-black/60 backdrop-blur">
            {playlist.itemCount} video{playlist.itemCount === 1 ? "" : "s"}
          </span>
        </div>
      </div>
      <p className="mt-1.5 text-sm font-medium truncate">{playlist.title}</p>
      <p className="text-xs text-muted-foreground">View full playlist</p>
    </button>
  );
}

function ListMusicIcon() {
  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      width="28"
      height="28"
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
    >
      <path d="M13 22a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h7a1 1 0 0 1 1 1v17a1 1 0 0 1-1 1Z" />
      <path d="M2 21v-2" />
      <path d="M2 17v-2" />
      <path d="M2 13v-2" />
      <path d="M2 9V7" />
      <path d="M2 5V3" />
    </svg>
  );
}

function LibraryCard({
  title,
  count,
  view,
}: {
  title: string;
  count: number;
  view: { kind: "history" | "liked" | "subscriptions" | "favorites" | "watchLater" };
}) {
  const { navigate } = useAppStore();
  return (
    <button
      onClick={() => navigate(view)}
      className="text-left p-5 rounded-xl border border-border hover:bg-accent/40 transition-colors"
    >
      <p className="text-sm text-muted-foreground">{title}</p>
      <p className="mt-2 text-2xl font-bold tabular-nums">{count}</p>
      <p className="mt-1 text-xs text-muted-foreground">
        {count === 1 ? "1 item" : `${count} items`}
      </p>
    </button>
  );
}

function EmptyState({ title, body }: { title: string; body: string }) {
  const { navigate } = useAppStore();
  return (
    <div className="py-16 text-center max-w-md mx-auto">
      <p className="text-lg font-medium">{title}</p>
      <p className="text-sm text-muted-foreground mt-1">{body}</p>
      <button
        onClick={() => navigate({ kind: "home" })}
        className="mt-4 inline-flex items-center justify-center rounded-full bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-5 text-sm font-medium"
      >
        Browse videos
      </button>
    </div>
  );
}

export function FavoritesView() {
  const bid = useBrowserId();
  const { data: state, isLoading } = useQuery({
    queryKey: ["user-state", bid],
    queryFn: () => fetchUserState(bid),
    enabled: !!bid,
  });
  const ids = state?.favoriteVideoIds || [];
  const { data, isLoading: vLoading } = useQuery({
    queryKey: ["videos", "favorites", ids.join("|")],
    queryFn: () => fetchVideosRaw({ ids: ids.join("|") }),
    enabled: ids.length > 0,
  });

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto">
      <h1 className="text-2xl font-bold mb-6 font-display flex items-center gap-2">
        <Heart className="h-6 w-6 text-rose" />
        Favorites
      </h1>
      {isLoading || vLoading ? (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-3/4 mt-2" />
            </div>
          ))}
        </div>
      ) : ids.length === 0 ? (
        <EmptyState
          title="No favorites yet"
          body="Tap the heart on a video to save it here for quick access."
        />
      ) : (
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
          {data?.map((v) => (
            <VideoCard key={v.id} video={v} />
          ))}
        </div>
      )}
    </div>
  );
}

export function WatchLaterView() {
  const bid = useBrowserId();
  // §31: Watch Later filters — unread, started, completed, long, short, search.
  const [filter, setFilter] = useState<"all" | "unwatched" | "started" | "completed" | "long" | "short">("all");
  const [searchQuery, setSearchQuery] = useState("");
  const { data: state, isLoading } = useQuery({
    queryKey: ["user-state", bid],
    queryFn: () => fetchUserState(bid),
    enabled: !!bid,
  });
  const ids = state?.watchLaterIds || [];
  const watchedIds = new Set(state?.watchedVideoIds || []);
  const { data, isLoading: vLoading } = useQuery({
    queryKey: ["videos", "watchLater", ids.join("|")],
    queryFn: () => fetchVideosRaw({ ids: ids.join("|") }),
    enabled: ids.length > 0,
  });

  // §31: Apply filters.
  let filtered = data || [];
  if (searchQuery) {
    const q = searchQuery.toLowerCase();
    filtered = filtered.filter((v) =>
      v.title.toLowerCase().includes(q) ||
      v.channel.name.toLowerCase().includes(q)
    );
  }
  if (filter === "unwatched") {
    filtered = filtered.filter((v) => !watchedIds.has(v.id));
  } else if (filter === "started") {
    // "Started" = watched but not completed (we don't have completion data per-video
    // in UserState, so we approximate: videos in the watched list that are also in
    // watch later are "started").
    filtered = filtered.filter((v) => watchedIds.has(v.id));
  } else if (filter === "completed") {
    // Approximation: completed = watched (since we remove from watch later on completion
    // in a full implementation — for now, we treat "watched" as completed).
    filtered = filtered.filter((v) => watchedIds.has(v.id));
  } else if (filter === "long") {
    filtered = filtered.filter((v) => v.durationSec >= 900);
  } else if (filter === "short") {
    filtered = filtered.filter((v) => v.durationSec < 300);
  }

  return (
    <div className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto">
      <h1 className="text-2xl font-bold mb-2 font-display flex items-center gap-2">
        <Bookmark className="h-6 w-6 text-gold" />
        Watch Later
      </h1>

      {/* §31: Search + filters */}
      {ids.length > 0 && (
        <div className="flex flex-col sm:flex-row gap-2 mb-6">
          <input
            value={searchQuery}
            onChange={(e) => setSearchQuery(e.target.value)}
            placeholder="Search your queue..."
            className="flex-1 rounded-full border border-border bg-background px-4 py-2 text-sm focus:outline-none focus:ring-2 focus:ring-gold/60"
            aria-label="Search watch later"
          />
          <Select value={filter} onValueChange={(v) => setFilter(v as any)}>
            <SelectTrigger className="w-full sm:w-40 rounded-full">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All videos</SelectItem>
              <SelectItem value="unwatched">Unwatched</SelectItem>
              <SelectItem value="started">Started</SelectItem>
              <SelectItem value="completed">Completed</SelectItem>
              <SelectItem value="long">Long (15min+)</SelectItem>
              <SelectItem value="short">Short (under 5min)</SelectItem>
            </SelectContent>
          </Select>
        </div>
      )}

      {isLoading || vLoading ? (
        <div className="flex flex-col gap-4">
          {Array.from({ length: 5 }).map((_, i) => (
            <div key={i} className="flex gap-3">
              <Skeleton className="w-[168px] sm:w-[280px] aspect-video rounded-lg shrink-0" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-3/4" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      ) : ids.length === 0 ? (
        <EmptyState
          title="Your queue is empty"
          body="Tap 'Watch Later' on a video to add it to your queue."
        />
      ) : filtered.length === 0 ? (
        <EmptyState
          title="No videos match your filters"
          body="Try adjusting your search or filters above."
        />
      ) : (
        <div className="flex flex-col gap-4">
          {filtered.map((v) => (
            <div key={v.id} className="relative">
              <VideoCardHorizontal video={v} />
              {watchedIds.has(v.id) && (
                <span className="absolute top-2 right-2 text-emerald" title="Watched">
                  <svg className="h-4 w-4" viewBox="0 0 20 20" fill="currentColor"><path fillRule="evenodd" d="M16.704 4.153a.75.75 0 01.143 1.052l-8 10.5a.75.75 0 01-1.127.075l-4.5-4.5a.75.75 0 011.06-1.06l3.894 3.893 7.48-9.817a.75.75 0 011.05-.143z" clipRule="evenodd" /></svg>
                </span>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

