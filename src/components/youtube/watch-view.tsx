"use client";

import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ThumbsUp, ThumbsDown, Download, MoreHorizontal, Bell, Sparkles, ListVideo, Languages, Loader2, Maximize2, MessageSquarePlus, Compass, Wand2, Heart, Bookmark, Check, ListPlus, Users, FileText, Scissors } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { useAppStore } from "@/store/app-store";
import { useMiniPlayer } from "@/store/mini-player-store";
import { useBrowserId } from "@/hooks/use-browser-id";
import { formatViews, formatSubs, formatCount, timeAgo } from "@/lib/format";
import type { VideoWithFlags, Comment, Video } from "@/lib/types";
import { cn } from "@/lib/utils";
import { VideoCard } from "./video-card";
import { SaveToPlaylist } from "./save-to-playlist";
import { WatchParty } from "./watch-party";
import { TranscriptPanel } from "./transcript-panel";
import { ClipDialog } from "./clip-dialog";
import { EndScreen } from "./end-screen";
import { AiRecap } from "./ai-recap";
import { SmartChapters } from "./smart-chapters";
import { CirclePulse } from "./circle-pulse";
import { BulletComments } from "./bullet-comments";
import { AiWatchPanel } from "./ai-watch-panel";
import { MashahdPlayer } from "./mashahd-player";
import { UserAvatar } from "./user-avatar";
import { ShareButton } from "./header-overlays";
import { toast } from "sonner";

async function fetchVideo(id: string, bid: string) {
  const sp = new URLSearchParams();
  if (bid) sp.set("bid", bid);
  const res = await fetch(`/api/videos/${id}?${sp.toString()}`);
  if (!res.ok) throw new Error("failed");
  const data = await res.json();
  return data as { video: VideoWithFlags; liked: boolean; subscribed: boolean };
}

async function fetchRelated(video: VideoWithFlags) {
  const res = await fetch(`/api/videos?channelId=${video.channelId}`);
  if (!res.ok) throw new Error("failed");
  const data = await res.json();
  // Exclude the current video, also pull a few from the same category
  const same = (data.videos as Video[]).filter((v) => v.id !== video.id);
  return same;
}

async function fetchComments(id: string) {
  const res = await fetch(`/api/videos/${id}/comments`);
  if (!res.ok) throw new Error("failed");
  const data = await res.json();
  return data.comments as Comment[];
}

export function WatchView({ videoId }: { videoId: string }) {
  const bid = useBrowserId();
  const qc = useQueryClient();
  const { navigate } = useAppStore();
  const [showFullDesc, setShowFullDesc] = useState(false);
  const [theater, setTheater] = useState(false);
  const [upNext, setUpNext] = useState(false);
  const [bulletsOn, setBulletsOn] = useState(false);
  const [paused, setPaused] = useState(false);
  const [saveOpen, setSaveOpen] = useState(false);
  const [partyOpen, setPartyOpen] = useState(false);
  const [clipOpen, setClipOpen] = useState(false);
  const [showTranscript, setShowTranscript] = useState(false);
  const [liveCurrentTime, setLiveCurrentTime] = useState(0);
  const [starterText, setStarterText] = useState("");
  const [fav, setFav] = useState(false);
  const [later, setLater] = useState(false);
  const viewsRecorded = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["video", videoId, bid],
    queryFn: () => fetchVideo(videoId, bid),
    enabled: !!bid,
  });

  const video = data?.video;

  const { data: related } = useQuery({
    queryKey: ["related", videoId],
    queryFn: () => fetchRelated(video!),
    enabled: !!video,
  });

  const { data: comments, refetch: refetchComments } = useQuery({
    queryKey: ["comments", videoId],
    queryFn: () => fetchComments(videoId),
    enabled: !!videoId,
  });

  // Record a view once when the watch page opens
  useEffect(() => {
    if (viewsRecorded.current) return;
    if (!videoId) return;
    viewsRecorded.current = true;
    fetch(`/api/videos/${videoId}/views`, { method: "POST" }).catch(() => {});
  }, [videoId]);

  // Record into watch history
  useEffect(() => {
    if (!bid || !videoId) return;
    fetch(`/api/user-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browserId: bid, action: "watch", videoId }),
    }).catch(() => {});
  }, [bid, videoId]);

  // On unmount, hand the video + current playback position to the mini-player
  // so it can keep playing in the floating corner. We only do this if the
  // video is actually playing (not ended/paused).
  useEffect(() => {
    return () => {
      const v = videoRef.current;
      if (!v || v.paused || v.ended) return;
      // `video` is available via closure because this effect re-runs when
      // the video data loads.
      if (video) {
        useMiniPlayer.getState().setVideo({
          videoId: video.id,
          videoTitle: video.title,
          videoUrl: video.videoUrl,
          thumbnailUrl: video.thumbnailUrl,
          channelName: video.channel.name,
          currentTime: v.currentTime,
        });
      }
    };
  }, [video]);

  // Sync the mini-player's saved currentTime back into the full player when
  // returning to this watch page via the mini-player's expand button.
  useEffect(() => {
    const mini = useMiniPlayer.getState();
    if (mini.videoId === videoId && mini.currentTime > 0 && videoRef.current) {
      // Defer to next frame so the video element is ready.
      requestAnimationFrame(() => {
        if (videoRef.current) {
          videoRef.current.currentTime = mini.currentTime;
          videoRef.current.play().catch(() => {});
        }
        // Clear the mini-player since the full page has taken over.
        useMiniPlayer.getState().close();
      });
    }
  }, [videoId, video]);

  // Update URL hash when watching so deep-link to a timestamp works (no-op demo)

  // Listen for command-palette events that toggle Transcript / Clip.
  useEffect(() => {
    const onToggleTranscript = () => setShowTranscript((s) => !s);
    const onOpenClip = () => setClipOpen(true);
    window.addEventListener("mashahd:toggle-transcript", onToggleTranscript as EventListener);
    window.addEventListener("mashahd:open-clip", onOpenClip as EventListener);
    return () => {
      window.removeEventListener("mashahd:toggle-transcript", onToggleTranscript as EventListener);
      window.removeEventListener("mashahd:open-clip", onOpenClip as EventListener);
    };
  }, []);

  const likeMutation = useMutation({
    mutationFn: async (action: "like" | "unlike") => {
      const res = await fetch(`/api/videos/${videoId}/like`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, action }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onSuccess: (_data, action) => {
      qc.setQueryData(["video", videoId, bid], (old: any) => {
        if (!old) return old;
        const delta = action === "like" ? 1 : -1;
        return {
          ...old,
          video: { ...old.video, likes: old.video.likes + delta },
          liked: action === "like",
        };
      });
    },
  });

  const subMutation = useMutation({
    mutationFn: async (action: "subscribe" | "unsubscribe") => {
      const res = await fetch(`/api/channels/${video!.channelId}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, action }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onSuccess: (_data, action) => {
      qc.setQueryData(["video", videoId, bid], (old: any) => {
        if (!old) return old;
        const delta = action === "subscribe" ? 1 : -1;
        return {
          ...old,
          video: {
            ...old.video,
            channel: {
              ...old.video.channel,
              subscribers: old.video.channel.subscribers + delta,
            },
          },
          subscribed: action === "subscribe",
        };
      });
      toast.success(
        action === "subscribe"
          ? `Subscribed to ${video!.channel.name}`
          : `Unsubscribed from ${video!.channel.name}`
      );
    },
  });

  if (isLoading) return <WatchSkeleton />;
  if (isError || !video) {
    return (
      <div className="px-6 py-24 text-center">
        <p className="text-lg font-medium text-muted-foreground">
          This video is unavailable
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate({ kind: "home" })}>
          Back to home
        </Button>
      </div>
    );
  }

  const liked = data?.liked;
  const subscribed = data?.subscribed;

  return (
    <div className={cn("px-0 sm:px-6 py-0 sm:py-4", theater && "sm:py-0")}>
      <div className={cn("flex flex-col gap-6 mx-auto", theater ? "max-w-none" : "max-w-[1400px]")}>
        {/* Main column — single-column layout (Mashahd identity, not
            YouTube's player + vertical sidebar split) */}
        <div className="w-full min-w-0">
          {/* MashahdPlayer — custom player with fullscreen, PiP, speed, etc. */}
          <MashahdPlayer
            src={video.videoUrl}
            poster={video.thumbnailUrl}
            videoId={video.id}
            autoPlay
            onPlay={() => { setPaused(false); setUpNext(false); }}
            onPause={() => setPaused(true)}
            onTimeUpdate={(t) => setLiveCurrentTime(t)}
            onEnded={() => setUpNext(true)}
          >
            {/* Bullet comments — floating danmaku overlay (adapted from CIRKLE) */}
            <BulletComments
              enabled={bulletsOn}
              onToggle={() => setBulletsOn((b) => !b)}
              paused={paused}
              videoId={video.id}
            />
            {/* Theater mode toggle — top-right of the player */}
            <button
              onClick={() => setTheater((t) => !t)}
              className={cn(
                "absolute top-2 left-12 z-10 px-2.5 py-1 rounded-full bg-black/70 hover:bg-black/90 text-white text-xs font-medium backdrop-blur flex items-center gap-1.5",
                upNext && "opacity-0 pointer-events-none"
              )}
              aria-label={theater ? "Exit theater mode" : "Theater mode"}
              title={theater ? "Exit theater mode" : "Theater mode"}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              {theater ? "Exit" : "Theater"}
            </button>
            {/* End screen — proper video-end overlay with up-next cards + countdown. */}
            <EndScreen
              show={upNext}
              videos={related || []}
              onReplay={() => {
                setUpNext(false);
                const v = videoRef.current;
                if (v) { v.currentTime = 0; v.play().catch(() => {}); }
              }}
              onPlayNext={(vid) => {
                setUpNext(false);
                navigate({ kind: "watch", videoId: vid });
              }}
              onDismiss={() => setUpNext(false)}
            />
          </MashahdPlayer>

          {/* Title */}
          <h1 className="mt-3 px-4 sm:px-0 text-lg sm:text-xl font-semibold leading-snug">
            {video.title}
          </h1>

          {/* Channel row + actions */}
          <div className="mt-3 px-4 sm:px-0 flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
            {/* Channel info + subscribe */}
            <div className="flex items-center gap-3">
              <button
                onClick={() => navigate({ kind: "channel", channelId: video.channelId })}
                aria-label={`Go to ${video.channel.name}`}
              >
                <Avatar className="h-10 w-10 rounded-full">
                  <AvatarImage src={video.channel.avatarUrl} alt="" />
                  <AvatarFallback>{video.channel.name.slice(0, 1)}</AvatarFallback>
                </Avatar>
              </button>
              <div className="min-w-0">
                <button
                  onClick={() => navigate({ kind: "channel", channelId: video.channelId })}
                  className="block text-sm font-semibold hover:opacity-80 text-left truncate"
                >
                  {video.channel.name}
                </button>
                <p className="text-xs text-muted-foreground">
                  {formatSubs(video.channel.subscribers)}
                </p>
              </div>
              <Button
                variant={subscribed ? "secondary" : "default"}
                size="sm"
                className={cn(
                  "rounded-full ml-2 h-9 px-4 font-medium",
                  subscribed
                    ? "bg-secondary text-secondary-foreground hover:bg-secondary/80"
                    : "bg-primary text-primary-foreground hover:bg-primary/90"
                )}
                onClick={() =>
                  subMutation.mutate(subscribed ? "unsubscribe" : "subscribe")
                }
                disabled={subMutation.isPending}
              >
                {subscribed ? (
                  <>
                    <Bell className="h-4 w-4 mr-1.5" /> Subscribed
                  </>
                ) : (
                  "Subscribe"
                )}
              </Button>
            </div>

            {/* Like / dislike / share actions */}
            <div className="flex items-center gap-2 flex-wrap">
              <div className="flex items-center bg-muted rounded-full overflow-hidden h-9">
                <button
                  onClick={() =>
                    likeMutation.mutate(liked ? "unlike" : "like")
                  }
                  disabled={likeMutation.isPending}
                  className={cn(
                    "flex items-center gap-2 px-4 h-full hover:bg-accent transition-colors text-sm font-medium",
                    liked && "text-teal-light"
                  )}
                  aria-label="Like"
                >
                  <ThumbsUp className={cn("h-5 w-5", liked && "fill-current")} />
                  <span className="tabular-nums">{formatCount(video.likes)}</span>
                </button>
                <div className="w-px h-6 bg-border" />
                <button
                  className="flex items-center gap-1 px-4 h-full hover:bg-accent transition-colors text-sm"
                  aria-label="Dislike"
                  title="Not a fan of this video"
                >
                  <ThumbsDown className="h-5 w-5" />
                </button>
              </div>
              <ShareButton videoId={video.id} title={video.title} />
              <Button
                variant="secondary"
                size="sm"
                className={cn(
                  "rounded-full h-9 px-4 border",
                  fav
                    ? "bg-rose/15 border-rose/40 text-rose"
                    : "bg-muted hover:bg-accent border-border"
                )}
                onClick={async () => {
                  const next = !fav;
                  setFav(next);
                  await fetch("/api/user-state", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ browserId: bid, videoId: video.id, action: next ? "favorite" : "unfavorite" }),
                  });
                  toast.success(next ? "Added to Favorites" : "Removed from Favorites");
                }}
                aria-label={fav ? "Remove from Favorites" : "Add to Favorites"}
                title={fav ? "Remove from Favorites" : "Add to Favorites"}
              >
                <Heart className={cn("h-4 w-4 mr-1.5", fav && "fill-current")} />
                {fav ? "Favorited" : "Favorite"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className={cn(
                  "rounded-full h-9 px-4 border hidden sm:inline-flex",
                  later
                    ? "bg-gold/15 border-gold/40 text-[hsl(var(--gold))]"
                    : "bg-muted hover:bg-accent border-border"
                )}
                onClick={async () => {
                  const next = !later;
                  setLater(next);
                  await fetch("/api/user-state", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({ browserId: bid, videoId: video.id, action: next ? "watchLater" : "removeLater" }),
                  });
                  toast.success(next ? "Added to Watch Later" : "Removed from queue");
                }}
                aria-label={later ? "Remove from Watch Later" : "Add to Watch Later"}
                title={later ? "Remove from Watch Later" : "Add to Watch Later"}
              >
                {later ? <Check className="h-4 w-4 mr-1.5" /> : <Bookmark className="h-4 w-4 mr-1.5" />}
                {later ? "Saved" : "Watch Later"}
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full h-9 px-4 bg-muted hover:bg-accent hidden sm:inline-flex"
                onClick={() => setSaveOpen(true)}
                aria-label="Save to playlist"
                title="Save to playlist"
              >
                <ListPlus className="h-4 w-4 mr-1.5" />
                Save
              </Button>
              <Button
                variant="secondary"
                size="sm"
                className="rounded-full h-9 px-4 bg-muted hover:bg-accent hidden sm:inline-flex"
                onClick={() => setPartyOpen(true)}
                aria-label="Watch with friends"
                title="Watch with friends in sync"
              >
                <Users className="h-4 w-4 mr-1.5" />
                Watch Party
              </Button>
              <SaveToPlaylist open={saveOpen} onClose={() => setSaveOpen(false)} videoId={video.id} />
              <WatchParty open={partyOpen} onClose={() => setPartyOpen(false)} videoId={video.id} videoTitle={video.title} />
              <Button variant="secondary" size="sm" className="rounded-full h-9 px-4 bg-muted hover:bg-accent hidden sm:inline-flex">
                <Download className="h-4 w-4 mr-1.5" /> Download
              </Button>
              <Button variant="secondary" size="icon" className="rounded-full h-9 w-9 bg-muted hover:bg-accent hidden md:inline-flex" aria-label="More">
                <MoreHorizontal className="h-4 w-4" />
              </Button>
            </div>
          </div>

          {/* Description box */}
          <div className="mt-4 px-4 sm:px-0">
            <div className="bg-muted/60 rounded-xl p-3 sm:p-4 text-sm">
              <div className="flex items-center gap-3 font-medium">
                <span className="tabular-nums">{formatViews(video.views)}</span>
                <span className="text-muted-foreground">{timeAgo(video.createdAt)}</span>
                <span className="ml-auto text-xs text-muted-foreground uppercase tracking-wide hidden sm:inline">
                  #{video.category}
                </span>
              </div>
              <div
                className={cn(
                  "mt-2 whitespace-pre-line text-sm leading-relaxed",
                  !showFullDesc && "line-clamp-3"
                )}
              >
                {video.description}
                {video.tags && (
                  <span className="block mt-2 text-teal text-xs">
                    {video.tags
                      .split("|")
                      .filter(Boolean)
                      .map((t) => `#${t.replace(/\s+/g, "")}`)
                      .join(" ")}
                  </span>
                )}
              </div>
              {video.description.length > 160 && (
                <button
                  onClick={() => setShowFullDesc((s) => !s)}
                  className="mt-1 text-xs font-medium text-muted-foreground hover:text-foreground"
                >
                  {showFullDesc ? "Show less" : "...more"}
                </button>
              )}
            </div>
          </div>

          {/* AI features — Mashahd (adapted from CIRKLE overlays).
              Triggered via ⌘K command palette or the gold ⭐ chip row below. */}
          <div className="mt-4 px-4 sm:px-0 flex items-center gap-2 flex-wrap">
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("mashahd:ai-summarize"))}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-gold/30 bg-[hsl(var(--gold)/0.08)] text-foreground hover:bg-[hsl(var(--gold)/0.14)] transition-colors"
            >
              <Sparkles className="h-3.5 w-3.5 text-[hsl(var(--gold))]" />
              AI Recap
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("mashahd:ai-chapters"))}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-border bg-muted/60 hover:bg-accent transition-colors"
            >
              <ListVideo className="h-3.5 w-3.5" />
              Smart Chapters
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("mashahd:ai-watch", { detail: { tab: "starters" } }))}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-border bg-muted/60 hover:bg-accent transition-colors"
            >
              <MessageSquarePlus className="h-3.5 w-3.5" />
              AI Starters
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("mashahd:ai-watch", { detail: { tab: "oracle" } }))}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-border bg-muted/60 hover:bg-accent transition-colors"
            >
              <Compass className="h-3.5 w-3.5" />
              Oracle
            </button>
            <button
              onClick={() => window.dispatchEvent(new CustomEvent("mashahd:ai-watch", { detail: { tab: "tone" } }))}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-border bg-muted/60 hover:bg-accent transition-colors"
            >
              <Wand2 className="h-3.5 w-3.5" />
              Tone
            </button>
            <button
              onClick={() => setShowTranscript((s) => !s)}
              className={cn(
                "inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border transition-colors",
                showTranscript
                  ? "border-gold/40 bg-[hsl(var(--gold)/0.12)] text-foreground"
                  : "border-border bg-muted/60 hover:bg-accent"
              )}
              aria-pressed={showTranscript}
            >
              <FileText className="h-3.5 w-3.5" />
              Transcript
            </button>
            <button
              onClick={() => setClipOpen(true)}
              className="inline-flex items-center gap-1.5 text-xs font-medium px-3 py-1.5 rounded-full border border-border bg-muted/60 hover:bg-accent transition-colors"
            >
              <Scissors className="h-3.5 w-3.5 text-rose" />
              Clip
            </button>
            <span className="ml-auto">
              <CirclePulse videoId={video.id} baseViews={video.views} />
            </span>
          </div>

          <AiRecap videoId={videoId} />
          <SmartChapters videoId={videoId} durationSec={video.durationSec} videoRef={videoRef} />
          <AiWatchPanel videoId={videoId} onUseStarter={(text) => setStarterText(text)} />

          {/* Transcript — searchable, click-to-seek captions (accessibility + searchability). */}
          {showTranscript && (
            <div className="mt-4 px-4 sm:px-0">
              <TranscriptPanel
                videoId={videoId}
                currentTime={liveCurrentTime}
                onSeek={(t) => {
                  const v = videoRef.current;
                  if (v) v.currentTime = t;
                }}
                onClose={() => setShowTranscript(false)}
              />
            </div>
          )}

          {/* Clip dialog — create a short shareable clip from the current video. */}
          <ClipDialog
            open={clipOpen}
            onClose={() => setClipOpen(false)}
            videoId={videoId}
            currentTime={liveCurrentTime}
            duration={video.durationSec}
            onSeek={(t) => {
              const v = videoRef.current;
              if (v) v.currentTime = t;
            }}
          />

          {/* Comments */}
          <CommentsSection
            videoId={videoId}
            comments={comments}
            refetch={refetchComments}
            bid={bid}
            starterText={starterText}
            onStarterUsed={() => setStarterText("")}
            videoRef={videoRef}
          />

          {/* "Continue watching" — horizontal carousel (replaces the
              YouTube-style vertical sidebar). Mashahd's own layout: the
              related videos appear below the comments as a swipeable row. */}
          {!theater && (
            <section className="mt-8 px-4 sm:px-0">
              <h2 className="text-base font-semibold mb-3 font-display">Continue watching</h2>
              <div className="flex gap-4 overflow-x-auto pb-2 custom-scroll-x">
                {!related
                  ? Array.from({ length: 5 }).map((_, i) => (
                      <div key={i} className="shrink-0 w-64">
                        <Skeleton className="aspect-video w-full rounded-xl" />
                        <Skeleton className="h-4 w-3/4 mt-2" />
                        <Skeleton className="h-3 w-1/2 mt-1" />
                      </div>
                    ))
                  : related.map((v) => (
                      <div key={v.id} className="shrink-0 w-56 sm:w-64">
                        <VideoCard video={v} />
                      </div>
                    ))}
              </div>
            </section>
          )}
        </div>
      </div>

      {/* Floating "Ask Mashahd AI" button — the signature AI affordance.
          Appears on every watch page so AI is always one tap away. */}
      <button
        onClick={() =>
          window.dispatchEvent(
            new CustomEvent("mashahd:ai-watch", { detail: { tab: "oracle" } })
          )
        }
        className="fixed bottom-24 right-4 z-30 grid place-items-center h-14 w-14 rounded-full bg-gradient-gold text-charcoal shadow-float hover:scale-110 transition-transform"
        aria-label="Ask Mashahd AI"
        title="Ask Mashahd AI anything about this video"
      >
        <Sparkles className="h-6 w-6" />
        <span className="absolute -top-1 -right-1 h-3 w-3 rounded-full bg-rose animate-pulse" />
      </button>
    </div>
  );
}

/** Auto-advance helper — jump to the first related video. */
function playNext(
  related: Video[] | undefined,
  navigate: (v: { kind: "watch"; videoId: string }) => void
) {
  if (related && related.length > 0) {
    navigate({ kind: "watch", videoId: related[0].id });
  }
}

function CommentsSection({
  videoId,
  comments,
  refetch,
  bid,
  starterText,
  onStarterUsed,
  videoRef,
}: {
  videoId: string;
  comments?: Comment[];
  refetch: () => void;
  bid: string;
  starterText?: string;
  onStarterUsed?: () => void;
  videoRef: React.RefObject<HTMLVideoElement | null>;
}) {
  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  const [sortNew, setSortNew] = useState(true);
  const [translateLang, setTranslateLang] = useState<string | null>(null);
  const [translations, setTranslations] = useState<Record<string, string>>({});
  const [translating, setTranslating] = useState(false);
  // Reply state: which commentId is the reply box open for, and its draft text.
  const [replyTo, setReplyTo] = useState<string | null>(null);
  const [replyText, setReplyText] = useState("");
  // Pin-to-timestamp state: when set, the next posted comment will be pinned
  // to this video moment.
  const [pinTimestamp, setPinTimestamp] = useState<number | null>(null);

  // When an AI starter is loaded into the box, populate the input.
  useEffect(() => {
    if (starterText) {
      setText(starterText);
      onStarterUsed?.();
      // focus the input so the user can edit + post
      const el = document.querySelector<HTMLInputElement>(
        'input[placeholder="Add a comment..."]'
      );
      el?.focus();
    }
  }, [starterText, onStarterUsed]);

  const sorted = [...(comments || [])].sort((a, b) =>
    sortNew
      ? b.createdAt.localeCompare(a.createdAt)
      : b.likes - a.likes
  );

  const submit = async () => {
    if (!text.trim() || !bid) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "You",
          text: text.trim(),
          timestamp: pinTimestamp,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setText("");
      setPinTimestamp(null);
      refetch();
      toast.success("Comment posted");
    } catch {
      toast.error("Could not post comment");
    } finally {
      setPosting(false);
    }
  };

  const submitReply = async (parentId: string) => {
    if (!replyText.trim() || !bid) return;
    setPosting(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/comments`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          author: "You",
          text: replyText.trim(),
          parentId,
        }),
      });
      if (!res.ok) throw new Error("failed");
      setReplyText("");
      setReplyTo(null);
      refetch();
      toast.success("Reply posted");
    } catch {
      toast.error("Could not post reply");
    } finally {
      setPosting(false);
    }
  };

  const fmtTs = (s: number) => {
    const m = Math.floor(s / 60);
    const sec = Math.floor(s % 60);
    return `${m}:${String(sec).padStart(2, "0")}`;
  };

  return (
    <section className="mt-6 px-4 sm:px-0">
      <div className="flex items-center gap-3 sm:gap-6 mb-4 flex-wrap">
        <h2 className="text-base font-semibold">
          {comments?.length ?? 0} Comments
        </h2>
        <button
          className="text-sm text-muted-foreground hover:text-foreground"
          onClick={() => setSortNew((s) => !s)}
        >
          Sort by: {sortNew ? "Newest first" : "Top comments"}
        </button>
        {/* Live Translate — Mashahd (adapted from CIRKLE live-translate overlay) */}
        <div className="flex items-center gap-1.5 ml-auto">
          <Languages
            className={cn("h-3.5 w-3.5", translateLang && "text-[hsl(var(--gold))]")}
          />
          <select
            value={translateLang || ""}
            onChange={async (e) => {
              const lang = e.target.value || null;
              setTranslateLang(lang);
              setTranslations({});
              if (lang && comments && comments.length > 0) {
                setTranslating(true);
                try {
                  const res = await fetch("/api/ai/translate", {
                    method: "POST",
                    headers: { "Content-Type": "application/json" },
                    body: JSON.stringify({
                      texts: comments.map((c) => c.text),
                      target: lang,
                    }),
                  });
                  const data = await res.json();
                  const map: Record<string, string> = {};
                  (data.translations || []).forEach((t: string, i: number) => {
                    if (comments[i]) map[comments[i].id] = t;
                  });
                  setTranslations(map);
                  if (data.source === "fallback") toast.info("AI offline — showing original text");
                  else toast.success(`Translated to ${lang.toUpperCase()}`);
                } catch {
                  toast.error("Translation failed");
                } finally {
                  setTranslating(false);
                }
              }
            }}
            className="text-xs bg-transparent border border-border rounded-full px-2 py-1 focus:outline-none focus:border-foreground cursor-pointer"
            aria-label="Translate comments"
          >
            <option value="">Original</option>
            <option value="en">English</option>
            <option value="ar">العربية</option>
            <option value="fr">Français</option>
            <option value="es">Español</option>
            <option value="zh">中文</option>
          </select>
          {translating && <Loader2 className="h-3.5 w-3.5 animate-spin text-muted-foreground" />}
        </div>
      </div>

      {/* New comment */}
      <div className="flex gap-3 mb-6">
        <UserAvatar className="h-9 w-9 rounded-full shrink-0" />
        <div className="flex-1">
          <input
            value={text}
            onChange={(e) => setText(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && !e.shiftKey) {
                e.preventDefault();
                submit();
              }
            }}
            placeholder="Add a comment..."
            className="w-full bg-transparent border-b border-border pb-1 text-sm focus:outline-none focus:border-foreground transition-colors"
          />
          {/* Pin-to-timestamp toggle: when active, the next posted comment
              will be pinned to the current video moment (clickable to seek). */}
          <div className="flex items-center gap-2 mt-1">
            <button
              onClick={() => setPinTimestamp((t) => (t === null ? 0 : null))}
              className={cn(
                "text-xs px-2 py-0.5 rounded-full border transition-colors",
                pinTimestamp !== null
                  ? "border-gold/40 bg-[hsl(var(--gold)/0.12)] text-foreground"
                  : "border-border text-muted-foreground hover:text-foreground"
              )}
              title="Pin this comment to a video moment"
            >
              {pinTimestamp !== null ? `📌 Pinned to ${fmtTs(pinTimestamp)}` : "📌 Pin to moment"}
            </button>
            {pinTimestamp !== null && (
              <button
                onClick={() => setPinTimestamp(null)}
                className="text-xs text-muted-foreground hover:text-foreground"
              >
                ✕
              </button>
            )}
          </div>
          {text.trim() && (
            <div className="flex justify-end gap-2 mt-2">
              <Button
                variant="ghost"
                size="sm"
                className="rounded-full"
                onClick={() => setText("")}
              >
                Cancel
              </Button>
              <Button
                size="sm"
                className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                onClick={submit}
                disabled={posting}
              >
                Comment
              </Button>
            </div>
          )}
        </div>
      </div>

      {/* List */}
      <div className="space-y-5">
        {sorted.map((c) => (
          <div key={c.id} className="flex gap-3">
            <Avatar className="h-9 w-9 rounded-full shrink-0">
              <AvatarImage src={c.avatarUrl} alt="" />
              <AvatarFallback>{c.author.slice(0, 1)}</AvatarFallback>
            </Avatar>
            <div className="min-w-0 flex-1">
              <div className="flex items-center gap-2 flex-wrap">
                <span className="text-sm font-medium">
                  {c.author === "You" ? (
                    <span className="flex items-center gap-1">
                      {c.author}
                      <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                        You
                      </span>
                    </span>
                  ) : (
                    c.author
                  )}
                </span>
                {/* Timestamp chip — clickable to seek the player. */}
                {typeof c.timestamp === "number" && c.timestamp !== null && (
                  <button
                    onClick={() => {
                      const v = videoRef.current;
                      if (v) v.currentTime = c.timestamp as number;
                    }}
                    className="text-xs font-mono tabular-nums px-1.5 py-0.5 rounded-full bg-[hsl(var(--gold)/0.12)] border border-gold/30 text-[hsl(var(--gold))] hover:bg-[hsl(var(--gold)/0.2)] transition-colors"
                    title="Jump to this moment"
                  >
                    {fmtTs(c.timestamp)}
                  </button>
                )}
                <span className="text-xs text-muted-foreground">
                  {timeAgo(c.createdAt)}
                </span>
              </div>
              <p className="text-sm mt-0.5 whitespace-pre-line break-words">
                {translations[c.id] ?? c.text}
              </p>
              {translations[c.id] && translateLang && (
                <p className="text-xs text-muted-foreground mt-1 italic line-through/0">
                  <span className="opacity-70">original: </span>
                  {c.text}
                </p>
              )}
              <div className="flex items-center gap-1 mt-1.5 text-muted-foreground">
                <button className="p-1.5 hover:text-foreground rounded-full hover:bg-accent" aria-label="Like comment">
                  <ThumbsUp className="h-3.5 w-3.5" />
                </button>
                {c.likes > 0 && (
                  <span className="text-xs tabular-nums">{formatCount(c.likes)}</span>
                )}
                <button className="p-1.5 hover:text-foreground rounded-full hover:bg-accent ml-1" aria-label="Dislike comment">
                  <ThumbsDown className="h-3.5 w-3.5" />
                </button>
                <button
                  onClick={() => {
                    setReplyTo(replyTo === c.id ? null : c.id);
                    setReplyText("");
                  }}
                  className="ml-2 text-xs font-medium hover:text-foreground px-2 py-1"
                >
                  Reply
                </button>
              </div>

              {/* Reply box (inline) */}
              {replyTo === c.id && (
                <div className="mt-2 pl-2 border-l-2 border-border">
                  <input
                    type="text"
                    value={replyText}
                    onChange={(e) => setReplyText(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey) {
                        e.preventDefault();
                        submitReply(c.id);
                      }
                    }}
                    placeholder={`Reply to ${c.author}...`}
                    autoFocus
                    className="w-full bg-transparent border-b border-border pb-1 text-sm focus:outline-none focus:border-foreground transition-colors"
                  />
                  <div className="flex justify-end gap-2 mt-2">
                    <Button
                      variant="ghost"
                      size="sm"
                      className="rounded-full"
                      onClick={() => { setReplyTo(null); setReplyText(""); }}
                    >
                      Cancel
                    </Button>
                    <Button
                      size="sm"
                      className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => submitReply(c.id)}
                      disabled={posting || !replyText.trim()}
                    >
                      Reply
                    </Button>
                  </div>
                </div>
              )}

              {/* Threaded replies */}
              {c.replies && c.replies.length > 0 && (
                <div className="mt-3 pl-4 border-l-2 border-border space-y-3">
                  {c.replies.map((r) => (
                    <div key={r.id} className="flex gap-2">
                      <Avatar className="h-7 w-7 rounded-full shrink-0">
                        <AvatarImage src={r.avatarUrl} alt="" />
                        <AvatarFallback className="text-xs">{r.author.slice(0, 1)}</AvatarFallback>
                      </Avatar>
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-xs font-medium">
                            {r.author === "You" ? (
                              <span className="flex items-center gap-1">
                                {r.author}
                                <span className="text-[10px] bg-muted text-muted-foreground px-1.5 py-0.5 rounded">
                                  You
                                </span>
                              </span>
                            ) : (
                              r.author
                            )}
                          </span>
                          <span className="text-xs text-muted-foreground">{timeAgo(r.createdAt)}</span>
                        </div>
                        <p className="text-sm mt-0.5 whitespace-pre-line break-words">{r.text}</p>
                      </div>
                    </div>
                  ))}
                </div>
              )}
            </div>
          </div>
        ))}
      </div>
    </section>
  );
}

function WatchSkeleton() {
  return (
    <div className="px-0 sm:px-6 py-0 sm:py-4">
      <div className="flex flex-col xl:flex-row gap-6 max-w-[1800px] mx-auto">
        <div className="flex-1">
          <Skeleton className="w-full aspect-video bg-muted" />
          <Skeleton className="h-6 w-3/4 mt-3" />
          <div className="flex items-center gap-3 mt-3">
            <Skeleton className="h-10 w-10 rounded-full" />
            <div className="space-y-2">
              <Skeleton className="h-4 w-32" />
              <Skeleton className="h-3 w-20" />
            </div>
          </div>
          <Skeleton className="h-24 w-full mt-4 rounded-xl" />
        </div>
        <div className="xl:w-[400px] space-y-3">
          {Array.from({ length: 6 }).map((_, i) => (
            <div key={i} className="flex gap-2">
              <Skeleton className="w-40 h-[90px] rounded-lg" />
              <div className="flex-1 space-y-2">
                <Skeleton className="h-4 w-full" />
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
