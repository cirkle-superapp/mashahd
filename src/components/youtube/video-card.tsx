"use client";

import { useState } from "react";
import { Heart, Bookmark, Check } from "lucide-react";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAppStore } from "@/store/app-store";
import { formatViews, formatDuration, timeAgo } from "@/lib/format";
import type { Video } from "@/lib/types";
import { cn } from "@/lib/utils";
import { VerifiedBadge } from "./verified-badge";
import { useBrowserId } from "@/hooks/use-browser-id";
import { toast } from "sonner";

export function VideoCard({ video }: { video: Video }) {
  const { navigate } = useAppStore();
  const bid = useBrowserId();
  const [fav, setFav] = useState(false);
  const [later, setLater] = useState(false);
  const duration = formatDuration(video.durationSec);
  const when = timeAgo(video.createdAt);
  const viewsLabel = formatViews(video.views);

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

  return (
    <article
      className="flex flex-col cursor-pointer group"
      onClick={() => navigate({ kind: "watch", videoId: video.id })}
    >
      {/* Thumbnail */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-muted">
        <img
          src={video.thumbnailUrl}
          alt={video.title}
          loading="lazy"
          className="h-full w-full object-cover transition-transform duration-300 group-hover:scale-[1.02]"
        />
        <span className="absolute bottom-1.5 right-1.5 bg-black/85 text-white text-[11px] font-medium px-1.5 py-0.5 rounded leading-none tabular-nums">
          {duration}
        </span>
        {/* Favorite + Watch Later quick actions — appear on hover */}
        <div className="absolute top-1.5 right-1.5 flex flex-col gap-1.5 opacity-0 group-hover:opacity-100 transition-opacity">
          <button
            onClick={toggleFav}
            className={cn(
              "grid place-items-center h-8 w-8 rounded-full backdrop-blur transition-colors",
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
              "grid place-items-center h-8 w-8 rounded-full backdrop-blur transition-colors",
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
          <h3 className="text-sm font-medium leading-snug line-clamp-2 text-foreground">
            {video.title}
          </h3>
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
          src={video.thumbnailUrl}
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
