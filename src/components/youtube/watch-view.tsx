"use client";

import { useEffect, useState, useRef } from "react";
import { useQuery, useMutation, useQueryClient } from "@tanstack/react-query";
import { ThumbsUp, ThumbsDown, Download, MoreHorizontal, Bell, Sparkles, ListVideo, Languages, Loader2, Maximize2, MessageSquarePlus, Compass, Wand2, Heart, Bookmark, Check, ListPlus, Users, FileText, Scissors, Info, Search, RefreshCw, Shield, Scale } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Skeleton } from "@/components/ui/skeleton";
import { Input } from "@/components/ui/input";
import { Textarea } from "@/components/ui/textarea";
import { useAppStore } from "@/store/app-store";
import { useMiniPlayer } from "@/store/mini-player-store";
import { useBrowserId } from "@/hooks/use-browser-id";
import { useAuth } from "@/hooks/use-auth";
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
import { MashahdPlayerLazy as MashahdPlayer } from "./mashahd-player-lazy";
import { UserAvatar } from "./user-avatar";
import { ShareButton } from "./header-overlays";
import { toast } from "sonner";

async function fetchVideo(id: string, bid: string) {
  const sp = new URLSearchParams();
  if (bid) sp.set("bid", bid);
  const res = await fetch(`/api/videos/${id}?${sp.toString()}`);
  if (!res.ok) throw new Error("failed");
  const data = await res.json();
  return data as { video: VideoWithFlags; liked: boolean; disliked: boolean; subscribed: boolean };
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

// §61 — ad disclosures. Returns sponsor info so the watch view can show a
// "Sponsored: {sponsor}" badge next to the title when disclosures exist.
interface AdDisclosureItem {
  id: string;
  sponsor: string;
  adType: string;
  isPaid: boolean;
  label: string;
  product?: string | null;
  disclosureNote?: string | null;
  createdAt?: string;
}
interface AdDisclosuresResponse {
  disclosures: AdDisclosureItem[];
}
async function fetchAdDisclosures(id: string): Promise<AdDisclosuresResponse> {
  const res = await fetch(`/api/videos/${id}/ad-disclosures`);
  if (!res.ok) return { disclosures: [] };
  const data = await res.json();
  return { disclosures: (data?.disclosures as AdDisclosureItem[]) || [] };
}

// §65 — informational context (publication date, provenance, corrections,
// rights claims) shown below the description in a collapsible <details>.
interface VideoContextResponse {
  publicationDate?: string;
  provenance?: { origin?: string; sourceNote?: string };
  corrections?: Array<{ note?: string; createdAt?: string }>;
  rightsClaims?: Array<{ claimant?: string; claimType?: string }>;
}
async function fetchVideoContext(id: string): Promise<VideoContextResponse | null> {
  const res = await fetch(`/api/videos/${id}/context`);
  if (!res.ok) return null;
  return (await res.json()) as VideoContextResponse;
}

// §20-21 — quality signals. Used by the comments header to show a small
// colored quality badge (green/yellow/red) based on the aggregated score.
interface QualitySignalsResponse {
  qualityScore: number;
  likeRatio: number;
}
async function fetchQualitySignals(id: string): Promise<QualitySignalsResponse | null> {
  const res = await fetch(`/api/videos/${id}/quality-signals`);
  if (!res.ok) return null;
  return (await res.json()) as QualitySignalsResponse;
}

// §45 — live polls. Returns active + closed polls for the video. Only
// fetched when the video title heuristically looks like a live stream.
interface PollOption { text: string; votes: number; }
interface PollItem {
  id: string;
  question: string;
  options: PollOption[];
  status: string;
  totalVotes: number;
  createdAt?: string;
}
interface PollsResponse { polls: PollItem[]; }
async function fetchPolls(id: string): Promise<PollsResponse> {
  const res = await fetch(`/api/videos/${id}/polls`);
  if (!res.ok) return { polls: [] };
  const data = await res.json();
  return { polls: (data?.polls as PollItem[]) || [] };
}

// §45 — live Q&A. Returns answered + unanswered questions for the video.
interface QAItem {
  id: string;
  askerName: string;
  question: string;
  answer: string | null;
  upvotes: number;
  isAnswered: boolean;
  createdAt?: string;
}
interface QAResponse { entries: QAItem[]; }
async function fetchQA(id: string): Promise<QAResponse> {
  const res = await fetch(`/api/videos/${id}/qa`);
  if (!res.ok) return { entries: [] };
  const data = await res.json();
  return { entries: (data?.entries as QAItem[]) || [] };
}

// §53 — rights claims. Shown as a collapsible "Rights" section in the
// description area when any active claims exist (transparency).
interface RightsClaimItem {
  id: string;
  claimant: string;
  claimType: string;
  matchedMaterial: string;
  action: string;
  status: string;
}
interface RightsClaimsResponse { claims: RightsClaimItem[]; }
async function fetchRightsClaims(id: string): Promise<RightsClaimsResponse> {
  const res = await fetch(`/api/videos/${id}/rights-claims`);
  if (!res.ok) return { claims: [] };
  const data = await res.json();
  return { claims: (data?.claims as RightsClaimItem[]) || [] };
}

// §66 — creator corrections. Shown as a collapsible "Corrections" section
// in the description area when any corrections exist.
interface CorrectionItem {
  id: string;
  timestamp: number;
  originalText: string;
  correctedText: string;
  note?: string;
  viewersNotified?: boolean;
  createdAt?: string;
}
interface CorrectionsResponse { corrections: CorrectionItem[]; }
async function fetchCorrections(id: string): Promise<CorrectionsResponse> {
  const res = await fetch(`/api/videos/${id}/corrections`);
  if (!res.ok) return { corrections: [] };
  const data = await res.json();
  return { corrections: (data?.corrections as CorrectionItem[]) || [] };
}

// §41 — video relationships. Shown as a small "Related" list below the
// "Continue watching" carousel when any relationships exist.
interface RelationshipItem {
  id: string;
  relationType: string;
  note: string;
  createdBy: string;
  video: { id: string; title: string; thumbnailUrl: string; channel: { name: string } } | null;
}
interface RelationshipsResponse { relationships: RelationshipItem[]; }
async function fetchRelationships(id: string): Promise<RelationshipsResponse> {
  const res = await fetch(`/api/videos/${id}/relationships`);
  if (!res.ok) return { relationships: [] };
  const data = await res.json();
  return { relationships: (data?.relationships as RelationshipItem[]) || [] };
}

// §38 — AI search-in-video. Returns a list of { start, end, reason, deepLink }
// timestamps where the topic is discussed. The deep link seeks the player.
interface SearchInVideoResult {
  start: number;
  end: number;
  reason: string;
  deepLink: string;
}
interface SearchInVideoResponse {
  results: SearchInVideoResult[];
  source?: string;
  query?: string;
  note?: string;
}
async function searchInVideo(videoId: string, query: string): Promise<SearchInVideoResponse> {
  const res = await fetch("/api/ai/search-in-video", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ videoId, query }),
  });
  if (!res.ok) {
    const err = await res.json().catch(() => ({}));
    throw new Error((err as { error?: string })?.error || "Search failed");
  }
  return (await res.json()) as SearchInVideoResponse;
}

// §23 — moderation transparency. Returns moderation actions count, appeal
// availability, entity breakdown (platform vs creator), ad transparency
// list, and community feedback summary. Shown as a collapsible section.
interface ModerationAction {
  id: string;
  type: string;
  action: string;
  reason: string;
  claimant?: string;
  automated: boolean;
  status: string;
  appealAvailable?: boolean;
  appealStatus?: string | null;
  appealResult?: string | null;
  entity: "platform" | "creator";
}
interface ModerationAdTransparency {
  adType: string;
  sponsor: string;
  isPaid: boolean;
  label: string;
}
interface ModerationResponse {
  videoId: string;
  moderationActions: ModerationAction[];
  moderationCount: number;
  appealAvailable: boolean;
  entityBreakdown: { platform: number; creator: number };
  adTransparency: ModerationAdTransparency[];
  communityFeedback: {
    summary: Record<string, number>;
    total: number;
    note: string;
  };
}
async function fetchModeration(id: string): Promise<ModerationResponse | null> {
  const res = await fetch(`/api/moderation?videoId=${encodeURIComponent(id)}`);
  if (!res.ok) return null;
  return (await res.json()) as ModerationResponse;
}

// §46 — live-to-VOD conversion. POST returns the produced artifacts (replay,
// transcript, chapters, etc.) — surfaced to the user as a toast.
interface LiveToVodResponse {
  ok: boolean;
  videoId: string;
  wasLive: boolean;
  newVisibility: string;
  producedArtifacts: string[];
  jobId: string | null;
  note: string;
  artifacts: {
    replay: boolean;
    transcript: string;
    chapters: string;
    highlights: string;
    clips: string;
    searchableMoments: string;
  };
}

export function WatchView({ videoId }: { videoId: string }) {
  const bid = useBrowserId();
  const qc = useQueryClient();
  const { navigate } = useAppStore();
  // §24 — dispute filing: the disputant is the current user's displayName,
  // or "Anonymous" if not signed in (the backend requires a non-empty
  // disputant string for every dispute).
  const { user } = useAuth();
  const disputantName = user?.displayName || "Anonymous";
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
  // §24 — Track which rights claim has its inline dispute form open.
  // Only one form is open at a time per video (set of claim ids).
  const [disputeOpenFor, setDisputeOpenFor] = useState<string | null>(null);
  // Age gate — true once the user has confirmed 18+ for an age-restricted
  // video in this session. Persisted in sessionStorage so it only shows once
  // per session (cleared when the browser tab closes).
  const [ageConfirmed, setAgeConfirmed] = useState(false);
  const viewsRecorded = useRef(false);
  const videoRef = useRef<HTMLVideoElement | null>(null);

  const { data, isLoading, isError } = useQuery({
    queryKey: ["video", videoId, bid],
    queryFn: () => fetchVideo(videoId, bid),
    enabled: !!bid,
  });

  const video = data?.video;
  // §45 — heuristic: if the title mentions "live", treat this as a live
  // stream and surface the polls + Q&A panel. Computed from the loaded
  // video data so the polls/qa useQuery hooks can re-enable once data
  // arrives. The useQuery hooks below use this in `enabled`, so the
  // hook order is stable (React doesn't conditionally call them).
  const isLiveStream = !!(video?.title && /\blive\b/i.test(video.title));

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

  // §61 — ad disclosures for the "Sponsored" badge near the title.
  const { data: adDisclosures } = useQuery({
    queryKey: ["ad-disclosures", videoId],
    queryFn: () => fetchAdDisclosures(videoId),
    enabled: !!videoId,
    staleTime: 60_000,
  });

  // §65 — informational context below the description.
  const { data: contextData } = useQuery({
    queryKey: ["video-context", videoId],
    queryFn: () => fetchVideoContext(videoId),
    enabled: !!videoId,
    staleTime: 60_000,
  });

  // §45 — live polls + Q&A (only fetched for live-stream videos, per the
  // title heuristic above). Both panels render together below the description.
  const { data: pollsData, refetch: refetchPolls } = useQuery({
    queryKey: ["video-polls", videoId],
    queryFn: () => fetchPolls(videoId),
    enabled: !!videoId && isLiveStream,
    staleTime: 30_000,
  });
  const { data: qaData, refetch: refetchQA } = useQuery({
    queryKey: ["video-qa", videoId],
    queryFn: () => fetchQA(videoId),
    enabled: !!videoId && isLiveStream,
    staleTime: 30_000,
  });

  // §53 — rights claims. Shown as a collapsible section in the description
  // area when any claims exist. Non-blocking (no spinner).
  const { data: rightsClaimsData } = useQuery({
    queryKey: ["rights-claims", videoId],
    queryFn: () => fetchRightsClaims(videoId),
    enabled: !!videoId,
    staleTime: 60_000,
  });

  // §66 — creator corrections. Same pattern as rights claims.
  const { data: correctionsData } = useQuery({
    queryKey: ["corrections", videoId],
    queryFn: () => fetchCorrections(videoId),
    enabled: !!videoId,
    staleTime: 60_000,
  });

  // §41 — video relationships. Shown as a small "Related" list below the
  // "Continue watching" carousel when any relationships exist.
  const { data: relationshipsData } = useQuery({
    queryKey: ["video-relationships", videoId],
    queryFn: () => fetchRelationships(videoId),
    enabled: !!videoId,
    staleTime: 60_000,
  });

  // §23 — moderation transparency. Fetched for the description's collapsible
  // "Moderation" section. Non-blocking (no spinner); shown once data arrives.
  const { data: moderationData } = useQuery({
    queryKey: ["video-moderation", videoId],
    queryFn: () => fetchModeration(videoId),
    enabled: !!videoId,
    staleTime: 60_000,
  });

  // §38 — AI search-in-video. Mutation so the loading state is shown while
  // the AI thinks. Results are stored in local state (per-search).
  const [searchQuery, setSearchQuery] = useState("");
  const searchMutation = useMutation({
    mutationFn: ({ q }: { q: string }) => searchInVideo(videoId, q),
  });

  // §46 — live-to-VOD conversion. Fire-and-forget POST; the produced
  // artifacts are surfaced to the user via toast.
  const liveToVodMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch(`/api/videos/${videoId}/live-to-vod`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
      });
      if (!res.ok) {
        const err = await res.json().catch(() => ({}));
        throw new Error((err as { error?: string })?.error || "Conversion failed");
      }
      return (await res.json()) as LiveToVodResponse;
    },
    onSuccess: (data) => {
      const artifacts = data.producedArtifacts.join(", ");
      toast.success(`Converted to VOD`, {
        description: `Artifacts: ${artifacts || "none"}. ${data.note}`.slice(0, 200),
      });
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Conversion failed";
      toast.error(msg);
    },
  });

  // §24 — File a rights-claim dispute. POST /api/rights-claims/[id]/disputes
  // with { disputant, reason, evidence }. On success, invalidate the rights
  // claims query so the panel re-renders with the claim's new "disputed"
  // status. The disputant is the current user's displayName (or "Anonymous").
  const disputeMutation = useMutation({
    mutationFn: async ({ claimId, reason, evidence }: { claimId: string; reason: string; evidence: string }) => {
      const res = await fetch(`/api/rights-claims/${claimId}/disputes`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ disputant: disputantName, reason, evidence }),
      });
      const data = await res.json();
      if (!res.ok) throw new Error((data as { error?: string })?.error || "Failed to file dispute");
      return data as { ok: boolean; dispute: { id: string; status: string }; message?: string };
    },
    onSuccess: (data) => {
      qc.invalidateQueries({ queryKey: ["rights-claims", videoId] });
      toast.success("Dispute filed", {
        description: data.message || "The claim status is now 'disputed'.",
      });
      setDisputeOpenFor(null);
    },
    onError: (e: unknown) => {
      const msg = e instanceof Error ? e.message : "Failed to file dispute";
      toast.error(msg);
    },
  });

  // Record a view once when the watch page opens
  useEffect(() => {
    if (viewsRecorded.current) return;
    if (!videoId) return;
    viewsRecorded.current = true;
    fetch(`/api/videos/${videoId}/views`, { method: "POST" }).catch(() => {});
  }, [videoId]);

  // Age gate confirmation — hydrate from sessionStorage so the gate only
  // shows once per session (cleared automatically when the tab closes).
  // We hydrate in an effect (rather than during render) to avoid SSR/CSR
  // hydration mismatches: sessionStorage is undefined on the server.
  useEffect(() => {
    if (typeof window === "undefined") return;
    try {
      if (window.sessionStorage.getItem("mashahd:age-confirmed") === "1") {
        // eslint-disable-next-line react-hooks/set-state-in-effect
        setAgeConfirmed(true);
      }
    } catch {
      // sessionStorage can throw in privacy-mode browsers — treat as not
      // confirmed, so the user will see the gate (safe default).
    }
  }, [videoId]);

  // The video is age-restricted AND the user hasn't confirmed in this
  // session → we block autoplay and show the gate overlay.
  const needsAgeGate = !!video?.ageGated && !ageConfirmed;

  // Record into watch history
  useEffect(() => {
    if (!bid || !videoId) return;
    fetch(`/api/user-state`, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ browserId: bid, action: "watch", videoId }),
    }).catch(() => {});
  }, [bid, videoId]);

  // Save continue-watching position (§32) — debounced via a ref + interval.
  // Saves every 10s while the video is playing, + once on unmount.
  const lastSavedPosRef = useRef(0);
  useEffect(() => {
    if (!bid || !videoId) return;
    const interval = setInterval(() => {
      const v = videoRef.current;
      if (!v || v.paused || v.ended) return;
      const pos = Math.floor(v.currentTime || 0);
      // Only save if position changed by >= 3s (avoid spamming).
      if (Math.abs(pos - lastSavedPosRef.current) < 3) return;
      lastSavedPosRef.current = pos;
      fetch("/api/continue-watching", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          browserId: bid,
          videoId,
          position: pos,
          completed: false,
        }),
      }).catch(() => {});
    }, 10_000);
    return () => {
      clearInterval(interval);
      // Save final position on unmount.
      const v = videoRef.current;
      if (v) {
        const pos = Math.floor(v.currentTime || 0);
        if (pos > 3) {
          fetch("/api/continue-watching", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              browserId: bid,
              videoId,
              position: pos,
              completed: v.ended,
            }),
          }).catch(() => {});
        }
      }
    };
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
    mutationFn: async (action: "like" | "unlike" | "dislike" | "undislike") => {
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
        // Compute the like/dislike counter deltas based on the previous state.
        // Like and dislike are mutually exclusive — switching between them
        // adjusts both counters.
        let likeDelta = 0;
        let dislikeDelta = 0;
        const wasLiked = !!old.liked;
        const wasDisliked = !!old.disliked;
        if (action === "like") {
          if (!wasLiked) likeDelta += 1;
          if (wasDisliked) dislikeDelta -= 1;
        } else if (action === "unlike") {
          if (wasLiked) likeDelta -= 1;
        } else if (action === "dislike") {
          if (!wasDisliked) dislikeDelta += 1;
          if (wasLiked) likeDelta -= 1;
        } else if (action === "undislike") {
          if (wasDisliked) dislikeDelta -= 1;
        }
        return {
          ...old,
          video: {
            ...old.video,
            likes: Math.max(0, old.video.likes + likeDelta),
            dislikes: Math.max(0, old.video.dislikes + dislikeDelta),
          },
          liked: action === "like",
          disliked: action === "dislike",
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
            autoPlay={!needsAgeGate}
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
                upNext && "opacity-0 pointer-events-none",
                needsAgeGate && "hidden"
              )}
              aria-label={theater ? "Exit theater mode" : "Theater mode"}
              title={theater ? "Exit theater mode" : "Theater mode"}
            >
              <Maximize2 className="h-3.5 w-3.5" />
              {theater ? "Exit" : "Theater"}
            </button>
            {/* Age gate — overlays the player for 18+ videos until the
                viewer confirms in this session. Stored in sessionStorage
                so it only appears once per session. */}
            {needsAgeGate && (
              <div
                role="dialog"
                aria-modal="true"
                aria-label="Age confirmation"
                className="absolute inset-0 z-30 grid place-items-center bg-black/85 backdrop-blur-sm p-4"
              >
                <div className="glass-strong rounded-2xl border border-white/15 shadow-glow max-w-md w-full p-6 text-center">
                  <div className="mx-auto mb-3 grid place-items-center h-12 w-12 rounded-full bg-rose/20 text-rose">
                    <span className="text-lg font-bold">18+</span>
                  </div>
                  <h2 className="text-white text-lg font-semibold">
                    Age-restricted video
                  </h2>
                  <p className="text-white/70 text-sm mt-2">
                    This video is age-restricted. Are you 18 or older?
                  </p>
                  <div className="mt-5 flex flex-col sm:flex-row gap-2 justify-center">
                    <Button
                      variant="default"
                      className="rounded-full h-10 px-5 bg-primary text-primary-foreground hover:bg-primary/90"
                      onClick={() => {
                        try {
                          window.sessionStorage.setItem("mashahd:age-confirmed", "1");
                        } catch {
                          // sessionStorage may be unavailable (private mode);
                          // we still unblock in-session via state.
                        }
                        setAgeConfirmed(true);
                      }}
                    >
                      Yes, I&apos;m 18+
                    </Button>
                    <Button
                      variant="secondary"
                      className="rounded-full h-10 px-5 bg-white/10 text-white hover:bg-white/20"
                      onClick={() => navigate({ kind: "home" })}
                    >
                      No, go back
                    </Button>
                  </div>
                </div>
              </div>
            )}
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
          <div className="mt-3 px-4 sm:px-0 flex items-start gap-2 flex-wrap">
            <h1 className="text-lg sm:text-xl font-semibold leading-snug flex-1 min-w-0">
              {video.title}
            </h1>
            {/* §61 — Sponsored badge. Shown only when the video has at least
                one ad disclosure. Gold-tinted to distinguish from organic. */}
            {adDisclosures && adDisclosures.disclosures.length > 0 && (
              <Badge
                variant="outline"
                className="shrink-0 bg-gold/15 text-gold border-gold/40"
                title={
                  adDisclosures.disclosures[0]?.disclosureNote
                  || `Sponsored by ${adDisclosures.disclosures[0]?.sponsor}`
                }
              >
                Sponsored: {adDisclosures.disclosures[0]?.sponsor}
              </Badge>
            )}
          </div>

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
                  onClick={() =>
                    likeMutation.mutate(
                      data?.disliked ? "undislike" : "dislike"
                    )
                  }
                  disabled={likeMutation.isPending}
                  className={cn(
                    "flex items-center gap-1 px-4 h-full hover:bg-accent transition-colors text-sm",
                    data?.disliked && "text-rose"
                  )}
                  aria-label="Dislike"
                  title="Not a fan of this video"
                >
                  <ThumbsDown className={cn("h-5 w-5", data?.disliked && "fill-current")} />
                  <span className="tabular-nums">{formatCount(video.dislikes)}</span>
                </button>
              </div>
              <ShareButton videoId={video.id} title={video.title} />
              {/* §46 — Live-to-VOD button. Only shown when the video title
                  heuristically looks like a live stream (same regex as the
                  polls/Q&A panel below). On click: POST to
                  /api/videos/[id]/live-to-vod and toast the produced
                  artifacts (replay, transcript, chapters, etc.). This is an
                  admin/creator action — in production it would require
                  ownership verification before the API write fires. */}
              {isLiveStream && (
                <Button
                  variant="secondary"
                  size="sm"
                  className="rounded-full h-9 px-4 bg-muted hover:bg-accent hidden sm:inline-flex"
                  onClick={() => liveToVodMutation.mutate()}
                  disabled={liveToVodMutation.isPending}
                  aria-label="Convert this live stream to VOD"
                  title="Produce replay, transcript, chapters, and searchable moments from this live stream"
                >
                  <RefreshCw className={cn("h-4 w-4 mr-1.5", liveToVodMutation.isPending && "animate-spin")} />
                  {liveToVodMutation.isPending ? "Converting…" : "Convert to VOD"}
                </Button>
              )}
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
              {/* §65 — Informational context (publication date, provenance,
                  corrections count, rights claims count). Collapsible so it
                  doesn't dominate the description area. */}
              {contextData && (
                <details className="mt-2 group rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <summary className="cursor-pointer list-none flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <Info className="h-3.5 w-3.5" />
                    Context
                    <span className="ml-auto text-muted-foreground/70 group-open:rotate-180 transition-transform" aria-hidden>⌄</span>
                  </summary>
                  <div className="mt-2 space-y-1 text-xs text-muted-foreground">
                    {contextData.publicationDate && (
                      <p>
                        Published: {new Date(contextData.publicationDate).toLocaleDateString()}
                      </p>
                    )}
                    <p>
                      Provenance origin: {contextData.provenance?.origin || "unknown"}
                    </p>
                    <p>
                      Corrections: {contextData.corrections?.length ?? 0}
                    </p>
                    <p>
                      Rights claims: {contextData.rightsClaims?.length ?? 0}
                    </p>
                  </div>
                </details>
              )}
              {/* §53 — Rights claims. Shown only when claims exist. Collapsible
                  so it doesn't intrude on the description. Lists claimant,
                  claimType, matchedMaterial, action (per spec). */}
              {rightsClaimsData && rightsClaimsData.claims.length > 0 && (
                <details className="mt-2 group rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <summary className="cursor-pointer list-none flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <Info className="h-3.5 w-3.5" />
                    Rights ({rightsClaimsData.claims.length})
                    <span className="ml-auto text-muted-foreground/70 group-open:rotate-180 transition-transform" aria-hidden>⌄</span>
                  </summary>
                  <ul className="mt-2 space-y-2 text-xs">
                    {rightsClaimsData.claims.map((c) => (
                      <li key={c.id} className="rounded-md border border-border/60 bg-background/40 p-2">
                        <div className="flex flex-wrap items-center gap-1.5">
                          <span className="font-medium text-foreground">{c.claimant}</span>
                          <Badge variant="outline" className="text-[10px] py-0">{c.claimType}</Badge>
                          <Badge variant="outline" className="text-[10px] py-0">{c.action}</Badge>
                          {c.status !== "active" && <Badge variant="secondary" className="text-[10px] py-0">{c.status}</Badge>}
                          {c.status === "active" && (
                            <Button
                              variant="ghost"
                              size="sm"
                              className="h-6 px-2 text-[11px] rounded-full ml-auto hover:bg-rose/10 hover:text-rose"
                              onClick={() => setDisputeOpenFor((cur) => (cur === c.id ? null : c.id))}
                              aria-label={`File dispute for claim by ${c.claimant}`}
                              aria-expanded={disputeOpenFor === c.id}
                            >
                              <Scale className="h-3 w-3 mr-1" />
                              {disputeOpenFor === c.id ? "Cancel" : "File dispute"}
                            </Button>
                          )}
                        </div>
                        {c.matchedMaterial && <p className="mt-1 text-muted-foreground">Matched: {c.matchedMaterial}</p>}
                        {disputeOpenFor === c.id && (
                          <DisputeForm
                            claimId={c.id}
                            submitting={disputeMutation.isPending}
                            onCancel={() => setDisputeOpenFor(null)}
                            onSubmit={({ reason, evidence }) =>
                              disputeMutation.mutate({ claimId: c.id, reason, evidence })
                            }
                          />
                        )}
                      </li>
                    ))}
                  </ul>
                </details>
              )}
              {/* §66 — Creator corrections. Same pattern. Lists timestamp,
                  originalText → correctedText (per spec). */}
              {correctionsData && correctionsData.corrections.length > 0 && (
                <details className="mt-2 group rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <summary className="cursor-pointer list-none flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <Info className="h-3.5 w-3.5" />
                    Corrections ({correctionsData.corrections.length})
                    <span className="ml-auto text-muted-foreground/70 group-open:rotate-180 transition-transform" aria-hidden>⌄</span>
                  </summary>
                  <ul className="mt-2 space-y-2 text-xs">
                    {correctionsData.corrections.map((c) => {
                      const m = Math.floor(c.timestamp / 60);
                      const s = c.timestamp % 60;
                      return (
                        <li key={c.id} className="rounded-md border border-border/60 bg-background/40 p-2">
                          <p className="text-[10px] text-muted-foreground mb-0.5">@ {m}:{String(s).padStart(2, "0")}</p>
                          <p className="text-muted-foreground line-through/0"><span className="opacity-70">original: </span>{c.originalText}</p>
                          <p className="text-foreground"><span className="opacity-70">corrected: </span>{c.correctedText}</p>
                          {c.note && <p className="mt-1 italic text-muted-foreground/80">{c.note}</p>}
                        </li>
                      );
                    })}
                  </ul>
                </details>
              )}
              {/* §23 — Moderation transparency. Collapsible <details> in the
                  description area (after Context/Rights/Corrections). Shows
                  moderation actions count, appeal availability, entity
                  breakdown (platform vs creator), ad transparency list, and
                  a community feedback summary. Per spec §22-23: do not make
                  enforcement unnecessarily opaque. */}
              {moderationData && (
                <details className="mt-2 group rounded-lg border border-border/60 bg-muted/30 px-3 py-2">
                  <summary className="cursor-pointer list-none flex items-center gap-1.5 text-xs font-medium text-muted-foreground hover:text-foreground">
                    <Shield className="h-3.5 w-3.5" />
                    Moderation ({moderationData.moderationCount})
                    {moderationData.appealAvailable && (
                      <Badge variant="outline" className="text-[10px] py-0 ml-1 border-amber-500/40 text-amber-600">
                        Appeal available
                      </Badge>
                    )}
                    <span className="ml-auto text-muted-foreground/70 group-open:rotate-180 transition-transform" aria-hidden>⌄</span>
                  </summary>
                  <div className="mt-2 space-y-2 text-xs text-muted-foreground">
                    <p>
                      Actions:{" "}
                      <span className="text-foreground font-medium tabular-nums">{moderationData.moderationCount}</span>
                      {" · "}
                      Platform: <span className="text-foreground tabular-nums">{moderationData.entityBreakdown.platform}</span>
                      {" · "}
                      Creator: <span className="text-foreground tabular-nums">{moderationData.entityBreakdown.creator}</span>
                    </p>
                    {moderationData.moderationActions.length > 0 && (
                      <ul className="space-y-1.5">
                        {moderationData.moderationActions.map((a) => (
                          <li key={a.id} className="rounded-md border border-border/60 bg-background/40 p-2">
                            <div className="flex flex-wrap items-center gap-1.5">
                              <Badge variant="outline" className="text-[10px] py-0">{a.entity}</Badge>
                              <Badge variant="outline" className="text-[10px] py-0">{a.action}</Badge>
                              <Badge variant="secondary" className="text-[10px] py-0">
                                {a.automated ? "automated" : "human"}
                              </Badge>
                              {a.appealAvailable && (
                                <Badge variant="outline" className="text-[10px] py-0 border-amber-500/40 text-amber-600">
                                  appeal: {a.appealStatus || "available"}
                                </Badge>
                              )}
                            </div>
                            <p className="mt-1">{a.reason}</p>
                            {a.appealResult && (
                              <p className="mt-1 italic">Appeal result: {a.appealResult}</p>
                            )}
                          </li>
                        ))}
                      </ul>
                    )}
                    {moderationData.adTransparency.length > 0 && (
                      <div>
                        <p className="text-[10px] uppercase tracking-wide">Ad transparency</p>
                        <ul className="mt-1 space-y-0.5">
                          {moderationData.adTransparency.map((a, i) => (
                            <li key={i}>
                              <span className="text-foreground">{a.label}</span>
                              {a.sponsor && ` — ${a.sponsor}`}
                              {a.isPaid && " (paid)"}
                            </li>
                          ))}
                        </ul>
                      </div>
                    )}
                    <div>
                      <p className="text-[10px] uppercase tracking-wide">Community feedback</p>
                      <p className="mt-0.5 tabular-nums">
                        {moderationData.communityFeedback.total} report{moderationData.communityFeedback.total === 1 ? "" : "s"}
                      </p>
                      {Object.keys(moderationData.communityFeedback.summary).length > 0 && (
                        <ul className="mt-1 space-y-0.5">
                          {Object.entries(moderationData.communityFeedback.summary).map(([reason, count]) => (
                            <li key={reason}>
                              {reason}: <span className="tabular-nums">{count}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                      <p className="mt-1 italic text-[10px]">{moderationData.communityFeedback.note}</p>
                    </div>
                  </div>
                </details>
              )}
            </div>
          </div>

          {/* §38 — AI Search-in-video. A small input + results list below the
              description. On Enter: POST to /api/ai/search-in-video with
              { videoId, query } via useMutation. Results render as clickable
              timestamps (formatted m:ss) that seek the player to the start
              second. Falls back gracefully when no transcript or no match. */}
          <div className="mt-4 px-4 sm:px-0">
            <details className="group rounded-xl border border-border bg-card p-3">
              <summary className="cursor-pointer list-none flex items-center gap-1.5 text-sm font-medium">
                <Search className="h-4 w-4" />
                Search in video
                <span className="ml-auto text-muted-foreground/70 group-open:rotate-180 transition-transform" aria-hidden>⌄</span>
              </summary>
              <div className="mt-3 space-y-2">
                <div className="flex gap-2">
                  <Input
                    value={searchQuery}
                    onChange={(e) => setSearchQuery(e.target.value)}
                    onKeyDown={(e) => {
                      if (e.key === "Enter" && !e.shiftKey && searchQuery.trim()) {
                        e.preventDefault();
                        searchMutation.mutate({ q: searchQuery.trim() });
                      }
                    }}
                    placeholder="Where does this video discuss…? (e.g. customs clearance)"
                    aria-label="Search inside this video"
                    className="h-9 text-sm"
                  />
                  <Button
                    size="sm"
                    className="rounded-full h-9 px-4 shrink-0"
                    onClick={() => searchQuery.trim() && searchMutation.mutate({ q: searchQuery.trim() })}
                    disabled={searchMutation.isPending || !searchQuery.trim()}
                  >
                    {searchMutation.isPending ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : (
                      <Search className="h-4 w-4" />
                    )}
                    Find
                  </Button>
                </div>
                {searchMutation.data && (
                  <div className="text-xs">
                    {searchMutation.data.results.length > 0 ? (
                      <ul className="space-y-1.5">
                        {searchMutation.data.results.map((r, i) => {
                          const m = Math.floor(r.start / 60);
                          const s = Math.floor(r.start % 60);
                          return (
                            <li key={i}>
                              <a
                                href={r.deepLink}
                                onClick={(e) => {
                                  // Seek the player instead of navigating —
                                  // we're already on the watch page.
                                  e.preventDefault();
                                  const v = videoRef.current;
                                  if (v) {
                                    v.currentTime = r.start;
                                    v.play().catch(() => {});
                                  }
                                }}
                                className="flex items-start gap-2 rounded-md border border-border/60 bg-background/40 p-2 hover:bg-accent transition-colors"
                                title={`Seek to ${m}:${String(s).padStart(2, "0")} — ${r.deepLink}`}
                              >
                                <span className="shrink-0 font-mono tabular-nums px-1.5 py-0.5 rounded-full bg-[hsl(var(--gold)/0.12)] border border-gold/30 text-[hsl(var(--gold))]">
                                  {m}:{String(s).padStart(2, "0")}
                                </span>
                                <span className="text-muted-foreground">{r.reason}</span>
                              </a>
                            </li>
                          );
                        })}
                      </ul>
                    ) : (
                      <p className="text-muted-foreground">
                        {searchMutation.data.note || "No results found. Try a different query."}
                      </p>
                    )}
                    {searchMutation.data.source && (
                      <p className="mt-2 italic text-[10px] text-muted-foreground">
                        Source: {searchMutation.data.source}
                      </p>
                    )}
                  </div>
                )}
                {searchMutation.isError && (
                  <p className="text-xs text-destructive">
                    {searchMutation.error instanceof Error ? searchMutation.error.message : "Search failed"}
                  </p>
                )}
              </div>
            </details>
          </div>

          {/* §45 — Live polls + Q&A panel. Shown only when the video title
              heuristically looks like a live stream. Both polls and Q&A
              are minimal — small cards, not full views. */}
          {isLiveStream && (
            <div className="mt-4 px-4 sm:px-0 grid sm:grid-cols-2 gap-3">
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold mb-2">
                  <span className="h-2 w-2 rounded-full bg-rose animate-pulse" aria-hidden />
                  Live Polls
                </div>
                {pollsData && pollsData.polls.length > 0 ? (
                  <ul className="space-y-3 text-xs">
                    {pollsData.polls.slice(0, 3).map((p) => (
                      <li key={p.id}>
                        <p className="font-medium">{p.question}</p>
                        <div className="mt-1 space-y-1">
                          {p.options.map((o, i) => (
                            <button
                              key={i}
                              onClick={async () => {
                                try {
                                  await fetch(`/api/videos/${videoId}/polls`, {
                                    method: "PATCH",
                                    headers: { "Content-Type": "application/json" },
                                    body: JSON.stringify({ pollId: p.id, action: "vote", optionIndex: i }),
                                  });
                                  refetchPolls();
                                } catch {
                                  toast.error("Vote failed");
                                }
                              }}
                              disabled={p.status !== "active"}
                              className="block w-full text-left px-2 py-1 rounded-md border border-border hover:bg-accent disabled:opacity-60 disabled:cursor-not-allowed"
                              title={p.status !== "active" ? "Poll closed" : `Vote: ${o.text}`}
                            >
                              {o.text} <span className="text-muted-foreground">({o.votes})</span>
                            </button>
                          ))}
                        </div>
                        <p className="text-muted-foreground mt-1">
                          {p.totalVotes} total votes{p.status !== "active" && " · closed"}
                        </p>
                      </li>
                    ))}
                  </ul>
                ) : (
                  <p className="text-xs text-muted-foreground">No active polls.</p>
                )}
              </div>
              <div className="rounded-xl border border-border bg-card p-3">
                <div className="flex items-center gap-1.5 text-sm font-semibold mb-2">
                  <span className="h-2 w-2 rounded-full bg-rose animate-pulse" aria-hidden />
                  Live Q&A
                </div>
                <LiveQAList
                  videoId={videoId}
                  bid={bid}
                  entries={qaData?.entries}
                  refetch={refetchQA}
                />
              </div>
            </div>
          )}

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
          {/* §41 — Video relationships. Shown as a small "Related" list
              below the "Continue watching" carousel when any exist. Each
              item is a clickable row that navigates to the related video. */}
          {!theater && relationshipsData && relationshipsData.relationships.length > 0 && (
            <section className="mt-6 px-4 sm:px-0">
              <h2 className="text-sm font-semibold mb-2 font-display">Related videos</h2>
              <ul className="space-y-1.5">
                {relationshipsData.relationships.map((r) => (
                  <li key={r.id}>
                    {r.video ? (
                      <button
                        onClick={() => navigate({ kind: "watch", videoId: r.video!.id })}
                        className="flex items-center gap-2 text-sm hover:bg-accent rounded-md px-2 py-1 -mx-2 text-left w-full"
                      >
                        <Badge variant="outline" className="text-[10px] py-0 shrink-0">{r.relationType}</Badge>
                        <span className="truncate">Related: {r.video.title}</span>
                        <span className="ml-auto text-xs text-muted-foreground shrink-0">{r.video.channel.name}</span>
                      </button>
                    ) : (
                      <div className="flex items-center gap-2 text-sm text-muted-foreground px-2 py-1">
                        <Badge variant="outline" className="text-[10px] py-0 shrink-0">{r.relationType}</Badge>
                        <span>Related video unavailable</span>
                      </div>
                    )}
                  </li>
                ))}
              </ul>
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

/**
 * §45 — Live Q&A list. A minimal panel: shows up to 5 questions with
 * upvote buttons, plus an input to submit a new question. Used inside the
 * WatchView's "Live Q&A" card when the video is heuristically a live stream.
 */
function LiveQAList({
  videoId,
  bid,
  entries,
  refetch,
}: {
  videoId: string;
  bid: string;
  entries?: QAItem[];
  refetch: () => void;
}) {
  const [text, setText] = useState("");
  const [submitting, setSubmitting] = useState(false);

  const submit = async () => {
    if (!text.trim() || !bid) return;
    setSubmitting(true);
    try {
      const res = await fetch(`/api/videos/${videoId}/qa`, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ askerName: "You", question: text.trim() }),
      });
      if (!res.ok) throw new Error("failed");
      setText("");
      refetch();
      toast.success("Question submitted");
    } catch {
      toast.error("Could not submit question");
    } finally {
      setSubmitting(false);
    }
  };

  const upvote = async (qaId: string) => {
    try {
      await fetch(`/api/videos/${videoId}/qa`, {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ qaId, action: "upvote" }),
      });
      refetch();
    } catch {
      toast.error("Upvote failed");
    }
  };

  return (
    <div className="space-y-2 text-xs">
      <ul className="space-y-2">
        {entries && entries.length > 0 ? (
          entries.slice(0, 5).map((e) => (
            <li key={e.id} className="rounded-md border border-border/60 bg-background/40 p-2">
              <div className="flex items-start gap-1.5">
                <button
                  onClick={() => upvote(e.id)}
                  className="shrink-0 mt-0.5 flex flex-col items-center text-muted-foreground hover:text-foreground"
                  aria-label="Upvote question"
                >
                  <ThumbsUp className="h-3.5 w-3.5" />
                  <span className="text-[10px] tabular-nums">{e.upvotes}</span>
                </button>
                <div className="min-w-0 flex-1">
                  <p className="font-medium text-foreground">{e.question}</p>
                  <p className="text-muted-foreground text-[10px]">— {e.askerName}</p>
                  {e.answer && (
                    <p className="mt-1 rounded bg-gold/10 border border-gold/30 px-1.5 py-1 text-foreground">
                      <span className="text-[10px] text-muted-foreground">answer: </span>{e.answer}
                    </p>
                  )}
                </div>
              </div>
            </li>
          ))
        ) : (
          <li className="text-muted-foreground">No questions yet.</li>
        )}
      </ul>
      <div className="flex gap-1.5">
        <input
          value={text}
          onChange={(e) => setText(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === "Enter" && !e.shiftKey) {
              e.preventDefault();
              submit();
            }
          }}
          placeholder="Ask a question..."
          aria-label="Ask a question"
          className="flex-1 bg-transparent border-b border-border pb-1 text-xs focus:outline-none focus:border-foreground transition-colors"
        />
        <Button
          size="sm"
          className="rounded-full h-7 px-3 text-xs bg-primary text-primary-foreground hover:bg-primary/90"
          onClick={submit}
          disabled={submitting || !text.trim() || !bid}
        >
          Ask
        </Button>
      </div>
    </div>
  );
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
  // §20-21 — quality signals score for the small badge in the comments
  // header area. Fetched once per video; non-blocking (no spinner shown
  // while loading — the badge just appears when the data arrives).
  const { data: qualityData } = useQuery({
    queryKey: ["quality-signals", videoId],
    queryFn: () => fetchQualitySignals(videoId),
    enabled: !!videoId,
    staleTime: 60_000,
  });
  const qualityScore = qualityData?.qualityScore;
  const qualityBadgeClass =
    typeof qualityScore === "number"
      ? qualityScore >= 80
        ? "bg-emerald-500/15 text-emerald-600 border-emerald-500/30"
        : qualityScore >= 50
          ? "bg-amber-500/15 text-amber-600 border-amber-500/30"
          : "bg-rose/15 text-rose border-rose/30"
      : "";

  const [text, setText] = useState("");
  const [posting, setPosting] = useState(false);
  // §22 — comment sort options: top, newest, creator_replies, questions, unanswered, most_discussed.
  const [commentSort, setCommentSort] = useState<"top" | "newest" | "creator_replies" | "questions" | "unanswered" | "most_discussed">("top");
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

  // §22 — client-side sort using the enriched fields from the API
  // (isQuestion, hasCreatorReply, replyCount, pinned).
  const sorted = [...(comments || [])].sort((a: any, b: any) => {
    switch (commentSort) {
      case "newest":
        return (b.createdAt || "").localeCompare(a.createdAt || "");
      case "creator_replies":
        if (a.hasCreatorReply && !b.hasCreatorReply) return -1;
        if (!a.hasCreatorReply && b.hasCreatorReply) return 1;
        return b.likes - a.likes;
      case "questions":
        if (a.isQuestion && !b.isQuestion) return -1;
        if (!a.isQuestion && b.isQuestion) return 1;
        return b.likes - a.likes;
      case "unanswered": {
        const aU = a.isQuestion && (a.replyCount || 0) === 0;
        const bU = b.isQuestion && (b.replyCount || 0) === 0;
        if (aU && !bU) return -1;
        if (!aU && bU) return 1;
        if (a.isQuestion && !b.isQuestion) return -1;
        if (!a.isQuestion && b.isQuestion) return 1;
        return b.likes - a.likes;
      }
      case "most_discussed":
        return (b.replyCount || 0) - (a.replyCount || 0);
      case "top":
      default:
        // Pinned first, then by likes.
        if (a.pinned && !b.pinned) return -1;
        if (!a.pinned && b.pinned) return 1;
        return b.likes - a.likes;
    }
  });

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
        {/* §20-21 — small quality-signal badge next to the comment count.
            Colored by score: green ≥80, yellow 50-79, red <50. */}
        {typeof qualityScore === "number" && (
          <Badge
            variant="outline"
            className={`rounded-full px-2 py-0.5 text-xs ${qualityBadgeClass}`}
            title={`Quality score: ${qualityScore}/100 — based on like ratio + user feedback signals`}
          >
            Quality: {qualityScore}
          </Badge>
        )}
        {/* §22 — comment sort dropdown with 6 deterministic options */}
        <div className="flex items-center gap-1.5">
          <span className="text-sm text-muted-foreground">Sort by:</span>
          <select
            value={commentSort}
            onChange={(e) => setCommentSort(e.target.value as any)}
            className="text-sm bg-transparent border-none hover:text-foreground cursor-pointer focus:outline-none focus:ring-0"
            aria-label="Sort comments by"
          >
            <option value="top">Top comments</option>
            <option value="newest">Newest first</option>
            <option value="creator_replies">Creator replies</option>
            <option value="questions">Questions</option>
            <option value="unanswered">Unanswered</option>
            <option value="most_discussed">Most discussed</option>
          </select>
        </div>
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
            aria-label="Add a comment"
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

      {/* List — bounded with max-height + overflow to prevent unbounded pages (UI audit) */}
      <div className="space-y-5 max-h-[600px] overflow-y-auto custom-scroll pr-1">
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
                    aria-label={`Reply to ${c.author}`}
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

/**
 * DisputeForm — inline form for filing a rights-claim dispute (§24 appeal
 * workflow). Renders a reason textarea (required) + evidence textarea
 * (optional) + Submit/Cancel buttons. On submit, calls onSubmit with the
 * trimmed reason + evidence; the parent decides the network call.
 *
 * Compact, self-contained, and accessible (labels associated via htmlFor).
 */
interface DisputeFormProps {
  claimId: string;
  submitting: boolean;
  onCancel: () => void;
  onSubmit: (payload: { reason: string; evidence: string }) => void;
}

function DisputeForm({ claimId, submitting, onCancel, onSubmit }: DisputeFormProps) {
  const [reason, setReason] = useState("");
  const [evidence, setEvidence] = useState("");

  const reasonId = `dispute-reason-${claimId}`;
  const evidenceId = `dispute-evidence-${claimId}`;

  const submit = () => {
    if (!reason.trim()) return;
    onSubmit({ reason: reason.trim(), evidence: evidence.trim() });
  };

  return (
    <div className="mt-2 rounded-md border border-rose/30 bg-rose/5 p-2.5 space-y-2">
      <div>
        <label
          htmlFor={reasonId}
          className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide"
        >
          Reason for dispute (required)
        </label>
        <Textarea
          id={reasonId}
          value={reason}
          onChange={(e) => setReason(e.target.value.slice(0, 1000))}
          rows={2}
          maxLength={1000}
          placeholder="Explain why you believe this claim is incorrect or fair use…"
          className="mt-1 text-xs resize-none"
        />
      </div>
      <div>
        <label
          htmlFor={evidenceId}
          className="text-[10px] font-medium text-muted-foreground uppercase tracking-wide"
        >
          Evidence (optional)
        </label>
        <Textarea
          id={evidenceId}
          value={evidence}
          onChange={(e) => setEvidence(e.target.value.slice(0, 2000))}
          rows={2}
          maxLength={2000}
          placeholder="Links, licenses, documentation that supports your dispute…"
          className="mt-1 text-xs resize-none"
        />
      </div>
      <div className="flex justify-end gap-2">
        <Button
          variant="ghost"
          size="sm"
          className="h-7 px-2 text-xs rounded-full"
          onClick={onCancel}
          disabled={submitting}
        >
          Cancel
        </Button>
        <Button
          size="sm"
          className="h-7 px-3 text-xs rounded-full bg-rose text-white hover:bg-rose/90"
          onClick={submit}
          disabled={submitting || !reason.trim()}
        >
          {submitting ? (
            <>
              <Loader2 className="h-3 w-3 mr-1 animate-spin" />
              Filing…
            </>
          ) : (
            <>
              <Scale className="h-3 w-3 mr-1" />
              Submit dispute
            </>
          )}
        </Button>
      </div>
    </div>
  );
}
