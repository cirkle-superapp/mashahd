"use client";

import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Share2, MoreHorizontal } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger, TabsContent } from "@/components/ui/tabs";
import { useBrowserId } from "@/hooks/use-browser-id";
import { formatSubs } from "@/lib/format";
import type { ChannelWithFlags, Video } from "@/lib/types";
import { VideoCard } from "./video-card";
import { useAppStore } from "@/store/app-store";
import { toast } from "sonner";
import { cn } from "@/lib/utils";

async function fetchChannel(id: string, bid: string) {
  const sp = new URLSearchParams();
  if (bid) sp.set("bid", bid);
  const res = await fetch(`/api/channels/${id}?${sp.toString()}`);
  if (!res.ok) throw new Error("failed");
  const data = await res.json();
  return data as { channel: ChannelWithFlags; subscribed: boolean };
}

async function fetchChannelVideos(id: string) {
  const res = await fetch(`/api/videos?channelId=${id}&sort=recent`);
  if (!res.ok) throw new Error("failed");
  const data = await res.json();
  return data.videos as Video[];
}

export function ChannelView({ channelId }: { channelId: string }) {
  const bid = useBrowserId();
  const qc = useQueryClient();
  const { navigate } = useAppStore();

  const { data, isLoading, isError } = useQuery({
    queryKey: ["channel", channelId, bid],
    queryFn: () => fetchChannel(channelId, bid),
    enabled: !!bid,
  });

  const { data: videos } = useQuery({
    queryKey: ["channel-videos", channelId],
    queryFn: () => fetchChannelVideos(channelId),
  });

  const channel = data?.channel;

  const subMutation = useMutation({
    mutationFn: async (action: "subscribe" | "unsubscribe") => {
      const res = await fetch(`/api/channels/${channelId}/subscribe`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, action }),
      });
      if (!res.ok) throw new Error("failed");
      return res.json();
    },
    onSuccess: (_d, action) => {
      qc.setQueryData(["channel", channelId, bid], (old: any) => {
        if (!old) return old;
        const delta = action === "subscribe" ? 1 : -1;
        return {
          ...old,
          channel: {
            ...old.channel,
            subscribers: old.channel.subscribers + delta,
          },
          subscribed: action === "subscribe",
        };
      });
      toast.success(
        action === "subscribe"
          ? `Subscribed to ${channel?.name}`
          : `Unsubscribed from ${channel?.name}`
      );
    },
  });

  if (isLoading) return <ChannelSkeleton />;
  if (isError || !channel) {
    return (
      <div className="px-6 py-24 text-center">
        <p className="text-lg font-medium text-muted-foreground">
          Channel not found
        </p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate({ kind: "home" })}>
          Back to home
        </Button>
      </div>
    );
  }

  const subscribed = data?.subscribed;
  const colors = channel.bannerColors.split(",");
  const gradient = `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1] || colors[0]} 50%, ${colors[2] || colors[1] || colors[0]} 100%)`;

  const popular = [...(videos || [])].sort((a, b) => b.views - a.views);

  return (
    <div className="pb-12">
      {/* Banner */}
      <div
        className="h-32 sm:h-48 lg:h-56 w-full"
        style={{ background: gradient }}
      />

      {/* Header */}
      <div className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row gap-4 sm:items-center max-w-[1500px] mx-auto">
        <Avatar className="h-24 w-24 sm:h-32 sm:w-32 rounded-full border-4 border-background -mt-12 sm:-mt-16 shrink-0">
          <AvatarImage src={channel.avatarUrl} alt="" />
          <AvatarFallback className="text-2xl">
            {channel.name.slice(0, 1)}
          </AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <h1 className="text-2xl sm:text-3xl font-bold">{channel.name}</h1>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">@{channel.handle}</span>
            <span>•</span>
            <span>{formatSubs(channel.subscribers)}</span>
            <span>•</span>
            <span>{videos?.length || 0} videos</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2 max-w-2xl">
            {channel.description}
          </p>
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <Button
              variant={subscribed ? "secondary" : "default"}
              size="sm"
              className={cn(
                "rounded-full h-9 px-5 font-medium",
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
            <Button variant="secondary" size="sm" className="rounded-full h-9 px-4 bg-muted hover:bg-accent">
              <Share2 className="h-4 w-4 mr-1.5" /> Share
            </Button>
            <Button variant="secondary" size="icon" className="rounded-full h-9 w-9 bg-muted hover:bg-accent" aria-label="More">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Tabs */}
      <div className="px-4 sm:px-6 mt-4">
        <Tabs defaultValue="home">
          <TabsList className="bg-transparent h-10 border-b border-border rounded-none w-full sm:w-auto justify-start overflow-x-auto">
            <TabsTrigger value="home" className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Home
            </TabsTrigger>
            <TabsTrigger value="videos" className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Videos
            </TabsTrigger>
            <TabsTrigger value="popular" className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              Popular
            </TabsTrigger>
            <TabsTrigger value="about" className="rounded-none border-b-2 border-transparent data-[state=active]:border-foreground data-[state=active]:bg-transparent data-[state=active]:shadow-none">
              About
            </TabsTrigger>
          </TabsList>

          <TabsContent value="home" className="mt-6">
            {popular[0] && (
              <div className="mb-6">
                <h2 className="text-base font-semibold mb-3">Latest video</h2>
                <div className="max-w-2xl">
                  <VideoCard video={popular[0]} />
                </div>
              </div>
            )}
            <h2 className="text-base font-semibold mb-3">Recent uploads</h2>
            <VideoGrid videos={videos || []} />
          </TabsContent>

          <TabsContent value="videos" className="mt-6">
            <VideoGrid videos={videos || []} />
          </TabsContent>

          <TabsContent value="popular" className="mt-6">
            <VideoGrid videos={popular} />
          </TabsContent>

          <TabsContent value="about" className="mt-6">
            <AboutPanel channel={channel} videoCount={videos?.length || 0} totalViews={totalViews(videos || [])} />
          </TabsContent>
        </Tabs>
      </div>
    </div>
  );
}

function VideoGrid({ videos }: { videos: Video[] }) {
  if (videos.length === 0) {
    return (
      <p className="text-sm text-muted-foreground py-12 text-center">
        No videos yet.
      </p>
    );
  }
  return (
    <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
      {videos.map((v) => (
        <VideoCard key={v.id} video={v} />
      ))}
    </div>
  );
}

function ChannelSkeleton() {
  return (
    <div>
      <Skeleton className="h-48 w-full" />
      <div className="px-6 py-4 flex gap-4 items-start max-w-[1500px] mx-auto">
        <Skeleton className="h-32 w-32 rounded-full -mt-16" />
        <div className="flex-1 space-y-2">
          <Skeleton className="h-7 w-48" />
          <Skeleton className="h-4 w-64" />
          <Skeleton className="h-4 w-96 max-w-full" />
          <div className="flex gap-2 mt-3">
            <Skeleton className="h-9 w-32 rounded-full" />
            <Skeleton className="h-9 w-24 rounded-full" />
          </div>
        </div>
      </div>
      <div className="px-6 mt-4">
        <Skeleton className="h-10 w-96 max-w-full" />
        <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4 mt-6">
          {Array.from({ length: 4 }).map((_, i) => (
            <div key={i}>
              <Skeleton className="aspect-video w-full rounded-xl" />
              <Skeleton className="h-4 w-3/4 mt-2" />
              <Skeleton className="h-3 w-1/2 mt-1" />
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

function totalViews(videos: Video[]): number {
  return videos.reduce((sum, v) => sum + (v.views || 0), 0);
}

function formatBig(n: number): string {
  if (n < 1000) return `${n}`;
  if (n < 1_000_000) return `${(n / 1000).toFixed(1).replace(/\.0$/, "")}K`;
  if (n < 1_000_000_000) return `${(n / 1_000_000).toFixed(1).replace(/\.0$/, "")}M`;
  return `${(n / 1_000_000_000).toFixed(1).replace(/\.0$/, "")}B`;
}

function AboutPanel({
  channel,
  videoCount,
  totalViews,
}: {
  channel: ChannelWithFlags;
  videoCount: number;
  totalViews: number;
}) {
  const joined = new Date(channel.createdAt);
  const joinedStr = joined.toLocaleDateString("en-US", {
    year: "numeric",
    month: "long",
    day: "numeric",
  });
  const stats = [
    { label: "Subscribers", value: formatBig(channel.subscribers) },
    { label: "Videos", value: `${videoCount}` },
    { label: "Total views", value: formatBig(totalViews) },
    { label: "Handle", value: `@${channel.handle}` },
  ];
  return (
    <div className="grid grid-cols-1 md:grid-cols-3 gap-6">
      <div className="md:col-span-2 space-y-4">
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Description
          </h3>
          <p className="text-sm leading-relaxed whitespace-pre-line">
            {channel.description}
          </p>
        </div>
        <div>
          <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">
            Channel details
          </h3>
          <dl className="grid grid-cols-2 gap-3">
            {stats.map((s) => (
              <div key={s.label} className="rounded-xl border border-border bg-card p-3">
                <dt className="text-xs text-muted-foreground">{s.label}</dt>
                <dd className="text-sm font-medium mt-0.5 tabular-nums">{s.value}</dd>
              </div>
            ))}
          </dl>
        </div>
      </div>
      <aside className="space-y-3">
        <div className="rounded-xl border border-gold/20 bg-gradient-to-br from-[hsl(var(--gold)/0.08)] to-transparent p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Joined
          </h3>
          <p className="text-sm font-medium">{joinedStr}</p>
        </div>
        <div className="rounded-xl border border-border bg-card p-4">
          <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-1.5">
            Reach
          </h3>
          <p className="text-sm">
            <span className="font-medium tabular-nums">{formatBig(totalViews)}</span>{" "}
            <span className="text-muted-foreground">total views across {videoCount} video{videoCount === 1 ? "" : "s"}.</span>
          </p>
        </div>
      </aside>
    </div>
  );
}
