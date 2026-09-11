"use client";

import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAppStore } from "@/store/app-store";
import { formatViews, formatDuration, timeAgo } from "@/lib/format";
import type { Video } from "@/lib/types";
import { cn } from "@/lib/utils";

export function VideoCard({ video }: { video: Video }) {
  const { navigate } = useAppStore();
  const duration = formatDuration(video.durationSec);
  const when = timeAgo(video.createdAt);
  const viewsLabel = formatViews(video.views);

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
            className="block mt-1 text-xs text-muted-foreground hover:text-foreground transition-colors text-left truncate"
          >
            {video.channel.name}
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
