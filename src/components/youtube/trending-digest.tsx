"use client";

import { useQuery } from "@tanstack/react-query";
import { Sparkles, Loader2, RefreshCw } from "lucide-react";
import { useAppStore } from "@/store/app-store";
import { cn } from "@/lib/utils";

type DigestResponse = {
  ok: boolean;
  digest: string;
  videos: { id: string; title: string }[];
  source: "ai" | "fallback";
  cached?: boolean;
};

/**
 * TrendingDigest — an AI-generated editorial wrap-up of today's trending
 * videos, shown on the home page. Reinforces Mashahd's AI-native identity:
 * instead of a bare list, the viewer gets a curator's note.
 *
 * Fetches from GET /api/ai/trending-digest (10-min server cache). Includes
 * a "regenerate" affordance so the viewer can refresh on demand.
 */
export function TrendingDigest() {
  const { navigate } = useAppStore();
  const { data, isLoading, isError, refetch, isFetching } = useQuery<DigestResponse>({
    queryKey: ["ai-trending-digest"],
    queryFn: async () => {
      const r = await fetch("/api/ai/trending-digest");
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    staleTime: 5 * 60 * 1000, // client-side: treat as fresh for 5 min
  });

  return (
    <section className="mx-4 sm:mx-6 mt-2 mb-4">
      <div
        className={cn(
          "relative overflow-hidden rounded-2xl p-4 sm:p-5",
          "bg-gradient-to-br from-gold/15 via-teal/5 to-transparent",
          "border border-gold/20"
        )}
      >
        {/* Subtle shimmer border accent */}
        <div className="absolute inset-x-0 top-0 h-px bg-gradient-to-r from-transparent via-gold/40 to-transparent" aria-hidden />

        <div className="flex items-start gap-3">
          {/* Sparkle icon — the AI signature */}
          <div className="shrink-0 mt-0.5 grid place-items-center h-9 w-9 rounded-full bg-gold/20 border border-gold/30">
            <Sparkles className="h-4 w-4 text-[hsl(var(--gold))]" />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-2 mb-1">
              <h2 className="text-sm font-semibold tracking-tight">
                Mashahd AI · Today&apos;s Digest
              </h2>
              <span className="text-[10px] uppercase tracking-wider text-muted-foreground/80">
                {data?.source === "ai" ? "AI-curated" : "Editorial"}
              </span>
            </div>

            {isLoading ? (
              <div className="flex items-center gap-2 py-2">
                <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />
                <span className="text-sm text-muted-foreground">Curating today&apos;s feed…</span>
              </div>
            ) : isError ? (
              <p className="text-sm text-muted-foreground">
                Couldn&apos;t generate a digest right now. Browse the feed below.
              </p>
            ) : (
              <>
                <p className="text-sm leading-relaxed text-foreground/90">
                  {data?.digest}
                </p>

                {/* Quick-pick chips for the mentioned videos */}
                {data?.videos && data.videos.length > 0 && (
                  <div className="flex flex-wrap gap-1.5 mt-3">
                    {data.videos.slice(0, 4).map((v) => (
                      <button
                        key={v.id}
                        onClick={() => navigate({ kind: "watch", videoId: v.id })}
                        className="text-xs px-2.5 py-1 rounded-full bg-background/60 hover:bg-background border border-border/60 hover:border-gold/40 transition-colors truncate max-w-[200px]"
                        title={v.title}
                      >
                        {v.title}
                      </button>
                    ))}
                  </div>
                )}
              </>
            )}
          </div>

          {/* Refresh button */}
          {!isLoading && (
            <button
              onClick={() => refetch()}
              disabled={isFetching}
              className="shrink-0 grid place-items-center h-8 w-8 rounded-full hover:bg-background/60 text-muted-foreground hover:text-foreground transition-colors disabled:opacity-50"
              aria-label="Refresh digest"
              title="Refresh digest"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", isFetching && "animate-spin")} />
            </button>
          )}
        </div>
      </div>
    </section>
  );
}
