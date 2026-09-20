"use client";

import { useQuery } from "@tanstack/react-query";
import { Radio, Eye, Clock } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/store/app-store";
import { useBrowserId } from "@/hooks/use-browser-id";

/**
 * PastStreams — shows the user's live stream broadcast history.
 *
 * Fetches /api/live-streams?streamerBid=<bid>&status=all to get every
 * stream the user has broadcast (live, ended, preparing). Each row shows
 * the title, status badge, peak viewer count, and duration. Clicking a
 * row navigates to the stream view (for ended streams, this shows the
 * "Stream ended" state with peak viewers + duration).
 */

interface StreamRow {
  id: string;
  title: string;
  status: string;
  streamerName: string;
  category: string;
  viewerCount: number;
  peakViewerCount: number;
  startedAt: string;
  endedAt: string;
}

interface StreamsResp { streams: StreamRow[]; count: number }

async function fetchMyStreams(bid: string): Promise<StreamsResp> {
  if (!bid) return { streams: [], count: 0 };
  const res = await fetch(`/api/live-streams?streamerBid=${encodeURIComponent(bid)}&status=all&limit=50`);
  if (!res.ok) return { streams: [], count: 0 };
  return res.json();
}

function fmtDuration(startIso: string, endIso: string): string {
  if (!startIso) return "—";
  const end = endIso ? new Date(endIso) : new Date();
  const ms = end.getTime() - new Date(startIso).getTime();
  if (ms < 0 || !isFinite(ms)) return "—";
  const s = Math.floor(ms / 1000);
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ${s % 60}s`;
  const h = Math.floor(m / 60);
  return `${h}h ${m % 60}m`;
}

function fmtDate(iso: string): string {
  if (!iso) return "—";
  const d = new Date(iso);
  return d.toLocaleDateString(undefined, { month: "short", day: "numeric" });
}

export function PastStreams() {
  const bid = useBrowserId();
  const { navigate } = useAppStore();
  const { data, isLoading } = useQuery({
    queryKey: ["my-streams", bid],
    queryFn: () => fetchMyStreams(bid),
    enabled: !!bid,
  });

  const streams = data?.streams ?? [];

  if (!bid) return null;
  if (isLoading) {
    return (
      <section className="mt-6">
        <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
          <Radio className="h-4 w-4 text-[hsl(var(--gold))]" />
          Past streams
        </h3>
        <div className="space-y-2">
          {Array.from({ length: 2 }).map((_, i) => (
            <Skeleton key={i} className="h-16 w-full rounded-lg" />
          ))}
        </div>
      </section>
    );
  }
  if (streams.length === 0) return null;

  return (
    <section className="mt-6">
      <h3 className="text-sm font-semibold mb-2 flex items-center gap-2">
        <Radio className="h-4 w-4 text-[hsl(var(--gold))]" />
        Past streams
        <span className="text-xs text-muted-foreground font-normal">
          ({streams.length})
        </span>
      </h3>
      <div className="space-y-2 max-h-80 overflow-y-auto custom-scroll">
        {streams.map((s) => {
          const isLive = s.status === "live";
          const isEnded = s.status === "ended";
          return (
            <button
              key={s.id}
              onClick={() => navigate({ kind: "live", streamId: s.id })}
              className="w-full flex items-center gap-3 p-3 rounded-lg border border-border bg-card hover:bg-accent/50 transition-colors text-left"
            >
              {/* Status pill */}
              <span
                className={
                  "shrink-0 px-2 py-0.5 rounded-full text-[10px] font-bold " +
                  (isLive
                    ? "bg-red-600 text-white"
                    : isEnded
                      ? "bg-zinc-700 text-white"
                      : "bg-amber-500 text-white")
                }
              >
                {isLive ? "LIVE" : isEnded ? "ENDED" : "PREP"}
              </span>
              {/* Title + meta */}
              <div className="min-w-0 flex-1">
                <p className="text-xs font-medium line-clamp-1">{s.title}</p>
                <div className="flex items-center gap-3 text-[10px] text-muted-foreground mt-0.5">
                  <span className="flex items-center gap-1">
                    <Eye className="h-3 w-3" />
                    Peak {s.peakViewerCount}
                  </span>
                  <span className="flex items-center gap-1">
                    <Clock className="h-3 w-3" />
                    {fmtDuration(s.startedAt, s.endedAt)}
                  </span>
                  <span>{fmtDate(s.startedAt)}</span>
                </div>
              </div>
            </button>
          );
        })}
      </div>
    </section>
  );
}
