"use client";

import { useEffect, useState } from "react";
import { useMutation } from "@tanstack/react-query";
import { Sparkles, X, Loader2, RefreshCw, Lightbulb, Flame, Trophy } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Recap = {
  tldr: string;
  takeaways: string[];
  bestMoment: string;
  vibe: string;
};

/** CIRKLE BRAIN Recap panel — listens for the `mashahd:ai-summarize` window event. */
export function AiRecap({ videoId }: { videoId: string }) {
  const [open, setOpen] = useState(false);
  const [recap, setRecap] = useState<Recap | null>(null);
  // Pass 94: CIRKLE BRAIN consensus metadata for the transparency badge
  const [consensus, setConsensus] = useState<{
    source: string; sources: string[]; confidence: number;
    providerCount: number; synthesized: boolean;
  } | null>(null);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("mashahd:ai-summarize", handler);
    return () => window.removeEventListener("mashahd:ai-summarize", handler);
  }, []);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/summarize", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<{ ok: boolean; recap: Recap; source: string; consensus?: { source: string; sources: string[]; confidence: number; providerCount: number; synthesized: boolean } }>;
    },
    onSuccess: (data) => {
      setRecap(data.recap);
      // Pass 94: store consensus metadata for the transparency badge
      setConsensus(data.consensus || null);
      if (data.source === "fallback") {
        toast.info("CIRKLE BRAIN offline — showing a best-effort recap");
      } else {
        const c = data.consensus;
        if (c && c.synthesized) {
          toast.success(`CIRKLE BRAIN ready · ${c.providerCount}/5 providers · ${Math.round(c.confidence * 100)}% confidence`);
        } else {
          toast.success("CIRKLE BRAIN recap ready");
        }
      }
    },
    onError: () => toast.error("Could not generate recap"),
  });

  useEffect(() => {
    if (open && !recap && !mutation.isPending) {
      mutation.mutate();
    }
  }, [open, videoId]);

  if (!open) return null;

  return (
    <div className="mt-4">
      <div className="rounded-xl border border-gold/30 bg-gradient-to-br from-[hsl(var(--gold)/0.08)] to-transparent overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-gold/20 bg-[hsl(var(--gold)/0.06)]">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-[hsl(var(--gold))]" />
            <span className="text-sm font-semibold gradient-text-gold">CIRKLE BRAIN Recap</span>
            {recap?.vibe && (
              <span className="text-[10px] uppercase tracking-wide text-muted-foreground bg-muted px-1.5 py-0.5 rounded">
                {recap.vibe}
              </span>
            )}
            {/* Pass 94: CIRKLE BRAIN consensus transparency badge.
                Shows provider count + confidence + synthesized flag.
                This is what sets Mashahd apart from YouTube's black-box AI. */}
            {consensus && consensus.providerCount > 0 && (
              <span
                className="text-[9px] uppercase tracking-wide px-1.5 py-0.5 rounded border"
                style={{
                  color: consensus.confidence >= 0.6
                    ? "hsl(var(--teal))"
                    : "hsl(var(--rose))",
                  borderColor: consensus.confidence >= 0.6
                    ? "hsl(var(--teal) / 0.3)"
                    : "hsl(var(--rose) / 0.3)",
                  background: consensus.confidence >= 0.6
                    ? "hsl(var(--teal) / 0.08)"
                    : "hsl(var(--rose) / 0.08)",
                }}
                title={`CIRKLE BRAIN consensus: ${consensus.providerCount}/5 providers responded, ${Math.round(consensus.confidence * 100)}% agreement on vibe. Sources: ${consensus.sources.join(", ")}`}
              >
                ⚡ {consensus.providerCount}/5 · {Math.round(consensus.confidence * 100)}%
                {consensus.synthesized ? " · fused" : ""}
              </span>
            )}
          </div>
          <div className="flex items-center gap-1">
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              aria-label="Regenerate recap"
              title="Regenerate"
            >
              <RefreshCw className={cn("h-3.5 w-3.5", mutation.isPending && "animate-spin")} />
            </Button>
            <Button
              variant="ghost"
              size="icon"
              className="h-7 w-7 rounded-full"
              onClick={() => setOpen(false)}
              aria-label="Close recap"
            >
              <X className="h-3.5 w-3.5" />
            </Button>
          </div>
        </div>

        <div className="p-4 space-y-3">
          {mutation.isPending && !recap ? (
            <RecapSkeleton />
          ) : recap ? (
            <>
              <p className="text-sm leading-relaxed text-foreground">{recap.tldr}</p>
              <div>
                <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5 flex items-center gap-1.5">
                  <Lightbulb className="h-3.5 w-3.5" /> Key takeaways
                </p>
                <ul className="space-y-1.5">
                  {recap.takeaways.map((t, i) => (
                    <li key={i} className="text-sm flex gap-2">
                      <span className="text-[hsl(var(--gold))] font-bold tabular-nums shrink-0">{i + 1}.</span>
                      <span>{t}</span>
                    </li>
                  ))}
                </ul>
              </div>
              <div className="flex items-start gap-2 p-2.5 rounded-lg bg-[hsl(var(--gold)/0.07)] border border-gold/15">
                <Trophy className="h-4 w-4 text-[hsl(var(--gold))] shrink-0 mt-0.5" />
                <p className="text-sm">
                  <span className="font-medium">Best moment: </span>
                  {recap.bestMoment}
                </p>
              </div>
            </>
          ) : (
            <p className="text-sm text-muted-foreground">No recap available.</p>
          )}
        </div>
      </div>
    </div>
  );
}

function RecapSkeleton() {
  return (
    <div className="space-y-3">
      <div className="h-4 w-full shimmer-gold rounded" />
      <div className="h-4 w-3/4 shimmer-gold rounded" />
      <div className="space-y-2 pt-2">
        <div className="h-3 w-1/2 shimmer-gold rounded" />
        <div className="h-3 w-2/3 shimmer-gold rounded" />
        <div className="h-3 w-3/5 shimmer-gold rounded" />
      </div>
    </div>
  );
}
