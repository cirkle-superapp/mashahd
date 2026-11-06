"use client";

import dynamic from "next/dynamic";
import { Skeleton } from "@/components/ui/skeleton";

/**
 * MashahdPlayerLazy — code-splits the heavy HLS + P2P engine.
 *
 * `mashahd-player.tsx` eagerly imports `hls.js` (~150 KB) and
 * `p2p-media-loader-hlsjs` (~80 KB). Without this wrapper, every visitor —
 * including home-page visitors who never watch a video — would download
 * the entire media engine on the initial JS bundle.
 *
 * With `next/dynamic({ ssr: false })`, the player is loaded on-demand only
 * when the WatchView actually mounts, and only on the client.
 *
 * This is one of the UI-audit top-5 fixes: home visitors should not pay the
 * HLS+P2P bundle cost.
 */

// Re-export the props type so consumers don't need to import the heavy module.
export type MashahdPlayerProps = {
  src: string;
  poster?: string;
  videoId: string;
  manifestVersion?: string;
  swarmId?: string;
  autoPlay?: boolean;
  /** Optional start position (seconds). The player seeks here once metadata
   *  has loaded — used by the clip permalink page to deep-link to a segment. */
  startAt?: number;
  /** Optional end position (seconds). When the clip range ends, playback
   *  pauses + fires onEnded so the UI can show the up-next state. */
  endAt?: number;
  onPlay?: () => void;
  onPause?: () => void;
  onEnded?: () => void;
  onTimeUpdate?: (t: number) => void;
  children?: React.ReactNode;
};

const MashahdPlayerInner = dynamic(
  () => import("./mashahd-player").then((m) => m.MashahdPlayer),
  {
    ssr: false,
    loading: () => (
      <div className="relative aspect-video w-full overflow-hidden rounded-2xl bg-black">
        <Skeleton className="absolute inset-0" />
        <div className="absolute inset-0 flex items-center justify-center">
          <div className="text-sm text-muted-foreground">Loading player…</div>
        </div>
      </div>
    ),
  }
);

export function MashahdPlayerLazy(props: MashahdPlayerProps) {
  return <MashahdPlayerInner {...props} />;
}
