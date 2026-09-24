"use client";

import { useState, useMemo, useEffect } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { Search as SearchIcon, Loader2, FlaskConical, Sparkle } from "lucide-react";
import { VideoCard } from "./video-card";
import { CategoryChips } from "./category-chips";
import { MoodFilter, moodToCategory, type MoodId } from "./mood-filter";
import { StreakBadge } from "./streak-badge";
import { TimeOfDayMood } from "./time-of-day-mood";
import { ShortsShelf } from "./shorts-shelf";
import { TrendingDigest } from "./trending-digest";
import { ContinueWatchingShelf } from "./continue-watching-shelf";
import { LiveNowShelf } from "./live-now-shelf";
import { Skeleton } from "@/components/ui/skeleton";
import { Button } from "@/components/ui/button";
import { Badge } from "@/components/ui/badge";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Dialog, DialogContent, DialogTitle, DialogDescription, DialogFooter, DialogHeader,
} from "@/components/ui/dialog";
import {
  Select, SelectContent, SelectItem, SelectTrigger, SelectValue,
} from "@/components/ui/select";
import { ScrollArea } from "@/components/ui/scroll-area";
import { useBrowserId } from "@/hooks/use-browser-id";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";
import type { Video } from "@/lib/types";
import { toast } from "sonner";

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

// §40 — AI multi-video research. POST { videoIds, operation } → returns the
// AI's analysis (compare / summarize / agreements / differences /
// contradictions / sources / organize). Falls back to a deterministic
// listing when AI is unavailable.
type ResearchOperation =
  | "compare" | "summarize" | "agreements" | "differences"
  | "contradictions" | "sources" | "organize";

const RESEARCH_OPERATIONS: { value: ResearchOperation; label: string }[] = [
  { value: "compare", label: "Compare" },
  { value: "summarize", label: "Summarize" },
  { value: "agreements", label: "Find agreements" },
  { value: "differences", label: "Find differences" },
  { value: "contradictions", label: "Identify contradictions" },
  { value: "sources", label: "Surface sources" },
  { value: "organize", label: "Organize by topic" },
];

interface MultiResearchResponse {
  operation: string;
  videoIds: string[];
  videoTitles: { id: string; title: string; channel: string }[];
  result: string;
  source: string;
  disclaimer: string;
}
async function fetchMultiVideoResearch(
  videoIds: string[],
  operation: ResearchOperation
): Promise<MultiResearchResponse> {
  const res = await fetch("/api/ai/multi-video-research", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoIds, operation }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string })?.error || "Research failed");
  }
  return (await res.json()) as MultiResearchResponse;
}

// §15 — Sponsored hashtags. Pulled from CIRKLE's sponsored hashtag discovery.
// Shown as a small gold-tinted chip row below the CategoryChips so paid
// placements never look identical to organic results (always labeled).
interface SponsoredHashtagItem {
  id: string;
  hashtag: string;
  advertiser?: string;
  city?: string;
  sponsored: true;
}
interface SponsoredHashtagsResponse {
  hashtags: SponsoredHashtagItem[];
}
async function fetchSponsoredHashtags(): Promise<SponsoredHashtagsResponse> {
  const res = await fetch("/api/sponsored-hashtags");
  if (!res.ok) return { hashtags: [] };
  const data = await res.json();
  return { hashtags: (data?.hashtags as SponsoredHashtagItem[]) || [] };
}

export function HomeView() {
  const [category, setCategory] = useState("All");
  const [mood, setMood] = useState<MoodId | null>(null);
  // §63-64 — feed mode toggle. Default is FYP (personalized). User can
  // switch to Discovery (intentionally different) or Diversity (max spread).
  const [feedMode, setFeedMode] = useState<FeedMode>("fyp");
  // §40 — Multi-video research dialog. Opened by the "Research" button
  // in the feed mode toggle row. The dialog shows the current feed's
  // videos (capped at 10) and lets the user pick an operation.
  const [researchOpen, setResearchOpen] = useState(false);
  const bid = useBrowserId();
  const navigate = useAppStore((s) => s.navigate);

  // Fetch user preferences to respect continueWatchingEnabled + disableShorts.
  const { data: prefs } = useQuery({
    queryKey: ["preferences", bid],
    queryFn: async () => {
      if (!bid) return null;
      const res = await fetch(`/api/preferences?bid=${encodeURIComponent(bid)}`);
      if (!res.ok) return null;
      return res.json();
    },
    enabled: !!bid,
    staleTime: 60_000,
  });
  const continueWatchingEnabled = prefs?.preferences?.continueWatchingEnabled ?? true;
  const disableShorts = prefs?.preferences?.disableShorts ?? false;

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

  // §15 — Sponsored hashtags. Fetched only on the default home view so the
  // gold-tinted chip row surfaces paid discovery alongside organic results.
  // Hidden entirely when the API returns no active hashtags.
  const { data: sponsoredHashtagsData } = useQuery({
    queryKey: ["sponsored-hashtags"],
    queryFn: () => fetchSponsoredHashtags(),
    enabled: isDefaultHome,
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
    <div className="animate-fade-up">
      <CategoryChips active={mood ? "All" : category} onSelect={(c) => { setCategory(c); setMood(null); }} />
      {/* §15 — Trending sponsored hashtags. A single horizontal row of
          gold-tinted chips shown only on the default home view, hidden
          entirely when the API returns no active hashtags. Clicking a
          hashtag filters the feed by navigating to the search view. */}
      {isDefaultHome &&
        sponsoredHashtagsData &&
        sponsoredHashtagsData.hashtags.length > 0 && (
          <div className="px-4 sm:px-6 pt-2 pb-1 flex items-center gap-2 overflow-x-auto custom-scroll-x">
            <span className="shrink-0 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">
              Trending
            </span>
            {sponsoredHashtagsData.hashtags.map((h) => (
              <button
                key={h.id}
                onClick={() => navigate({ kind: "search", query: h.hashtag })}
                className="shrink-0 inline-flex items-center gap-1.5 rounded-full border border-gold/40 bg-[hsl(var(--gold)/0.10)] px-3 py-1 text-xs font-medium text-foreground hover:bg-[hsl(var(--gold)/0.18)] transition-colors"
                title={
                  h.advertiser
                    ? `Sponsored by ${h.advertiser} — click to filter feed by #${h.hashtag}`
                    : `Sponsored — click to filter feed by #${h.hashtag}`
                }
                aria-label={`Filter feed by sponsored hashtag ${h.hashtag}`}
              >
                <Sparkle className="h-3 w-3 text-[hsl(var(--gold))]" aria-hidden />
                #{h.hashtag.replace(/^#/, "")}
                <Badge
                  variant="outline"
                  className="ml-1 h-4 px-1 text-[9px] py-0 border-gold/40 bg-transparent text-[hsl(var(--gold))]"
                >
                  Sponsored
                </Badge>
              </button>
            ))}
          </div>
        )}
      <div className="pt-2 pb-1 flex items-center justify-between gap-2">
        <MoodFilter active={mood} onSelect={setMood} />
        <StreakBadge />
      </div>
      {/* Time-of-Day Mood Sync — suggests a mood based on the user's local
          time (Pass 76). "Good evening, it feels like a Chill kind of moment". */}
      {isDefaultHome && (
        <TimeOfDayMood onAccept={(m) => setMood(m as MoodId)} />
      )}
      {/* AI Trending Digest — only on the default home feed, where it
          reinforces Mashahd's AI-native identity with a curated editorial
          wrap-up of today's trending videos. */}
      {isDefaultHome && <TrendingDigest />}
      {/* Live Now shelf — surfaces currently-broadcasting live streams
          (Pass 47). Reads from the LiveStream table via /api/live-streams.
          Hidden automatically when no streams are live. */}
      {isDefaultHome && <LiveNowShelf />}
      {/* Continue Watching shelf — shows unfinished videos with resume positions.
          Per spec §32. Only on the default home view. */}
      {isDefaultHome && continueWatchingEnabled && <ContinueWatchingShelf />}
      {/* Shorts shelf — only on the default home feed (not when a mood or
          specific category is selected). Respects disableShorts preference (§16). */}
      {isDefaultHome && !disableShorts && <ShortsShelf />}
      {/* Feed mode toggles — §63-64. Three small toggle buttons next to
          the FYP badge area. "Discovery" fetches intentionally different
          content; "Diverse" maximizes creator/topic/format spread. */}
      {isDefaultHome && (
        <div className="px-4 sm:px-6 pt-3 pb-1 flex items-center gap-2 flex-wrap animate-fade-up">
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
          {/* §40 — Research button. Opens a dialog where the user picks up
              to 10 videos from the current feed + an operation, then POSTs
              to /api/ai/multi-video-research. Always shown (even on category
              or mood feeds) so the user can analyze whatever they're looking
              at. */}
          <Button
            variant="outline"
            size="sm"
            className="ml-auto h-8 rounded-full text-xs border-gold/30 bg-gold/5 hover:bg-gold/10 text-foreground"
            onClick={() => setResearchOpen(true)}
            disabled={!displayVideos || displayVideos.length === 0}
            title="Pick multiple videos and run AI research (compare, summarize, etc.)"
          >
            <FlaskConical className="h-3.5 w-3.5 text-[hsl(var(--gold))]" />
            Research
          </Button>
        </div>
      )}
      <ResearchDialog
        open={researchOpen}
        onOpenChange={setResearchOpen}
        videos={(displayVideos || []).slice(0, 10)}
      />
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
        {/* ── Premium feed grid with staggered entrance animation (Pass 75) ── */}
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 xl:grid-cols-5 2xl:grid-cols-6 gap-x-4 gap-y-8">
          {displayLoading
            ? Array.from({ length: 18 }).map((_, i) => <VideoCardSkeleton key={i} />)
            : displayVideos?.map((v, i) => (
                <div
                  key={v.id}
                  className="animate-fade-up"
                  style={{ animationDelay: `${Math.min(i * 40, 400)}ms` }}
                >
                  <VideoCard
                    video={v}
                    reasons={displayReasons?.[i]}
                  />
                </div>
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

/**
 * §40 — ResearchDialog. Lets the user pick up to N videos from the current
 * feed + an operation, then POSTs to /api/ai/multi-video-research. Shows
 * the AI-generated analysis in a scrollable area, plus the disclaimer
 * (per spec §40: "Do not manufacture consensus").
 */
function ResearchDialog({
  open,
  onOpenChange,
  videos,
}: {
  open: boolean;
  onOpenChange: (v: boolean) => void;
  videos: Video[];
}) {
  const [selected, setSelected] = useState<Set<string>>(new Set());
  const [operation, setOperation] = useState<ResearchOperation>("compare");

  // Reset selection when the dialog opens (so stale picks don't persist).
  useEffect(() => {
    if (open) {
      // eslint-disable-next-line react-hooks/set-state-in-effect
      setSelected(new Set());
    }
  }, [open]);

  const toggle = (id: string) => {
    setSelected((s) => {
      const next = new Set(s);
      if (next.has(id)) {
        next.delete(id);
      } else if (next.size < 10) {
        next.add(id);
      } else {
        toast.info("You can select up to 10 videos.");
      }
      return next;
    });
  };

  const mutation = useMutation({
    mutationFn: () => fetchMultiVideoResearch(Array.from(selected), operation),
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Research failed";
      toast.error(msg);
    },
  });

  const run = () => {
    if (selected.size < 2) {
      toast.error("Select at least 2 videos to run research.");
      return;
    }
    mutation.mutate();
  };

  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      <DialogContent className="max-w-2xl">
        <DialogHeader>
          <DialogTitle className="flex items-center gap-2">
            <FlaskConical className="h-5 w-5 text-[hsl(var(--gold))]" />
            Multi-video research
          </DialogTitle>
          <DialogDescription>
            Pick 2–10 videos from your current feed and an operation. Mashahd AI will analyze them together.
          </DialogDescription>
        </DialogHeader>

        <div className="space-y-3">
          {/* Operation picker */}
          <div className="flex items-center gap-2">
            <span className="text-xs text-muted-foreground shrink-0">Operation:</span>
            <Select value={operation} onValueChange={(v) => setOperation(v as ResearchOperation)}>
              <SelectTrigger size="sm" className="h-8 text-xs flex-1">
                <SelectValue />
              </SelectTrigger>
              <SelectContent>
                {RESEARCH_OPERATIONS.map((o) => (
                  <SelectItem key={o.value} value={o.value}>
                    {o.label}
                  </SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>

          {/* Video multi-select list (capped at the videos passed in) */}
          <div className="rounded-lg border border-border max-h-[260px] overflow-y-auto custom-scroll">
            {videos.length === 0 ? (
              <p className="p-3 text-xs text-muted-foreground text-center">
                No videos in the current feed. Try a different category or refresh.
              </p>
            ) : (
              <ul className="divide-y divide-border">
                {videos.map((v) => {
                  const checked = selected.has(v.id);
                  return (
                    <li key={v.id}>
                      <label
                        className={cn(
                          "flex items-start gap-2 p-2 cursor-pointer hover:bg-accent transition-colors",
                          checked && "bg-accent/40"
                        )}
                      >
                        <Checkbox
                          checked={checked}
                          onCheckedChange={() => toggle(v.id)}
                          className="mt-0.5"
                        />
                        <div className="min-w-0 flex-1">
                          <p className="text-sm font-medium truncate">{v.title}</p>
                          <p className="text-xs text-muted-foreground truncate">
                            {v.channel.name} · {v.category}
                          </p>
                        </div>
                      </label>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <p className="text-xs text-muted-foreground">
            <span className="text-foreground font-medium tabular-nums">{selected.size}</span> selected ·
            max 10 · need at least 2 to run research.
          </p>

          {/* Result */}
          {mutation.data && (
            <div className="space-y-2">
              <div className="flex items-center gap-1.5 flex-wrap">
                <Badge variant="outline" className="text-[10px] py-0">{mutation.data.operation}</Badge>
                <Badge variant="secondary" className="text-[10px] py-0">{mutation.data.source}</Badge>
              </div>
              <ScrollArea className="h-[280px] rounded-lg border border-border bg-muted/40 p-3">
                <pre className="text-xs whitespace-pre-wrap break-words font-sans leading-relaxed">
                  {mutation.data.result}
                </pre>
              </ScrollArea>
              <p className="text-[10px] italic text-muted-foreground">
                {mutation.data.disclaimer}
              </p>
            </div>
          )}
          {mutation.isError && (
            <p className="text-xs text-destructive">
              {mutation.error instanceof Error ? mutation.error.message : "Research failed"}
            </p>
          )}
        </div>

        <DialogFooter>
          <Button
            variant="ghost"
            size="sm"
            className="rounded-full"
            onClick={() => onOpenChange(false)}
            disabled={mutation.isPending}
          >
            Close
          </Button>
          <Button
            size="sm"
            className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
            onClick={run}
            disabled={mutation.isPending || selected.size < 2}
          >
            {mutation.isPending ? (
              <>
                <Loader2 className="h-4 w-4 animate-spin mr-1.5" />
                Researching…
              </>
            ) : (
              <>
                <SearchIcon className="h-4 w-4 mr-1.5" />
                Run research
              </>
            )}
          </Button>
        </DialogFooter>
      </DialogContent>
    </Dialog>
  );
}
