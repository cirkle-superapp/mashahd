"use client";

import { useQuery } from "@tanstack/react-query";
import { Tv, ArrowLeft, Users, Radio, Check } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Skeleton } from "@/components/ui/skeleton";
import { MashahdPlayerLazy as MashahdPlayer } from "./mashahd-player-lazy";
import { useAppStore } from "@/store/app-store";
import { useState } from "react";
import { cn } from "@/lib/utils";

/**
 * LiveTVChannelView — the premium watch view for a live TV channel.
 *
 * Renders the live HLS stream in the Mashahd player + shows:
 *   - Channel name + logo
 *   - LIVE badge with pulse
 *   - Now playing + next program (EPG)
 *   - Viewer count
 *   - Category + country + language badges
 *   - Channel description
 *
 * The player uses the same hls.js + P2P acceleration engine as regular
 * videos, so live TV gets the same premium playback experience.
 */

interface LiveTVChannel {
  id: string; name: string; slug: string; logoUrl: string;
  description: string; category: string; country: string; language: string;
  streamUrl: string; streamType: string; isLive: boolean; isVerified: boolean;
  nowPlaying: string; nextProgram: string; viewers: number;
}

async function fetchChannel(id: string): Promise<{ channel: LiveTVChannel } | null> {
  const res = await fetch(`/api/live-tv-channels/${id}`);
  if (!res.ok) return null;
  return res.json();
}

export function LiveTVChannelView({ channelId }: { channelId: string }) {
  const { navigate } = useAppStore();
  const [subscribed, setSubscribed] = useState(false);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["live-tv-channel", channelId],
    queryFn: () => fetchChannel(channelId),
    refetchInterval: 15_000,
    enabled: !!channelId,
  });

  if (isLoading) {
    return (
      <div className="px-4 sm:px-6 py-4 max-w-5xl mx-auto">
        <Skeleton className="aspect-video w-full rounded-xl" />
        <div className="flex gap-3 mt-3">
          <Skeleton className="h-12 w-12 rounded-full" />
          <div className="flex-1">
            <Skeleton className="h-5 w-1/2" />
            <Skeleton className="h-3 w-1/3 mt-2" />
          </div>
        </div>
      </div>
    );
  }

  if (isError || !data?.channel) {
    return (
      <div className="px-6 py-24 text-center">
        <Tv className="h-12 w-12 mx-auto text-muted-foreground mb-4" />
        <p className="text-lg font-medium text-muted-foreground">Channel not found</p>
        <Button variant="ghost" className="mt-4" onClick={() => navigate({ kind: "home" })}>
          <ArrowLeft className="h-4 w-4 mr-2" /> Back to home
        </Button>
      </div>
    );
  }

  const ch = data.channel;

  return (
    <div className="px-4 sm:px-6 py-4 max-w-5xl mx-auto pb-24">
      {/* Back link */}
      <button
        onClick={() => navigate({ kind: "home" })}
        className="flex items-center gap-1.5 text-xs text-muted-foreground hover:text-foreground transition-colors mb-3 min-h-[44px] py-1"
      >
        <ArrowLeft className="h-3.5 w-3.5" />
        Back to home
      </button>

      {/* Player */}
      <div className="relative aspect-video w-full overflow-hidden rounded-xl bg-black shadow-float">
        {ch.isLive ? (
          <MashahdPlayer
            src={ch.streamUrl}
            poster={ch.logoUrl}
            videoId={`live-tv-${ch.id}`}
            autoPlay={true}
          >
            {/* LIVE badge overlay */}
            <div className="absolute top-3 left-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-red-600 text-white text-xs font-bold z-20">
              <span className="h-2 w-2 rounded-full bg-white animate-pulse" />
              LIVE TV
            </div>
            {/* Viewer count overlay */}
            <div className="absolute top-3 right-3 flex items-center gap-1.5 px-2.5 py-1 rounded-full bg-black/70 text-white text-xs font-medium backdrop-blur z-20">
              <Users className="h-3.5 w-3.5" />
              {ch.viewers.toLocaleString()} watching
            </div>
          </MashahdPlayer>
        ) : (
          <div className="absolute inset-0 flex flex-col items-center justify-center gap-3">
            <Radio className="h-10 w-10 text-muted-foreground" />
            <p className="text-sm text-muted-foreground">This channel is currently off-air</p>
            <p className="text-xs text-muted-foreground">Check back later for the next broadcast.</p>
          </div>
        )}
      </div>

      {/* Channel info */}
      <div className="flex gap-3 mt-4">
        {/* Channel logo */}
        {ch.logoUrl ? (
          <img src={ch.logoUrl} alt={ch.name} className="h-14 w-14 rounded-xl object-cover shrink-0 shadow-soft" />
        ) : (
          <div className="h-14 w-14 rounded-xl bg-gradient-gold grid place-items-center shrink-0">
            <span className="text-xl font-bold text-charcoal">{ch.name.slice(0, 2)}</span>
          </div>
        )}

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-2">
            <h1 className="text-lg font-semibold line-clamp-1">{ch.name}</h1>
            {ch.isVerified && (
              <span className="grid place-items-center h-5 w-5 rounded-full bg-[hsl(var(--gold))]">
                <Check className="h-3 w-3 text-charcoal" />
              </span>
            )}
          </div>

          {/* Badges */}
          <div className="flex items-center gap-2 mt-1 flex-wrap">
            <span className="text-xs text-muted-foreground">{ch.category}</span>
            {ch.country && <span className="text-xs text-muted-foreground">· {ch.country}</span>}
            {ch.language && <span className="text-xs text-muted-foreground">· {ch.language}</span>}
          </div>

          {/* EPG — now playing + next */}
          {ch.nowPlaying && (
            <div className="mt-2 flex items-center gap-2 text-xs">
              <span className="text-[hsl(var(--gold))] font-medium">Now:</span>
              <span className="text-foreground line-clamp-1">{ch.nowPlaying}</span>
            </div>
          )}
          {ch.nextProgram && (
            <div className="flex items-center gap-2 text-xs mt-0.5">
              <span className="text-muted-foreground font-medium">Next:</span>
              <span className="text-muted-foreground line-clamp-1">{ch.nextProgram}</span>
            </div>
          )}
        </div>

        {/* Subscribe button */}
        <Button
          variant={subscribed ? "default" : "outline"}
          size="sm"
          className={cn(
            "rounded-full h-9 px-4 shrink-0",
            subscribed && "bg-gradient-gold text-charcoal"
          )}
          onClick={() => setSubscribed(!subscribed)}
        >
          {subscribed ? <Check className="h-4 w-4 mr-1" /> : <Radio className="h-4 w-4 mr-1" />}
          {subscribed ? "Following" : "Follow"}
        </Button>
      </div>

      {/* Description */}
      {ch.description && (
        <p className="mt-3 text-sm text-muted-foreground max-w-2xl leading-relaxed">
          {ch.description}
        </p>
      )}

      {/* Stats row */}
      <div className="flex items-center gap-4 mt-4 text-xs text-muted-foreground flex-wrap">
        <span className="flex items-center gap-1.5">
          <Users className="h-3.5 w-3.5" />
          {ch.viewers.toLocaleString()} watching
        </span>
        <span className="flex items-center gap-1.5">
          <Tv className="h-3.5 w-3.5 text-[hsl(var(--gold))]" />
          Live TV Channel
        </span>
        {ch.isLive && (
          <span className="flex items-center gap-1.5 text-emerald-500">
            <span className="h-1.5 w-1.5 rounded-full bg-emerald-500 animate-pulse" />
            On-air
          </span>
        )}
      </div>
    </div>
  );
}
