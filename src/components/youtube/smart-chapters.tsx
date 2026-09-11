"use client";

import { useEffect, useState, useCallback } from "react";
import { useMutation } from "@tanstack/react-query";
import { ListVideo, X, Loader2, Play, Sparkles } from "lucide-react";
import { Button } from "@/components/ui/button";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

type Chapter = {
  title: string;
  seconds: number;
  mood: string;
  summary: string;
};

function fmt(sec: number) {
  const m = Math.floor(sec / 60);
  const s = sec % 60;
  return `${m}:${String(s).padStart(2, "0")}`;
}

/**
 * Smart Chapters — listens for `mashahd:ai-chapters` event, fetches
 * chapters, and renders a clickable list that seeks the parent <video>.
 * Adapted from CIRKLE's smart-chapters overlay.
 */
export function SmartChapters({
  videoId,
  durationSec,
  videoRef,
}: {
  videoId: string;
  durationSec: number;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [open, setOpen] = useState(false);
  const [chapters, setChapters] = useState<Chapter[] | null>(null);
  const [active, setActive] = useState<number>(0);

  useEffect(() => {
    const handler = () => setOpen(true);
    window.addEventListener("mashahd:ai-chapters", handler);
    return () => window.removeEventListener("mashahd:ai-chapters", handler);
  }, []);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/ai/chapters", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ videoId }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json() as Promise<{ ok: boolean; chapters: Chapter[]; source: string }>;
    },
    onSuccess: (data) => {
      setChapters(data.chapters);
      setActive(0);
      if (data.source === "fallback") toast.info("AI offline — showing auto chapters");
      else toast.success(`${data.chapters.length} chapters detected`);
    },
    onError: () => toast.error("Could not analyze chapters"),
  });

  useEffect(() => {
    if (open && !chapters && !mutation.isPending) mutation.mutate();
  }, [open, videoId]);

  const seek = useCallback(
    (sec: number, idx: number) => {
      const v = videoRef.current;
      if (v) {
        v.currentTime = sec;
        v.play().catch(() => {});
      }
      setActive(idx);
    },
    [videoRef]
  );

  // Track active chapter based on playback position
  useEffect(() => {
    const v = videoRef.current;
    if (!v || !chapters) return;
    const onTime = () => {
      const t = v.currentTime;
      let idx = 0;
      for (let i = 0; i < chapters.length; i++) {
        if (t >= chapters[i].seconds) idx = i;
      }
      setActive(idx);
    };
    v.addEventListener("timeupdate", onTime);
    return () => v.removeEventListener("timeupdate", onTime);
  }, [videoRef, chapters]);

  if (!open) return null;

  return (
    <div className="mt-4">
      <div className="rounded-xl border border-border bg-muted/40 overflow-hidden">
        <div className="flex items-center justify-between px-4 py-2.5 border-b border-border">
          <div className="flex items-center gap-2">
            <ListVideo className="h-4 w-4 text-[hsl(var(--gold))]" />
            <span className="text-sm font-semibold">Smart Chapters</span>
            <span className="text-[10px] text-muted-foreground bg-background px-1.5 py-0.5 rounded">
              AI
            </span>
          </div>
          <div className="flex items-center gap-1">
            <button
              onClick={() => mutation.mutate()}
              disabled={mutation.isPending}
              className="text-muted-foreground hover:text-foreground p-1.5 rounded-full hover:bg-accent"
              aria-label="Regenerate chapters"
              title="Regenerate"
            >
              <Sparkles className={cn("h-3.5 w-3.5", mutation.isPending && "animate-spin")} />
            </button>
            <button
              onClick={() => setOpen(false)}
              className="text-muted-foreground hover:text-foreground p-1.5 rounded-full hover:bg-accent"
              aria-label="Close chapters"
            >
              <X className="h-3.5 w-3.5" />
            </button>
          </div>
        </div>

        <div className="max-h-72 overflow-y-auto custom-scroll">
          {mutation.isPending && !chapters ? (
            <div className="p-4 space-y-3">
              {Array.from({ length: 4 }).map((_, i) => (
                <div key={i} className="flex gap-3">
                  <div className="h-9 w-12 shimmer-gold rounded shrink-0" />
                  <div className="flex-1 space-y-1.5">
                    <div className="h-3 w-3/4 shimmer-gold rounded" />
                    <div className="h-2.5 w-1/2 shimmer-gold rounded" />
                  </div>
                </div>
              ))}
            </div>
          ) : chapters && chapters.length > 0 ? (
            <ol className="divide-y divide-border">
              {chapters.map((c, i) => {
                const isActive = i === active;
                return (
                  <li key={i}>
                    <button
                      onClick={() => seek(c.seconds, i)}
                      className={cn(
                        "w-full flex items-start gap-3 px-4 py-2.5 text-left transition-colors",
                        isActive ? "bg-[hsl(var(--gold)/0.1)]" : "hover:bg-accent/50"
                      )}
                    >
                      <span
                        className={cn(
                          "shrink-0 text-xs font-mono tabular-nums mt-0.5 w-10",
                          isActive ? "text-[hsl(var(--gold))]" : "text-muted-foreground"
                        )}
                      >
                        {fmt(c.seconds)}
                      </span>
                      <div className="flex-1 min-w-0">
                        <p
                          className={cn(
                            "text-sm font-medium leading-snug line-clamp-1",
                            isActive && "text-[hsl(var(--gold))]"
                          )}
                        >
                          {c.title}
                        </p>
                        <p className="text-xs text-muted-foreground line-clamp-1 mt-0.5">
                          {c.summary}
                        </p>
                      </div>
                      <div className="flex items-center gap-1.5 shrink-0">
                        {c.mood && (
                          <span className="text-[10px] text-muted-foreground bg-background/80 px-1.5 py-0.5 rounded">
                            {c.mood}
                          </span>
                        )}
                        {isActive && <Play className="h-3 w-3 fill-current text-[hsl(var(--gold))]" />}
                      </div>
                    </button>
                  </li>
                );
              })}
            </ol>
          ) : (
            <p className="p-4 text-sm text-muted-foreground">No chapters available.</p>
          )}
        </div>
        {chapters && chapters.length > 0 && (
          <div className="px-4 py-2 border-t border-border bg-background/50">
            <div className="flex gap-0.5 h-1.5">
              {chapters.map((c, i) => (
                <button
                  key={i}
                  onClick={() => seek(c.seconds, i)}
                  style={{ flex: `1 1 ${(chapters[i + 1]?.seconds || durationSec) - c.seconds}` }}
                  className={cn(
                    "rounded-sm transition-colors",
                    i === active ? "bg-[hsl(var(--gold))]" : "bg-muted-foreground/30 hover:bg-muted-foreground/60"
                  )}
                  aria-label={`Jump to ${c.title}`}
                />
              ))}
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
