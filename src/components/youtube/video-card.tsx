"use client";

import { useState, useRef, useEffect } from "react";
import {
  Heart,
  Bookmark,
  Check,
  MoreHorizontal,
  ThumbsDown,
  Eye,
  Ban,
  Tag,
  Info,
  Play,
} from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAppStore } from "@/store/app-store";
import { formatViews, formatDuration, timeAgo, getImageUrl } from "@/lib/format";
import type { Video } from "@/lib/types";
import { cn } from "@/lib/utils";
import { VerifiedBadge } from "./verified-badge";
import { VideoMoodRing } from "./video-mood-ring";
import { useBrowserId } from "@/hooks/use-browser-id";
import { toast } from "sonner";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuItem,
  DropdownMenuLabel,
  DropdownMenuSeparator,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Popover,
  PopoverContent,
  PopoverTrigger,
} from "@/components/ui/popover";

// Valid recommendation-feedback reasons (must match the backend allow-list
// in /api/recommendation-feedback/route.ts).
type FeedbackReason =
  | "not_interested"
  | "already_watched"
  | "dont_like_creator"
  | "wrong_topic";

type FeedbackOption = {
  reason: FeedbackReason;
  label: string;
  icon: typeof ThumbsDown;
  toast: string;
};

const FEEDBACK_OPTIONS: FeedbackOption[] = [
  {
    reason: "not_interested",
    label: "Not interested",
    icon: ThumbsDown,
    toast: "Noted. Video hidden from recommendations.",
  },
  {
    reason: "already_watched",
    label: "Already watched",
    icon: Eye,
    toast: "Marked as already watched. Video hidden from recommendations.",
  },
  {
    reason: "dont_like_creator",
    label: "Don't recommend this channel",
    icon: Ban,
    toast: "Channel blocked. Its videos are hidden from recommendations.",
  },
  {
    reason: "wrong_topic",
    label: "Wrong topic",
    icon: Tag,
    toast: "Topic blocked. Similar videos are hidden from recommendations.",
  },
];

export function VideoCard({ video, reasons }: { video: Video; reasons?: string[] }) {
  const { navigate } = useAppStore();
  const bid = useBrowserId();
  const [fav, setFav] = useState(false);
  const [later, setLater] = useState(false);
  const [hidden, setHidden] = useState(false);
  const [isHovering, setIsHovering] = useState(false);
  const [watchProgress, setWatchProgress] = useState(0); // 0-100
  const previewVideoRef = useRef<HTMLVideoElement | null>(null);
  const hoverTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const duration = formatDuration(video.durationSec);
  const when = timeAgo(video.createdAt);
  const viewsLabel = formatViews(video.views);

  // ── Cinematic hover-preview (Pass 63) ──
  // When the user hovers for >600ms, we load the actual video file muted
  // + start playing a silent preview. This gives a cinematic "living
  // thumbnail" effect that outperforms YouTube's static thumbnails.
  // On mouse leave, we pause + reset.
  useEffect(() => {
    return () => {
      if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    };
  }, []);

  const startPreview = () => {
    // Clear any existing timer.
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    // Delay the preview by 600ms to avoid accidental triggers on scroll.
    hoverTimerRef.current = setTimeout(() => {
      setIsHovering(true);
      // Start the preview video after state update.
      requestAnimationFrame(() => {
        const v = previewVideoRef.current;
        if (v) {
          v.currentTime = 0;
          v.play().catch(() => {
            // Autoplay might be blocked — that's fine, the static image stays.
          });
        }
      });
    }, 600);
  };

  const stopPreview = () => {
    if (hoverTimerRef.current) clearTimeout(hoverTimerRef.current);
    setIsHovering(false);
    const v = previewVideoRef.current;
    if (v) {
      v.pause();
      v.currentTime = 0;
    }
  };

  // Fetch watch progress from continue-watching API (for the progress bar).
  useEffect(() => {
    if (!bid) return;
    fetch(`/api/continue-watching?bid=${encodeURIComponent(bid)}`)
      .then((r) => r.ok ? r.json() : null)
      .then((data) => {
        if (data?.items) {
          const item = data.items.find((i: any) => i.videoId === video.id);
          if (item && video.durationSec > 0) {
            setWatchProgress(Math.min(100, (item.position / video.durationSec) * 100));
          }
        }
      })
      .catch(() => {});
  }, [bid, video.id, video.durationSec]);

  // Hide the card entirely once the user has given negative feedback (§10).
  if (hidden) return null;

  const toggleFav = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !fav;
    setFav(next);
    try {
      await fetch("/api/user-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, videoId: video.id, action: next ? "favorite" : "unfavorite" }),
      });
      toast.success(next ? "Added to Favorites" : "Removed from Favorites");
    } catch {
      setFav(!next);
    }
  };

  const toggleLater = async (e: React.MouseEvent) => {
    e.stopPropagation();
    const next = !later;
    setLater(next);
    try {
      await fetch("/api/user-state", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, videoId: video.id, action: next ? "watchLater" : "removeLater" }),
      });
      toast.success(next ? "Added to Watch Later" : "Removed from queue");
    } catch {
      setLater(!next);
    }
  };

  const handleFeedback = async (option: FeedbackOption) => {
    // Optimistically hide the card so the feed updates instantly.
    setHidden(true);

    // Always record the recommendation feedback (§10).
    try {
      await fetch("/api/recommendation-feedback", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, videoId: video.id, reason: option.reason }),
      });
    } catch {
      // Network failure — unhide the card so the user can retry.
      setHidden(false);
      toast.error("Couldn't submit feedback. Please try again.");
      return;
    }

    // For "dont_like_creator" the backend already creates a creator block, but
    // per the spec §11 we also POST it explicitly via /api/blocks so the block
    // surfaces in the user's block list and affects Search / Discovery too.
    // The blocks endpoint upserts, so the duplicate call is idempotent.
    if (option.reason === "dont_like_creator") {
      try {
        await fetch("/api/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            browserId: bid,
            blockType: "creator",
            blockValue: video.channelId,
          }),
        });
      } catch {
        // Feedback was already recorded — don't surface a hard error.
      }
    }

    // Same for "wrong_topic" — explicitly persist the topic block.
    if (option.reason === "wrong_topic") {
      try {
        await fetch("/api/blocks", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            browserId: bid,
            blockType: "topic",
            blockValue: video.category,
          }),
        });
      } catch {
        // Feedback was already recorded — don't surface a hard error.
      }
    }

    toast.success(option.toast, { duration: 4000 });
  };

  const hasReasons = reasons && reasons.length > 0;

  return (
    <article
      className="flex flex-col cursor-pointer group transition-transform duration-300 hover:-translate-y-1"
      onClick={() => navigate({ kind: "watch", videoId: video.id })}
      onMouseEnter={startPreview}
      onMouseLeave={stopPreview}
    >
      {/* Thumbnail — cinematic hover-preview (Pass 63) + premium card glow (Pass 75) */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted shadow-soft transition-all duration-500 group-hover:shadow-glow group-hover:rounded-2xl">
        {/* Static thumbnail (always visible, fades out on hover-preview) */}
        <img
          src={getImageUrl(video.thumbnailUrl, video.title)}
          alt={video.title}
          loading="lazy"
          className={cn(
            "h-full w-full object-cover transition-all duration-500 group-hover:scale-[1.03]",
            isHovering && "opacity-0"
          )}
        />
        {/* Hover-preview video (loads on demand, muted, plays for ~3s).
            Only rendered when videoUrl is non-empty — prevents the
            "empty string passed to src" console error. */}
        {video.videoUrl && video.videoUrl.trim().length > 0 && (
        <video
          ref={previewVideoRef}
          src={video.videoUrl}
          muted
          loop
          playsInline
          preload="none"
          className={cn(
            "absolute inset-0 h-full w-full object-cover transition-opacity duration-500",
            isHovering ? "opacity-100" : "opacity-0 pointer-events-none"
          )}
        />
        )}
        {/* Cinematic gradient overlay — bottom shadow for legibility */}
        <div className="absolute inset-0 bg-gradient-to-t from-black/50 via-transparent to-transparent pointer-events-none" />
        {/* Duration badge */}
        <span className="absolute bottom-1.5 right-1.5 bg-black/85 text-white text-[11px] font-medium px-1.5 py-0.5 rounded leading-none tabular-nums">
          {duration}
        </span>
        {/* Watch progress bar — shows how much the user has already watched */}
        {watchProgress > 0 && (
          <div className="absolute bottom-0 left-0 right-0 h-1 bg-black/30">
            <div
              className="h-full bg-gradient-gold transition-all duration-300"
              style={{ width: `${watchProgress}%` }}
            />
          </div>
        )}
        {/* Hover-preview indicator — subtle play pulse */}
        {isHovering && (
          <div className="absolute inset-0 grid place-items-center pointer-events-none">
            <div className="grid place-items-center h-12 w-12 rounded-full bg-black/40 backdrop-blur-sm border border-white/20">
              <Play className="h-5 w-5 text-white fill-current ml-0.5" />
            </div>
          </div>
        )}
        {/* Favorite + Watch Later quick actions — appear on hover */}
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={toggleFav}
            className={cn(
              "grid place-items-center min-h-[44px] min-w-[44px] h-11 w-11 rounded-full backdrop-blur transition-colors",
              fav ? "bg-rose text-white" : "bg-black/70 text-white hover:bg-black/90"
            )}
            aria-label={fav ? "Remove from Favorites" : "Add to Favorites"}
            title={fav ? "Remove from Favorites" : "Add to Favorites"}
          >
            <Heart className={cn("h-4 w-4", fav && "fill-current")} />
          </button>
          <button
            onClick={toggleLater}
            className={cn(
              "grid place-items-center min-h-[44px] min-w-[44px] h-11 w-11 rounded-full backdrop-blur transition-colors",
              later ? "bg-gold text-charcoal" : "bg-black/70 text-white hover:bg-black/90"
            )}
            aria-label={later ? "Remove from Watch Later" : "Add to Watch Later"}
            title={later ? "Remove from Watch Later" : "Add to Watch Later"}
          >
            {later ? <Check className="h-4 w-4" /> : <Bookmark className="h-4 w-4" />}
          </button>
        </div>
      </div>

      {/* Meta */}
      <div className="flex gap-3 mt-3 px-0.5">
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate({ kind: "channel", channelId: video.channelId });
          }}
          className="shrink-0"
          aria-label={`Go to ${video.channel.name}`}
        >
          <Avatar className="h-9 w-9 rounded-full">
            <AvatarImage src={video.channel.avatarUrl} alt="" />
            <AvatarFallback>{video.channel.name.slice(0, 1)}</AvatarFallback>
          </Avatar>
        </button>
        <div className="min-w-0 flex-1">
          <div className="flex items-start gap-1">
            <h3 className="min-w-0 flex-1 text-sm font-medium leading-snug line-clamp-2 text-foreground">
              {video.title}
            </h3>
            {/* "..." More menu — negative recommendation controls (§10).
                Positioned at the top-right of the meta section, NOT on the
                thumbnail, so it doesn't overlap the Favorite / Watch Later
                quick actions. Appears on hover. */}
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="shrink-0 grid place-items-center h-8 w-8 -mr-1.5 -mt-1 rounded-full text-muted-foreground hover:text-foreground hover:bg-accent transition-colors opacity-0 focus:opacity-100 group-hover:opacity-100 data-[state=open]:opacity-100"
                  aria-label="More options"
                  title="More options"
                >
                  <MoreHorizontal className="h-4 w-4" />
                </button>
              </DropdownMenuTrigger>
              <DropdownMenuContent
                align="end"
                onClick={(e) => e.stopPropagation()}
              >
                <DropdownMenuLabel className="text-xs text-muted-foreground">
                  Tell us about this video
                </DropdownMenuLabel>
                <DropdownMenuSeparator />
                {FEEDBACK_OPTIONS.map((option) => {
                  const Icon = option.icon;
                  return (
                    <DropdownMenuItem
                      key={option.reason}
                      onSelect={() => handleFeedback(option)}
                    >
                      <Icon className="h-4 w-4" />
                      <span>{option.label}</span>
                    </DropdownMenuItem>
                  );
                })}
              </DropdownMenuContent>
            </DropdownMenu>
          </div>
          <button
            onClick={(e) => {
              e.stopPropagation();
              navigate({ kind: "channel", channelId: video.channelId });
            }}
            className="block mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors text-left truncate inline-flex items-center gap-1"
          >
            <span className="truncate">{video.channel.name}</span>
            {video.channel.subscribers >= 1_000_000 && <VerifiedBadge size={12} />}
          </button>
          <p className="text-xs text-muted-foreground truncate">
            {viewsLabel} • {when}
          </p>
          {/* "Why am I seeing this?" — spec §8 transparency. The FYP API
              returns a `reasons` array per video; show it as a small popover
              triggered by an Info icon below the title. */}
          {hasReasons && (
            <Popover>
              <PopoverTrigger asChild>
                <button
                  onClick={(e) => e.stopPropagation()}
                  className="mt-1 inline-flex items-center gap-1 text-[11px] text-muted-foreground/80 hover:text-foreground transition-colors"
                  aria-label="Why am I seeing this?"
                  title="Why am I seeing this?"
                >
                  <Info className="h-3 w-3" />
                  <span>Why am I seeing this?</span>
                </button>
              </PopoverTrigger>
              <PopoverContent
                align="start"
                className="w-72 text-xs"
                onClick={(e) => e.stopPropagation()}
              >
                <p className="font-medium text-foreground mb-1.5">
                  Why we recommended this
                </p>
                <ul className="space-y-1.5">
                  {reasons.map((r, i) => (
                    <li key={i} className="flex items-start gap-1.5 text-muted-foreground">
                      <span
                        className="mt-1 h-1 w-1 shrink-0 rounded-full bg-gold"
                        aria-hidden
                      />
                      <span>{r}</span>
                    </li>
                  ))}
                </ul>
              </PopoverContent>
            </Popover>
          )}
        </div>
      </div>
    </article>
  );
}

/**
 * Compact horizontal card used in search results and the watch-page sidebar.
 */
export function VideoCardHorizontal({ video }: { video: Video }) {
  const { navigate } = useAppStore();
  const duration = formatDuration(video.durationSec);
  const when = timeAgo(video.createdAt);
  const viewsLabel = formatViews(video.views);

  return (
    <article
      className="flex gap-2 cursor-pointer group"
      onClick={() => navigate({ kind: "watch", videoId: video.id })}
    >
      <div className="relative w-40 sm:w-[168px] shrink-0 aspect-video overflow-hidden rounded-lg bg-muted">
        <img
          src={getImageUrl(video.thumbnailUrl, video.title)}
          alt={video.title}
          loading="lazy"
          className="h-full w-full object-cover"
        />
        <span className="absolute bottom-1 right-1 bg-black/85 text-white text-[11px] font-medium px-1 py-0.5 rounded leading-none tabular-nums">
          {duration}
        </span>
      </div>
      <div className="flex-1 min-w-0">
        <h3 className={cn("text-sm font-medium leading-snug line-clamp-2")}>
          {video.title}
        </h3>
        <p className="mt-1 text-xs text-muted-foreground">
          {formatViews(video.views)} • {when}
        </p>
        <button
          onClick={(e) => {
            e.stopPropagation();
            navigate({ kind: "channel", channelId: video.channelId });
          }}
          className="flex items-center gap-1.5 mt-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors"
        >
          <Avatar className="h-5 w-5 rounded-full">
            <AvatarImage src={video.channel.avatarUrl} alt="" />
            <AvatarFallback className="text-[10px]">
              {video.channel.name.slice(0, 1)}
            </AvatarFallback>
          </Avatar>
          <span className="truncate">{video.channel.name}</span>
        </button>
        <p className="mt-1 text-xs text-muted-foreground line-clamp-2 hidden sm:block">
          {video.description}
        </p>
      </div>
    </article>
  );
}
