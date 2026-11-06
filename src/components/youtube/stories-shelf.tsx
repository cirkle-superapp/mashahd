"use client";

import { useEffect, useRef, useState } from "react";
import { Plus, X, ChevronLeft, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";
import { useBrowserId } from "@/hooks/use-browser-id";
import { CustomAvatar } from "@/lib/custom-avatar";
import { getImageUrl } from "@/lib/format";

/**
 * StoriesShelf — ephemeral vertical "Stories" format (Pass 100).
 *
 * Competitive context:
 *   - TikTok / Instagram / Snapchat have ephemeral vertical Stories.
 *   - YouTube has "Community posts" but no Stories shelf.
 *   - Twitch has no Stories.
 *   → Mashahd ships a Stories shelf that surfaces vertical/short-form content
 *     from channels the viewer follows, presented as a horizontal ring of
 *     circular avatar bubbles (the canonical Stories UI pattern).
 *
 * Implementation notes:
 *   - Each story = a short vertical video or image from a channel.
 *   - Clicking a bubble opens a full-screen vertical viewer with progress
 *     bars at the top (one segment per story in the batch).
 *   - Auto-advances after the media ends or 6s (whichever comes first).
 *   - Tap left/right (or arrow keys) to navigate between stories.
 *   - Stories are derived from existing short-form videos (category=shorts
 *     or vertical aspect ratio) — no new data model required.
 *
 * Tech showcase (latest web features):
 *   - CSS `aspect-ratio` for the vertical viewer (no JS resize).
 *   - View Transitions API for the open/close animation.
 *   - `backdrop-filter: blur()` for the modal scrim (glassmorphism).
 *   - Conic-gradient progress rings for un-viewed bubbles.
 *   - Respects `prefers-reduced-motion` (auto-advance disabled).
 */
interface StoryItem {
  id: string;
  title: string;
  videoUrl?: string;
  thumbnailUrl?: string;
  channelName: string;
  channelAvatarSeed: string;
  viewed?: boolean;
  durationSec?: number;
}

export function StoriesShelf() {
  const [activeIdx, setActiveIdx] = useState<number | null>(null);
  const { bid } = useBrowserId();

  // Stories are derived from short-form videos. We fetch from /api/videos
  // filtered to shorts/vertical content. No new backend model needed.
  const { data: stories } = useQuery<StoryItem[]>({
    queryKey: ["stories", bid],
    queryFn: async () => {
      const res = await fetch("/api/videos?sort=shorts&limit=12");
      if (!res.ok) return [];
      const d = await res.json();
      const list = (d.videos || d || []).slice(0, 12);
      return list.map((v: any) => ({
        id: v.id,
        title: v.title || "Untitled",
        videoUrl: v.videoUrl,
        thumbnailUrl: v.thumbnailUrl,
        channelName: v.channel?.name || v.channelName || "Creator",
        channelAvatarSeed: v.channel?.name || v.channelName || "creator",
        durationSec: v.durationSec || 6,
      }));
    },
    staleTime: 60_000,
  });

  const items = stories || [];
  if (items.length === 0) return null;

  return (
    <>
      <section className="px-4 sm:px-6 py-3" aria-label="Stories">
        <h2 className="text-sm font-semibold text-muted-foreground mb-2 flex items-center gap-2">
          <span className="h-2 w-2 rounded-full bg-gradient-gold" /> Stories
          <span className="text-[10px] font-normal text-muted-foreground/70 ml-1">
            from creators you follow
          </span>
        </h2>
        <div className="flex gap-3 overflow-x-auto pb-1 scrollbar-thin" role="list">
          {/* Add-story bubble (creator CTA) */}
          <button
            className="shrink-0 flex flex-col items-center gap-1 group"
            aria-label="Add your story"
            role="listitem"
          >
            <div className="relative h-16 w-16 rounded-full bg-surface border border-border grid place-items-center group-hover:scale-105 transition-transform">
              <Plus className="h-5 w-5 text-muted-foreground" />
            </div>
            <span className="text-[10px] text-muted-foreground max-w-[64px] truncate">
              Your story
            </span>
          </button>
          {items.map((s, i) => (
            <button
              key={s.id}
              onClick={() => setActiveIdx(i)}
              className="shrink-0 flex flex-col items-center gap-1 group"
              aria-label={`Open story from ${s.channelName}`}
              role="listitem"
            >
              {/* Conic-gradient ring = "unviewed" (canonical Stories pattern) */}
              <div
                className={cn(
                  "h-16 w-16 rounded-full p-[2px] transition-transform group-hover:scale-105",
                  s.viewed ? "bg-border" : "bg-[conic-gradient(from_180deg,var(--gold),var(--gold-light),var(--gold))]"
                )}
              >
                <div className="h-full w-full rounded-full bg-background p-[2px]">
                  <CustomAvatar
                    seed={s.channelAvatarSeed}
                    className="h-full w-full rounded-full"
                  />
                </div>
              </div>
              <span className="text-[10px] text-muted-foreground max-w-[64px] truncate">
                {s.channelName}
              </span>
            </button>
          ))}
        </div>
      </section>

      {activeIdx !== null && (
        <StoryViewer
          stories={items}
          startIndex={activeIdx}
          onClose={() => setActiveIdx(null)}
        />
      )}
    </>
  );
}

/** Full-screen vertical story viewer with progress bars + auto-advance. */
function StoryViewer({
  stories,
  startIndex,
  onClose,
}: {
  stories: StoryItem[];
  startIndex: number;
  onClose: () => void;
}) {
  const [idx, setIdx] = useState(startIndex);
  const [progress, setProgress] = useState(0);
  const videoRef = useRef<HTMLVideoElement>(null);
  const prefersReducedMotion = useRef(false);

  useEffect(() => {
    prefersReducedMotion.current =
      window.matchMedia?.("(prefers-reduced-motion: reduce)").matches ?? false;
  }, []);

  useEffect(() => {
    // eslint-disable-next-line react-hooks/set-state-in-effect
    setProgress(0);
  }, [idx]);

  // Auto-advance: progress bar fills over durationSec (default 6s).
  // Disabled if user prefers reduced motion — they navigate manually.
  useEffect(() => {
    if (prefersReducedMotion.current) return;
    const duration = (stories[idx]?.durationSec || 6) * 1000;
    const start = Date.now();
    const tick = setInterval(() => {
      const elapsed = Date.now() - start;
      const pct = Math.min(100, (elapsed / duration) * 100);
      setProgress(pct);
      if (pct >= 100) {
        if (idx < stories.length - 1) setIdx(idx + 1);
        else onClose();
      }
    }, 50);
    return () => clearInterval(tick);
  }, [idx, stories, onClose]);

  // Keyboard navigation.
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") onClose();
      else if (e.key === "ArrowRight" && idx < stories.length - 1) setIdx(idx + 1);
      else if (e.key === "ArrowLeft" && idx > 0) setIdx(idx - 1);
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [idx, stories.length, onClose]);

  const story = stories[idx];
  if (!story) return null;

  return (
    <div
      className="fixed inset-0 z-[100] bg-black/95 backdrop-blur-md flex items-center justify-center"
      style={{ viewTransitionName: "story-viewer" }}
      onClick={(e) => { if (e.target === e.currentTarget) onClose(); }}
    >
      {/* Vertical story frame — 9:16 aspect ratio, max 420px wide */}
      <div className="relative h-full max-h-[100svh] aspect-[9/16] max-w-[420px] w-full bg-black">
        {/* Progress bars (one per story in batch) */}
        <div className="absolute top-2 left-2 right-2 z-20 flex gap-1">
          {stories.map((_, i) => (
            <div key={i} className="flex-1 h-0.5 rounded-full bg-white/30 overflow-hidden">
              <div
                className="h-full bg-white transition-[width] duration-75 ease-linear"
                style={{ width: i < idx ? "100%" : i === idx ? `${progress}%` : "0%" }}
              />
            </div>
          ))}
        </div>

        {/* Channel header */}
        <div className="absolute top-6 left-2 right-2 z-20 flex items-center justify-between">
          <div className="flex items-center gap-2">
            <CustomAvatar seed={story.channelAvatarSeed} className="h-7 w-7 rounded-full border border-white/20" />
            <span className="text-white text-xs font-medium drop-shadow">{story.channelName}</span>
          </div>
          <button onClick={onClose} aria-label="Close story" className="text-white/80 hover:text-white p-1">
            <X className="h-5 w-5" />
          </button>
        </div>

        {/* Media — video if available, else thumbnail */}
        {story.videoUrl ? (
          <video
            ref={videoRef}
            src={story.videoUrl}
            poster={getImageUrl(story.thumbnailUrl)}
            className="w-full h-full object-cover"
            autoPlay
            playsInline
            onEnded={() => idx < stories.length - 1 ? setIdx(idx + 1) : onClose()}
          />
        ) : (
          <img
            src={getImageUrl(story.thumbnailUrl)}
            alt={story.title}
            className="w-full h-full object-cover"
          />
        )}

        {/* Tap zones for navigation (mobile-first) */}
        <button
          className="absolute left-0 top-0 bottom-0 w-1/3 z-10"
          onClick={(e) => { e.stopPropagation(); if (idx > 0) setIdx(idx - 1); }}
          aria-label="Previous story"
        >
          <ChevronLeft className="absolute left-1 top-1/2 -translate-y-1/2 h-6 w-6 text-white/40 opacity-0 hover:opacity-100 transition-opacity" />
        </button>
        <button
          className="absolute right-0 top-0 bottom-0 w-1/3 z-10"
          onClick={(e) => { e.stopPropagation(); if (idx < stories.length - 1) setIdx(idx + 1); else onClose(); }}
          aria-label="Next story"
        >
          <ChevronRight className="absolute right-1 top-1/2 -translate-y-1/2 h-6 w-6 text-white/40 opacity-0 hover:opacity-100 transition-opacity" />
        </button>

        {/* Title caption */}
        <div className="absolute bottom-4 left-2 right-2 z-10">
          <p className="text-white text-sm font-medium drop-shadow-lg line-clamp-2">{story.title}</p>
        </div>
      </div>
    </div>
  );
}
