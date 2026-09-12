"use client";

import { useState, useMemo, useRef, useEffect } from "react";
import { useQuery } from "@tanstack/react-query";
import { FileText, Search, Loader2, X, ChevronUp, ChevronDown } from "lucide-react";
import { cn } from "@/lib/utils";

interface TranscriptSegment {
  start: number;
  end: number;
  text: string;
}

interface TranscriptResponse {
  transcript: TranscriptSegment[];
  source: "ai" | "fallback";
  cached?: boolean;
}

/**
 * TranscriptPanel — a searchable, click-to-seek transcript overlay for the
 * watch page. Renders timestamped segments; clicking a segment seeks the
 * player to that moment. A search box filters segments by text.
 *
 * The active segment (matching the player's currentTime) is highlighted
 * and auto-scrolled into view.
 */
export function TranscriptPanel({
  videoId,
  currentTime,
  onSeek,
  onClose,
}: {
  videoId: string;
  currentTime: number;
  onSeek: (t: number) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = useState("");
  const [collapsed, setCollapsed] = useState(false);
  const listRef = useRef<HTMLDivElement | null>(null);
  const activeRef = useRef<HTMLButtonElement | null>(null);

  const { data, isLoading, isError } = useQuery<TranscriptResponse>({
    queryKey: ["transcript", videoId],
    queryFn: async () => {
      const r = await fetch(`/api/ai/transcript?videoId=${videoId}`);
      if (!r.ok) throw new Error("failed");
      return r.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const segments = data?.transcript || [];

  // Find the active segment (the one whose [start, end] contains currentTime).
  const activeIdx = useMemo(() => {
    for (let i = 0; i < segments.length; i++) {
      const s = segments[i];
      if (currentTime >= s.start && currentTime < s.end) return i;
    }
    // If we're past the last segment's end, highlight the last one.
    if (segments.length > 0 && currentTime >= segments[segments.length - 1].end) {
      return segments.length - 1;
    }
    return -1;
  }, [segments, currentTime]);

  // Filter by search query.
  const filtered = useMemo(() => {
    if (!query.trim()) return segments.map((s, i) => ({ ...s, idx: i }));
    const q = query.toLowerCase();
    return segments
      .map((s, i) => ({ ...s, idx: i }))
      .filter((s) => s.text.toLowerCase().includes(q));
  }, [segments, query]);

  // Auto-scroll the active segment into view.
  useEffect(() => {
    if (activeRef.current && listRef.current) {
      activeRef.current.scrollIntoView({ block: "center", behavior: "smooth" });
    }
  }, [activeIdx]);

  const fmt = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <div className="rounded-xl border border-gold/30 bg-gradient-to-br from-gold/5 to-transparent overflow-hidden">
      {/* Header */}
      <div className="flex items-center gap-2 px-4 py-3 border-b border-gold/20 bg-gold/5">
        <FileText className="h-4 w-4 text-[hsl(var(--gold))]" />
        <h3 className="text-sm font-semibold flex-1">Transcript</h3>
        {data && (
          <span className="text-[10px] uppercase tracking-wider text-muted-foreground">
            {data.source === "ai" ? "AI-generated" : "Auto"}
            {data.cached ? " · cached" : ""}
          </span>
        )}
        <button
          onClick={() => setCollapsed((c) => !c)}
          className="text-muted-foreground hover:text-foreground"
          aria-label={collapsed ? "Expand" : "Collapse"}
        >
          {collapsed ? <ChevronDown className="h-4 w-4" /> : <ChevronUp className="h-4 w-4" />}
        </button>
        <button
          onClick={onClose}
          className="text-muted-foreground hover:text-foreground"
          aria-label="Close transcript"
        >
          <X className="h-4 w-4" />
        </button>
      </div>

      {!collapsed && (
        <>
          {/* Search box */}
          <div className="relative px-3 py-2 border-b border-border/50">
            <Search className="absolute left-5 top-1/2 -translate-y-1/2 h-3.5 w-3.5 text-muted-foreground" />
            <input
              type="text"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              placeholder="Search transcript…"
              className="w-full pl-7 pr-3 py-1.5 text-sm rounded-lg bg-background/60 border border-border/60 focus:border-gold/40 focus:outline-none"
            />
          </div>

          {/* Segments */}
          <div
            ref={listRef}
            className="max-h-80 overflow-y-auto p-2 space-y-0.5"
          >
            {isLoading ? (
              <div className="flex items-center justify-center py-8">
                <Loader2 className="h-5 w-5 animate-spin text-muted-foreground" />
              </div>
            ) : isError ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                Couldn&apos;t generate a transcript.
              </p>
            ) : filtered.length === 0 ? (
              <p className="text-sm text-muted-foreground text-center py-8">
                No segments match &ldquo;{query}&rdquo;.
              </p>
            ) : (
              filtered.map((seg) => {
                const isActive = seg.idx === activeIdx;
                return (
                  <button
                    key={seg.idx}
                    ref={isActive ? activeRef : null}
                    onClick={() => onSeek(seg.start)}
                    className={cn(
                      "w-full text-left flex gap-3 rounded-lg px-3 py-2 transition-colors",
                      isActive
                        ? "bg-gold/15 border-l-2 border-[hsl(var(--gold))]"
                        : "hover:bg-accent/40 border-l-2 border-transparent"
                    )}
                  >
                    <span
                      className={cn(
                        "shrink-0 text-xs font-mono tabular-nums pt-0.5",
                        isActive ? "text-[hsl(var(--gold))]" : "text-muted-foreground"
                      )}
                    >
                      {fmt(seg.start)}
                    </span>
                    <span
                      className={cn(
                        "text-sm leading-snug",
                        isActive ? "text-foreground font-medium" : "text-foreground/80"
                      )}
                    >
                      {seg.text}
                    </span>
                  </button>
                );
              })
            )}
          </div>
        </>
      )}
    </div>
  );
}
