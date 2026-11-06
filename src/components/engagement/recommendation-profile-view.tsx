"use client";

import { useQuery } from "@tanstack/react-query";
import {
  TrendingUp,
  Users,
  Ban,
  ThumbsDown,
  ThumbsUp,
  RotateCcw,
  Activity,
  type LucideIcon,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { useBrowserId } from "@/hooks/use-browser-id";
import { timeAgo } from "@/lib/format";
import { cn } from "@/lib/utils";

/**
 * RecommendationProfileView — "My Recommendation Profile" (spec §70).
 *
 * A user-facing transparency layer. Shows the meaningful events that shaped
 * the user's recommendation feed (subscribes, blocks, feedback, resets) so
 * they can see WHY their feed looks the way it does.
 *
 * Per spec §70: we show the user what happened, but never expose proprietary
 * ranking formulas — only the events the user themselves triggered.
 *
 * Data is fetched from `/api/recommendation-changelog?bid=...` using the
 * signed browserId from `useBrowserId`. The backend writes to this log
 * automatically from the subscribe / blocks / feedback / reset APIs.
 */

/** Event types the backend writes to the recommendation changelog. */
type RecommendationEventType =
  | "followed_creator"
  | "blocked_topic"
  | "blocked_creator"
  | "negative_feedback"
  | "positive_feedback"
  | "reset_profile";

interface RecommendationEvent {
  id: string;
  eventType: string;
  description: string;
  metadata: Record<string, unknown>;
  createdAt: string;
}

interface RecommendationSummary {
  total: number;
  followedCreators: number;
  blockedTopics: number;
  negativeFeedback: number;
  positiveFeedback: number;
  resets: number;
}

interface ChangelogResponse {
  events: RecommendationEvent[];
  summary: RecommendationSummary;
}

const EMPTY_SUMMARY: RecommendationSummary = {
  total: 0,
  followedCreators: 0,
  blockedTopics: 0,
  negativeFeedback: 0,
  positiveFeedback: 0,
  resets: 0,
};

async function fetchChangelog(bid: string): Promise<ChangelogResponse> {
  const res = await fetch(
    `/api/recommendation-changelog?bid=${encodeURIComponent(bid)}`,
  );
  if (!res.ok) {
    throw new Error(`Failed to fetch recommendation changelog (${res.status})`);
  }
  const data = (await res.json()) as Partial<ChangelogResponse>;
  return {
    events: Array.isArray(data.events) ? data.events : [],
    summary: data.summary ?? EMPTY_SUMMARY,
  };
}

/** Pick the timeline icon for a given event type (with a sensible fallback). */
function eventIcon(eventType: string): LucideIcon {
  switch (eventType as RecommendationEventType | string) {
    case "followed_creator":
      return Users;
    case "blocked_topic":
    case "blocked_creator":
      return Ban;
    case "negative_feedback":
      return ThumbsDown;
    case "positive_feedback":
      return ThumbsUp;
    case "reset_profile":
      return RotateCcw;
    default:
      return Activity;
  }
}

/** Tailwind text color for an event type (positive / negative / neutral). */
function eventIconClass(eventType: string): string {
  switch (eventType as RecommendationEventType | string) {
    case "followed_creator":
    case "positive_feedback":
      return "text-emerald-500";
    case "blocked_topic":
    case "blocked_creator":
    case "negative_feedback":
      return "text-red-500";
    case "reset_profile":
      return "text-amber-500";
    default:
      return "text-muted-foreground";
  }
}

interface SummaryCardConfig {
  key: keyof RecommendationSummary;
  label: string;
  icon: LucideIcon;
  iconClass: string;
}

/** Drives the top summary card grid. Order matches spec §70. */
const SUMMARY_CARDS: SummaryCardConfig[] = [
  {
    key: "total",
    label: "Total events",
    icon: TrendingUp,
    iconClass: "text-[hsl(var(--gold))]",
  },
  {
    key: "followedCreators",
    label: "Followed creators",
    icon: Users,
    iconClass: "text-emerald-500",
  },
  {
    key: "blockedTopics",
    label: "Blocked topics",
    icon: Ban,
    iconClass: "text-red-500",
  },
  {
    key: "negativeFeedback",
    label: "Negative feedback",
    icon: ThumbsDown,
    iconClass: "text-orange-500",
  },
  {
    key: "positiveFeedback",
    label: "Positive feedback",
    icon: ThumbsUp,
    iconClass: "text-emerald-500",
  },
  {
    key: "resets",
    label: "Profile resets",
    icon: RotateCcw,
    iconClass: "text-amber-500",
  },
];

export function RecommendationProfileView() {
  const bid = useBrowserId();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["recommendation-changelog", bid],
    queryFn: () => fetchChangelog(bid),
    enabled: !!bid,
    staleTime: 60_000, // 1 min — changelog doesn't need to be real-time
  });

  const summary = data?.summary ?? EMPTY_SUMMARY;
  const events = data?.events ?? [];
  // Treat the initial "no bid yet" state as loading so skeletons show until
  // useBrowserId resolves a signed id from the server.
  const loading = isLoading || !bid;

  return (
    <div className="px-4 sm:px-6 py-6 max-w-5xl mx-auto">
      {/* Header */}
      <header className="mb-6">
        <h1 className="text-2xl sm:text-3xl font-bold font-display flex items-center gap-2">
          <Activity className="h-6 w-6 text-[hsl(var(--gold))]" aria-hidden />
          My Recommendation Profile
        </h1>
        <p className="mt-2 text-sm text-muted-foreground max-w-2xl leading-relaxed">
          This is your recommendation transparency layer. See exactly what
          actions shaped your feed. Per spec: we show you what happened, but
          never expose proprietary ranking formulas.
        </p>
      </header>

      {/* Summary cards — 2 cols mobile, 3 cols tablet, 6 cols desktop */}
      <section
        aria-label="Recommendation activity summary"
        className="grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-3"
      >
        {loading
          ? Array.from({ length: 6 }).map((_, i) => (
              <Skeleton key={i} className="h-24 rounded-xl" />
            ))
          : SUMMARY_CARDS.map((card) => {
              const Icon = card.icon;
              const value = summary[card.key] ?? 0;
              return (
                <Card key={card.key} className="py-4 gap-0">
                  <CardContent className="flex flex-col gap-2 px-4">
                    <span
                      className={cn(
                        "grid place-items-center h-8 w-8 rounded-full bg-accent/50",
                        card.iconClass,
                      )}
                    >
                      <Icon className="h-4 w-4" aria-hidden />
                    </span>
                    <p
                      className="text-2xl font-bold tabular-nums leading-none"
                      aria-label={card.label}
                    >
                      {value}
                    </p>
                    <p className="text-xs text-muted-foreground">{card.label}</p>
                  </CardContent>
                </Card>
              );
            })}
      </section>

      {/* Event timeline */}
      <section
        aria-label="Recommendation event timeline"
        className="mt-8"
      >
        <h2 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-4">
          Event timeline
        </h2>

        {loading ? (
          <div className="space-y-4" aria-busy="true">
            {Array.from({ length: 5 }).map((_, i) => (
              <div key={i} className="flex items-start gap-3">
                <Skeleton className="h-6 w-6 rounded-full shrink-0" />
                <div className="flex-1 space-y-2 pt-0.5">
                  <Skeleton className="h-4 w-3/4" />
                  <Skeleton className="h-3 w-20" />
                </div>
              </div>
            ))}
          </div>
        ) : isError ? (
          <div className="rounded-xl border border-destructive/30 bg-destructive/5 p-6 text-center">
            <p className="text-sm text-destructive">
              Could not load your recommendation activity. Please try again
              later.
            </p>
          </div>
        ) : events.length === 0 ? (
          <div className="rounded-xl border border-border bg-card p-8 text-center">
            <Activity className="h-8 w-8 text-muted-foreground mx-auto mb-3" aria-hidden />
            <p className="text-sm text-muted-foreground max-w-md mx-auto">
              No recommendation activity yet. Your actions (subscribing,
              blocking, giving feedback) will appear here.
            </p>
          </div>
        ) : (
          <ol className="relative space-y-4">
            {/* Vertical timeline line */}
            <span
              className="absolute left-3 top-3 bottom-3 w-px bg-border"
              aria-hidden
            />
            {events.slice(0, 50).map((event) => {
              const Icon = eventIcon(event.eventType);
              const iconClass = eventIconClass(event.eventType);
              return (
                <li key={event.id} className="relative pl-10">
                  <span className="absolute left-0 top-0 grid place-items-center h-6 w-6 rounded-full bg-background border border-border">
                    <Icon className={cn("h-3 w-3", iconClass)} aria-hidden />
                  </span>
                  <p className="text-sm leading-relaxed">{event.description}</p>
                  <p className="text-xs text-muted-foreground mt-0.5">
                    {timeAgo(event.createdAt)}
                  </p>
                </li>
              );
            })}
          </ol>
        )}
      </section>
    </div>
  );
}

export default RecommendationProfileView;
