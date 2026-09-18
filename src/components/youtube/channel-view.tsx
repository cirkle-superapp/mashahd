"use client";

import { useState } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { Bell, Share2, MoreHorizontal, Heart, Sparkles, BarChart3, Download, Wallet, Pencil, Loader2 } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import {
  Dialog,
  DialogContent,
  DialogTitle,
  DialogDescription,
  DialogFooter,
} from "@/components/ui/dialog";
import { useBrowserId } from "@/hooks/use-browser-id";
import { formatSubs, formatViews, formatCount } from "@/lib/format";
import type { ChannelWithFlags, Video } from "@/lib/types";
import { SupportCreator } from "./support-creator";
import { VideoCard } from "./video-card";
import { VerifiedBadge } from "./verified-badge";
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

// §49 — Creator Studio overview. Returns aggregate stats (total views,
// total likes, engagement rate), recent videos, and top categories for
// the channel owner. Fetched only when the Studio section is opened.
interface StudioRecentVideo {
  id: string;
  title: string;
  views: number;
  likes: number;
  likeRatio: number;
  category?: string;
  createdAt?: string;
}
interface StudioOverview {
  totalViews: number;
  totalLikes: number;
  engagementRate: number;
  avgViewsPerVideo: number;
}
interface StudioResponse {
  channel: { id: string; name: string; subscribers: number; videoCount: number };
  overview: StudioOverview;
  recentVideos: StudioRecentVideo[];
  audience: { topCategories: Array<{ category: string; views: number }> };
}
async function fetchStudio(id: string, bid: string): Promise<StudioResponse | null> {
  const sp = new URLSearchParams();
  if (bid) sp.set("bid", bid);
  const res = await fetch(`/api/channels/${id}/studio?${sp.toString()}`);
  if (!res.ok) return null;
  return (await res.json()) as StudioResponse;
}

// §50 — Distribution diagnostics (last N days). Returns total
// impressions, avg CTR, and a topic-demand list. Per the spec, these
// are heuristic proxies — the API labels them as probabilistic signals.
interface DistributionTopicDemand {
  category: string;
  videoCount: number;
  avgViews: number;
}
interface DistributionResponse {
  summary: { totalImpressions: number; avgCTR: number; totalVideos: number };
  topicDemand: DistributionTopicDemand[];
}
async function fetchDistribution(id: string, days: number): Promise<DistributionResponse | null> {
  const res = await fetch(`/api/channels/${id}/distribution?days=${days}`);
  if (!res.ok) return null;
  return (await res.json()) as DistributionResponse;
}

// §51 — Revenue transparency (gross, deductions, net, model). In the
// zero-cost model all amounts are $0 but the structure is shown for
// transparency (per spec: "Every deduction must be explainable").
interface RevenueResponse {
  channel: { id: string; name: string };
  revenue: {
    summary: {
      gross: number;
      totalDeductions: number;
      netEarnings: number;
      currency: string;
      model: string;
    };
  };
}
async function fetchRevenue(id: string, bid: string): Promise<RevenueResponse | null> {
  const sp = new URLSearchParams();
  if (bid) sp.set("bid", bid);
  const res = await fetch(`/api/channels/${id}/revenue?${sp.toString()}`);
  if (!res.ok) return null;
  return (await res.json()) as RevenueResponse;
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

  // §49-52 — Creator Studio panel state. When open, three queries fire
  // (studio / distribution / revenue). Gated on `studioOpen` so we don't
  // fetch studio data until the creator opens the panel.
  const [supportOpen, setSupportOpen] = useState(false);
  const [studioOpen, setStudioOpen] = useState(false);
  // §PATCH /api/channels/[id] — Edit-channel dialog state. When open, the
  // dialog lets the creator edit name/description/links/country. Save fires
  // a PATCH with optimistic update.
  const [editOpen, setEditOpen] = useState(false);

  const { data: studioData, isLoading: studioLoading } = useQuery({
    queryKey: ["channel-studio", channelId, bid],
    queryFn: () => fetchStudio(channelId, bid),
    enabled: !!bid && studioOpen,
    staleTime: 60_000,
  });
  const { data: distributionData } = useQuery({
    queryKey: ["channel-distribution", channelId, 30],
    queryFn: () => fetchDistribution(channelId, 30),
    enabled: studioOpen,
    staleTime: 60_000,
  });
  const { data: revenueData } = useQuery({
    queryKey: ["channel-revenue", channelId, bid],
    queryFn: () => fetchRevenue(channelId, bid),
    enabled: !!bid && studioOpen,
    staleTime: 60_000,
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
          channel: { ...old.channel, subscribers: old.channel.subscribers + delta },
          subscribed: action === "subscribe",
        };
      });
      toast.success(action === "subscribe" ? `Subscribed to ${channel?.name}` : `Unsubscribed from ${channel?.name}`);
    },
  });

  if (isLoading) return <ChannelSkeleton />;
  if (isError || !channel) {
    return (
      <div className="px-6 py-24 text-center">
        <p className="text-lg font-medium text-muted-foreground">Channel not found</p>
        <Button variant="secondary" className="mt-4" onClick={() => navigate({ kind: "home" })}>Back to home</Button>
      </div>
    );
  }

  const subscribed = data?.subscribed;
  const colors = channel.bannerColors.split(",");
  const gradient = `linear-gradient(135deg, ${colors[0]} 0%, ${colors[1] || colors[0]} 50%, ${colors[2] || colors[1] || colors[0]} 100%)`;
  // Social-media structuring audit: prefer a custom banner image if set,
  // otherwise fall back to the gradient.
  const bannerStyle = channel.bannerUrl
    ? { backgroundImage: `url(${channel.bannerUrl})`, backgroundSize: "cover", backgroundPosition: "center" }
    : { background: gradient };
  const popular = [...(videos || [])].sort((a, b) => b.views - a.views);
  const recent = videos || [];
  const totalViewCount = recent.reduce((sum, v) => sum + (v.views || 0), 0);
  const joined = new Date(channel.createdAt);
  const joinedStr = joined.toLocaleDateString("en-US", { year: "numeric", month: "long", day: "numeric" });

  return (
    <div className="pb-12">
      {/* Banner */}
      <div className="h-32 sm:h-48 lg:h-56 w-full relative" style={bannerStyle}>
        <div className="absolute inset-0 bg-gradient-to-t from-background/40 to-transparent" />
      </div>

      {/* Hero — avatar + name + subscribe + support */}
      <div className="px-4 sm:px-6 py-4 flex flex-col sm:flex-row gap-4 sm:items-center max-w-[1500px] mx-auto">
        <Avatar className="h-24 w-24 sm:h-32 sm:w-32 rounded-full border-4 border-background -mt-12 sm:-mt-16 shrink-0">
          <AvatarImage src={channel.avatarUrl} alt="" />
          <AvatarFallback className="text-2xl">{channel.name.slice(0, 1)}</AvatarFallback>
        </Avatar>
        <div className="flex-1 min-w-0">
          <div className="flex items-center gap-2">
            <h1 className="text-2xl sm:text-3xl font-bold">{channel.name}</h1>
            {channel.verified ? <VerifiedBadge size={20} /> : null}
          </div>
          <div className="mt-1 flex flex-wrap items-center gap-x-2 gap-y-1 text-sm text-muted-foreground">
            <span className="font-medium text-foreground">@{channel.handle}</span>
            <span>•</span>
            <span>{formatSubs(channel.subscribers)}</span>
            <span>•</span>
            <span>{recent.length} videos</span>
            <span>•</span>
            <span>{formatViews(totalViewCount)} total views</span>
          </div>
          <p className="mt-2 text-sm text-muted-foreground line-clamp-2 max-w-2xl">{channel.description}</p>
          <div className="mt-4 flex items-center gap-2 flex-wrap">
            <Button variant={subscribed ? "secondary" : "default"} size="sm"
              className={cn("rounded-full h-9 px-5 font-medium", subscribed ? "bg-secondary text-secondary-foreground hover:bg-secondary/80" : "bg-primary text-primary-foreground hover:bg-primary/90")}
              onClick={() => subMutation.mutate(subscribed ? "unsubscribe" : "subscribe")} disabled={subMutation.isPending}>
              {subscribed ? (<><Bell className="h-4 w-4 mr-1.5" /> Subscribed</>) : ("Subscribe")}
            </Button>
            {/* Creator Support button — Mashahd's creator economy (0% fees) */}
            <Button variant="secondary" size="sm"
              className="rounded-full h-9 px-4 bg-gradient-to-r from-[hsl(var(--gold)/0.15)] to-transparent border border-gold/30 hover:border-gold/50"
              onClick={() => setSupportOpen(true)}>
              <Heart className="h-4 w-4 mr-1.5 text-rose" /> Support
            </Button>
            <SupportCreator
              open={supportOpen}
              onClose={() => setSupportOpen(false)}
              channelName={channel.name}
              channelId={channel.id}
            />
            <Button variant="secondary" size="sm" className="rounded-full h-9 px-4 bg-muted hover:bg-accent">
              <Share2 className="h-4 w-4 mr-1.5" /> Share
            </Button>
            {/* Edit-channel button — opens a Dialog to PATCH name/description/
                links/country. Wired to /api/channels/[id] PATCH. */}
            <Button
              variant="secondary"
              size="sm"
              className="rounded-full h-9 px-4 bg-muted hover:bg-accent"
              onClick={() => setEditOpen(true)}
              aria-label="Edit channel"
              title="Edit channel"
            >
              <Pencil className="h-4 w-4 mr-1.5" /> Edit
            </Button>
            <EditChannelDialog
              open={editOpen}
              onOpenChange={setEditOpen}
              channelId={channelId}
              bid={bid}
              channel={channel}
            />
            {/* §49 — Creator Studio button. Always visible in dev (spec:
                "for now, always show it since we're in dev"). Toggles the
                Creator Studio section at the bottom of the channel view. */}
            <Button
              variant="secondary"
              size="sm"
              className={cn(
                "rounded-full h-9 px-4 border",
                studioOpen
                  ? "bg-gold/15 border-gold/40 text-[hsl(var(--gold))]"
                  : "bg-muted hover:bg-accent border-border"
              )}
              onClick={() => setStudioOpen((s) => !s)}
              aria-pressed={studioOpen}
              aria-label="Open Creator Studio"
              title="Open Creator Studio"
            >
              <BarChart3 className="h-4 w-4 mr-1.5" /> Studio
            </Button>
            <Button variant="secondary" size="icon" className="rounded-full h-9 w-9 bg-muted hover:bg-accent" aria-label="More">
              <MoreHorizontal className="h-4 w-4" />
            </Button>
          </div>
        </div>
      </div>

      {/* Single-scroll story view — no tabs, just continuous sections */}
      <div className="px-4 sm:px-6 mt-6 max-w-[1500px] mx-auto space-y-8">
        {/* Featured video */}
        {popular[0] && (
          <section>
            <div className="flex items-center gap-2 mb-3">
              <Sparkles className="h-4 w-4 text-gold" />
              <h2 className="text-base font-semibold font-display">Featured</h2>
            </div>
            <div className="max-w-2xl"><VideoCard video={popular[0]} /></div>
          </section>
        )}

        {/* Recent uploads — horizontal carousel on mobile, grid on desktop */}
        <section>
          <h2 className="text-base font-semibold mb-3 font-display">Recent uploads</h2>
          <div className="flex gap-4 overflow-x-auto pb-2 md:hidden custom-scroll-x">
            {recent.map((v) => (<div key={v.id} className="shrink-0 w-64"><VideoCard video={v} /></div>))}
          </div>
          <div className="hidden md:grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
            {recent.map((v) => (<VideoCard key={v.id} video={v} />))}
          </div>
        </section>

        {/* Most popular */}
        {popular.length > 1 && (
          <section>
            <h2 className="text-base font-semibold mb-3 font-display">Most popular</h2>
            <div className="flex gap-4 overflow-x-auto pb-2 md:hidden custom-scroll-x">
              {popular.slice(0, 10).map((v) => (<div key={v.id} className="shrink-0 w-64"><VideoCard video={v} /></div>))}
            </div>
            <div className="hidden md:grid grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-x-4 gap-y-6">
              {popular.slice(0, 12).map((v) => (<VideoCard key={v.id} video={v} />))}
            </div>
          </section>
        )}

        {/* About — inline */}
        <section>
          <h2 className="text-base font-semibold mb-3 font-display">About</h2>
          <div className="space-y-4">
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Description</h3>
              <p className="text-sm leading-relaxed whitespace-pre-line">{channel.description}</p>
            </div>
            <div>
              <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wide mb-2">Channel details</h3>
              <dl className="grid grid-cols-2 sm:grid-cols-4 gap-3">
                <div className="rounded-xl border border-border bg-card p-3"><dt className="text-xs text-muted-foreground">Subscribers</dt><dd className="text-sm font-medium mt-0.5 tabular-nums">{formatSubs(channel.subscribers)}</dd></div>
                <div className="rounded-xl border border-border bg-card p-3"><dt className="text-xs text-muted-foreground">Videos</dt><dd className="text-sm font-medium mt-0.5 tabular-nums">{recent.length}</dd></div>
                <div className="rounded-xl border border-border bg-card p-3"><dt className="text-xs text-muted-foreground">Total views</dt><dd className="text-sm font-medium mt-0.5 tabular-nums">{formatViews(totalViewCount)}</dd></div>
                <div className="rounded-xl border border-border bg-card p-3"><dt className="text-xs text-muted-foreground">Joined</dt><dd className="text-sm font-medium mt-0.5">{joinedStr}</dd></div>
              </dl>
            </div>
          </div>
        </section>

        {/* §49-52 — Creator Studio. Collapsible section at the bottom of
            the channel view. The Studio button at the top toggles this
            section. When open, three queries fire in parallel:
            studio (§49), distribution (§50), revenue (§51). The Download
            button (§52) fetches the creator export and triggers a blob
            download — same pattern as the data-export button in Settings. */}
        <section>
          <details
            open={studioOpen}
            onToggle={(e) => setStudioOpen((e.currentTarget as HTMLDetailsElement).open)}
            className="group rounded-2xl border border-border bg-card/50 overflow-hidden"
          >
            <summary className="cursor-pointer list-none flex items-center gap-2 px-4 py-3 hover:bg-accent/50 transition-colors">
              <BarChart3 className="h-4 w-4 text-[hsl(var(--gold))]" />
              <span className="text-base font-semibold font-display">Creator Studio</span>
              <Badge variant="outline" className="ml-1 text-[10px] py-0">dev</Badge>
              <span className="ml-auto text-muted-foreground/70 group-open:rotate-180 transition-transform" aria-hidden>⌄</span>
            </summary>
            <div className="px-4 pb-4 space-y-4">
              {studioLoading ? (
                <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                  {Array.from({ length: 4 }).map((_, i) => (
                    <Skeleton key={i} className="h-20 rounded-xl" />
                  ))}
                </div>
              ) : studioData ? (
                <>
                  {/* §49 — Studio overview cards */}
                  <div className="grid sm:grid-cols-2 lg:grid-cols-4 gap-3">
                    <Card className="gap-2 py-3">
                      <CardHeader className="py-0"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Total views</CardTitle></CardHeader>
                      <CardContent className="py-0"><p className="text-lg font-semibold tabular-nums">{formatViews(studioData.overview.totalViews)}</p></CardContent>
                    </Card>
                    <Card className="gap-2 py-3">
                      <CardHeader className="py-0"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Total likes</CardTitle></CardHeader>
                      <CardContent className="py-0"><p className="text-lg font-semibold tabular-nums">{formatCount(studioData.overview.totalLikes)}</p></CardContent>
                    </Card>
                    <Card className="gap-2 py-3">
                      <CardHeader className="py-0"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Engagement</CardTitle></CardHeader>
                      <CardContent className="py-0"><p className="text-lg font-semibold tabular-nums">{studioData.overview.engagementRate}%</p></CardContent>
                    </Card>
                    <Card className="gap-2 py-3">
                      <CardHeader className="py-0"><CardTitle className="text-xs text-muted-foreground uppercase tracking-wide">Avg views/video</CardTitle></CardHeader>
                      <CardContent className="py-0"><p className="text-lg font-semibold tabular-nums">{formatCount(studioData.overview.avgViewsPerVideo)}</p></CardContent>
                    </Card>
                  </div>

                  {/* §49 — Recent videos table */}
                  <Card className="gap-2 py-3">
                    <CardHeader className="py-0"><CardTitle className="text-sm">Recent videos</CardTitle></CardHeader>
                    <CardContent className="py-0">
                      {studioData.recentVideos.length > 0 ? (
                        <ul className="divide-y divide-border">
                          {studioData.recentVideos.slice(0, 6).map((v) => (
                            <li key={v.id} className="py-1.5 flex items-center gap-2 text-xs">
                              <button
                                onClick={() => navigate({ kind: "watch", videoId: v.id })}
                                className="flex-1 min-w-0 text-left hover:text-[hsl(var(--gold))] truncate"
                                title={v.title}
                              >
                                {v.title}
                              </button>
                              {v.category && <Badge variant="outline" className="text-[10px] py-0 shrink-0">{v.category}</Badge>}
                              <span className="tabular-nums text-muted-foreground shrink-0">{formatCount(v.views)} views</span>
                              <span className="tabular-nums text-muted-foreground shrink-0 w-12 text-right">{v.likeRatio}%</span>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="text-xs text-muted-foreground">No videos yet.</p>
                      )}
                    </CardContent>
                  </Card>

                  {/* §49 — Top categories */}
                  {studioData.audience.topCategories.length > 0 && (
                    <div>
                      <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2">Top categories</h3>
                      <div className="flex flex-wrap gap-2">
                        {studioData.audience.topCategories.map((c) => (
                          <Badge key={c.category} variant="secondary" className="text-xs">
                            {c.category} <span className="ml-1 text-muted-foreground">{formatCount(c.views)}</span>
                          </Badge>
                        ))}
                      </div>
                    </div>
                  )}
                </>
              ) : (
                <p className="text-xs text-muted-foreground">Studio data unavailable.</p>
              )}

              {/* §50 — Distribution diagnostics (last 30 days) */}
              {distributionData && (
                <Card className="gap-2 py-3">
                  <CardHeader className="py-0"><CardTitle className="text-sm">Distribution (last 30 days)</CardTitle></CardHeader>
                  <CardContent className="py-0 space-y-2">
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div><dt className="text-muted-foreground">Impressions</dt><dd className="font-medium tabular-nums">{formatCount(distributionData.summary.totalImpressions)}</dd></div>
                      <div><dt className="text-muted-foreground">Avg CTR</dt><dd className="font-medium tabular-nums">{distributionData.summary.avgCTR}%</dd></div>
                      <div><dt className="text-muted-foreground">Videos</dt><dd className="font-medium tabular-nums">{distributionData.summary.totalVideos}</dd></div>
                    </div>
                    {distributionData.topicDemand.length > 0 && (
                      <div>
                        <p className="text-xs text-muted-foreground mb-1">Topic demand</p>
                        <ul className="text-xs space-y-0.5">
                          {distributionData.topicDemand.slice(0, 5).map((t) => (
                            <li key={t.category} className="flex items-center gap-2">
                              <span className="font-medium">{t.category}</span>
                              <span className="text-muted-foreground">{t.videoCount} videos · {formatCount(t.avgViews)} avg views</span>
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <p className="text-[10px] text-muted-foreground/80 italic">Per spec §50: signals are probabilistic, not deterministic.</p>
                  </CardContent>
                </Card>
              )}

              {/* §51 — Revenue transparency */}
              {revenueData && (
                <Card className="gap-2 py-3">
                  <CardHeader className="py-0">
                    <CardTitle className="text-sm flex items-center gap-1.5">
                      <Wallet className="h-3.5 w-3.5 text-[hsl(var(--gold))]" />
                      Revenue
                    </CardTitle>
                  </CardHeader>
                  <CardContent className="py-0">
                    <div className="grid grid-cols-3 gap-3 text-xs">
                      <div><dt className="text-muted-foreground">Gross</dt><dd className="font-medium tabular-nums">{revenueData.revenue.summary.currency} ${revenueData.revenue.summary.gross.toFixed(2)}</dd></div>
                      <div><dt className="text-muted-foreground">Deductions</dt><dd className="font-medium tabular-nums">${revenueData.revenue.summary.totalDeductions.toFixed(2)}</dd></div>
                      <div><dt className="text-muted-foreground">Net</dt><dd className="font-medium tabular-nums">${revenueData.revenue.summary.netEarnings.toFixed(2)}</dd></div>
                    </div>
                    <p className="mt-2 text-[10px] text-muted-foreground">
                      Model: <span className="font-medium text-foreground">{revenueData.revenue.summary.model}</span>. Zero-cost: all amounts $0.
                    </p>
                  </CardContent>
                </Card>
              )}

              {/* §52 — Creator data export (download button). Same blob +
                  download pattern as the data-export button in Settings. */}
              <Button
                variant="outline"
                size="sm"
                className="rounded-full"
                onClick={async () => {
                  if (!bid) { toast.error("Please wait for your session to load."); return; }
                  toast.info("Preparing your creator data export…");
                  try {
                    const res = await fetch(`/api/channels/${channelId}/export?bid=${encodeURIComponent(bid)}`);
                    if (!res.ok) throw new Error("Export failed");
                    const blob = await res.blob();
                    const url = URL.createObjectURL(blob);
                    const a = document.createElement("a");
                    a.href = url;
                    a.download = `mashahd-creator-export-${channel.handle}-${new Date().toISOString().slice(0, 10)}.json`;
                    a.click();
                    URL.revokeObjectURL(url);
                    toast.success("Creator data export downloaded.");
                  } catch {
                    toast.error("Export failed — please try again.");
                  }
                }}
              >
                <Download className="h-4 w-4 mr-1.5" />
                Download data
              </Button>
            </div>
          </details>
        </section>
      </div>
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
          <div className="flex gap-2 mt-3"><Skeleton className="h-9 w-32 rounded-full" /><Skeleton className="h-9 w-24 rounded-full" /></div>
        </div>
      </div>
      <div className="px-6 mt-4 space-y-8">
        <div><Skeleton className="h-5 w-32 mb-3" /><Skeleton className="aspect-video w-full max-w-2xl rounded-xl" /></div>
        <div><Skeleton className="h-5 w-32 mb-3" />
          <div className="grid grid-cols-1 sm:grid-cols-2 md:grid-cols-3 lg:grid-cols-4 gap-4">
            {Array.from({ length: 4 }).map((_, i) => (<div key={i}><Skeleton className="aspect-video w-full rounded-xl" /><Skeleton className="h-4 w-3/4 mt-2" /><Skeleton className="h-3 w-1/2 mt-1" /></div>))}
          </div>
        </div>
      </div>
    </div>
  );
}

/**
 * EditChannelDialog — opens a Dialog to edit name / description / links /
 * country. On Save, fires PATCH /api/channels/[id] with optimistic update:
 * the channel cache is updated immediately and rolled back on error.
 *
 * The PATCH endpoint verifies ownership via signed browserId and only allows
 * a small allowlist of fields. We pass exactly the four editable fields.
 */
interface EditChannelDialogProps {
  open: boolean;
  onOpenChange: (o: boolean) => void;
  channelId: string;
  bid: string;
  channel: ChannelWithFlags;
}

function EditChannelDialog({ open, onOpenChange, channelId, bid, channel }: EditChannelDialogProps) {
  return (
    <Dialog open={open} onOpenChange={onOpenChange}>
      {/* Key on the inner form forces a fresh mount whenever the dialog
          opens — so initial state is always re-derived from the latest
          channel data, without needing a setState-in-effect. */}
      {open ? (
        <EditChannelForm
          key={`${channelId}-${open}`}
          channelId={channelId}
          bid={bid}
          channel={channel}
          onDone={() => onOpenChange(false)}
        />
      ) : null}
    </Dialog>
  );
}

interface EditChannelFormProps {
  channelId: string;
  bid: string;
  channel: ChannelWithFlags;
  onDone: () => void;
}

function EditChannelForm({ channelId, bid, channel, onDone }: EditChannelFormProps) {
  const qc = useQueryClient();
  // Initial state derived from the latest channel data on mount.
  const [name, setName] = useState(channel.name);
  const [description, setDescription] = useState(channel.description);
  const [links, setLinks] = useState(channel.links);
  const [country, setCountry] = useState(channel.country);

  const mutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/channels/${channelId}`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserId: bid,
          name,
          description,
          links,
          country,
        }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string })?.error || "Update failed");
      return data as { ok: boolean; channel: ChannelWithFlags };
    },
    onMutate: async () => {
      // Optimistically update the channel cache.
      await qc.cancelQueries({ queryKey: ["channel", channelId, bid] });
      const prev = qc.getQueryData<{ channel: ChannelWithFlags; subscribed: boolean }>(["channel", channelId, bid]);
      if (prev) {
        qc.setQueryData(["channel", channelId, bid], {
          ...prev,
          channel: { ...prev.channel, name, description, links, country },
        });
      }
      return { prev };
    },
    onError: (_err, _vars, ctx) => {
      // Roll back on error.
      if (ctx?.prev) {
        qc.setQueryData(["channel", channelId, bid], ctx.prev);
      }
      toast.error("Could not save channel — please try again.");
    },
    onSuccess: (data) => {
      // Use the server's authoritative response.
      qc.setQueryData(["channel", channelId, bid], (old: { channel: ChannelWithFlags; subscribed: boolean } | undefined) => {
        if (!old) return old;
        return { ...old, channel: data.channel };
      });
      toast.success("Channel updated");
      onDone();
    },
  });

  const handleSubmit = () => {
    if (!bid) {
      toast.error("Please wait for your session to load.");
      return;
    }
    if (!name.trim()) {
      toast.error("Channel name cannot be empty.");
      return;
    }
    mutation.mutate();
  };

  return (
    <DialogContent className="max-w-md">
      <DialogTitle>Edit channel</DialogTitle>
      <DialogDescription>
        Update your channel name, description, social links, or country.
      </DialogDescription>

      <div className="space-y-4">
        <div>
          <label htmlFor="channel-edit-name" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Channel name
          </label>
          <Input
            id="channel-edit-name"
            value={name}
            onChange={(e) => setName(e.target.value.slice(0, 200))}
            maxLength={200}
            className="mt-1"
          />
        </div>
        <div>
          <label htmlFor="channel-edit-description" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Description
          </label>
          <Textarea
            id="channel-edit-description"
            value={description}
            onChange={(e) => setDescription(e.target.value.slice(0, 2000))}
            rows={4}
            maxLength={2000}
            className="mt-1 resize-none"
          />
        </div>
        <div>
          <label htmlFor="channel-edit-links" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Links
          </label>
          <Input
            id="channel-edit-links"
            value={links}
            onChange={(e) => setLinks(e.target.value.slice(0, 500))}
            placeholder="e.g. twitter=@handle|website=https://..."
            maxLength={500}
            className="mt-1"
          />
          <p className="text-[10px] text-muted-foreground mt-1">
            Pipe-separated key=value pairs.
          </p>
        </div>
        <div>
          <label htmlFor="channel-edit-country" className="text-xs font-medium text-muted-foreground uppercase tracking-wide">
            Country
          </label>
          <Input
            id="channel-edit-country"
            value={country}
            onChange={(e) => setCountry(e.target.value.slice(0, 200))}
            placeholder="ISO code, e.g. US or SA"
            maxLength={200}
            className="mt-1"
          />
        </div>
      </div>

      <DialogFooter className="mt-2">
        <Button
          variant="ghost"
          size="sm"
          className="rounded-full"
          onClick={onDone}
          disabled={mutation.isPending}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="rounded-full bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={handleSubmit}
          disabled={mutation.isPending || !name.trim()}
        >
          {mutation.isPending ? (
            <>
              <Loader2 className="h-4 w-4 mr-1.5 animate-spin" />
              Saving…
            </>
          ) : (
            "Save changes"
          )}
        </Button>
      </DialogFooter>
    </DialogContent>
  );
}
