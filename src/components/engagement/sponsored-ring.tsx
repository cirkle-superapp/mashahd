"use client";

import { useEffect, useState } from "react";
import { X, ExternalLink } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

/**
 * SponsoredRing — ambient branded glow AROUND the video player (Pass 102).
 *
 * THE UNIQUE AD FORMAT NO COMPETITOR HAS:
 *   YouTube/Twitch/TikTok all use interruptive pre-roll/mid-roll ads that
 *   block content. Mashahd's SponsoredRing is the OPPOSITE: the sponsor
 *   literally "lights up" the viewing experience with a soft brand-colored
 *   glow ring around the player. It's:
 *     - Non-interruptive (never blocks content)
 *     - Ambient (blends into the cinematic experience — ties to our
 *       Ambient Mode feature which already projects color glows)
 *     - Tappable (click to expand a brand card with CTA)
 *     - Clearly disclosed ("Sponsored" label — legal compliance)
 *     - Creator-friendly (sponsor revenue shares with the creator)
 *
 * Placement: wraps the MashahdPlayer in the watch view. The ring sits
 * OUTSIDE the video frame (padding around the player), so it never
 * overlaps content. On hover, it brightens; on click, it opens a
 * dismissible brand card overlay.
 *
 * Identity: the ring echoes Mashahd's circular/CIRKLE (دواير) brand
 * motif — the same geometry used in the logo, mood rings, and the
 * AdLotus mandala. It's not just an ad; it's a brand-native surface.
 */
interface SponsoredRingProps {
  videoId?: string;
}

interface RingAd {
  id: string;
  advertiser: string;
  brandColor: string;
  headline: string;
  cta: string;
  targetUrl: string;
  disclosure: string;
}

export function SponsoredRing({ videoId }: SponsoredRingProps) {
  const [expanded, setExpanded] = useState(false);
  const [dismissed, setDismissed] = useState(false);

  const { data } = useQuery<{ rings: RingAd[] }>({
    queryKey: ["sponsored-ring", videoId],
    queryFn: async () => {
      const res = await fetch("/api/ads?format=rings");
      if (!res.ok) return { rings: [] };
      return res.json();
    },
    staleTime: 5 * 60 * 1000, // 5 min — ad inventory is semi-static
  });

  const ad = data?.rings?.[0];

  // Respect user's dismiss for the session.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const key = `mashahd-ring-dismissed-${ad?.id}`;
    // eslint-disable-next-line react-hooks/set-state-in-effect
    if (sessionStorage.getItem(key)) setDismissed(true);
  }, [ad?.id]);

  if (!ad || dismissed) return null;

  const dismiss = () => {
    setDismissed(true);
    setExpanded(false);
    try { sessionStorage.setItem(`mashahd-ring-dismissed-${ad.id}`, "1"); } catch { /* ignore */ }
  };

  return (
    <>
      {/* The ring wrapper — sits OUTSIDE the video frame via padding.
          The glow uses the sponsor's brand color, projected inward. */}
      <div
        className="relative -m-1 rounded-xl overflow-visible"
        style={{
          // Brand-colored ambient glow — same technique as Ambient Mode,
          // but driven by the SPONSOR's color instead of the video frame.
          background: `radial-gradient(circle at 50% 50%, ${ad.brandColor}22 0%, transparent 70%)`,
        }}
      >
        {/* The actual ring border — subtle, pulsing, brand-colored */}
        <button
          onClick={() => setExpanded(true)}
          className="absolute -inset-0.5 rounded-xl pointer-events-auto ring-1 transition-all hover:ring-2"
          style={{
            // Conic gradient ring — rotates the brand color around the player
            boxShadow: `0 0 0 1px ${ad.brandColor}33, 0 0 24px -4px ${ad.brandColor}55`,
            "--tw-ring-color": `${ad.brandColor}40`,
          } as React.CSSProperties}
          aria-label={`Sponsored by ${ad.advertiser} — click to learn more`}
        >
          {/* Sponsored label — top-right corner, always visible */}
          <span className="absolute top-1.5 right-2 z-10 px-2 py-0.5 rounded-full bg-black/60 backdrop-blur text-white text-[9px] font-medium border border-white/15">
            <span className="text-gold-light">Sponsored</span> · {ad.advertiser}
          </span>
        </button>
      </div>

      {/* Expanded brand card — dismissible overlay */}
      {expanded && (
        <div
          className="fixed inset-0 z-[80] bg-black/60 backdrop-blur-sm grid place-items-center p-4"
          onClick={(e) => { if (e.target === e.currentTarget) setExpanded(false); }}
        >
          <div className="glass-strong rounded-2xl p-6 max-w-md w-full border border-white/15 shadow-glow animate-fade-up">
            <div className="flex items-start justify-between mb-3">
              <div className="flex items-center gap-3">
                <div
                  className="h-12 w-12 rounded-xl grid place-items-center text-white font-bold text-lg"
                  style={{ background: ad.brandColor }}
                >
                  {ad.advertiser.charAt(0)}
                </div>
                <div>
                  <div className="text-white font-semibold text-sm">{ad.advertiser}</div>
                  <div className="text-white/50 text-[10px]">{ad.disclosure}</div>
                </div>
              </div>
              <button onClick={() => setExpanded(false)} aria-label="Close" className="text-white/60 hover:text-white p-1">
                <X className="h-4 w-4" />
              </button>
            </div>
            <h3 className="text-white text-lg font-semibold mb-2">{ad.headline}</h3>
            <p className="text-white/70 text-sm mb-4">
              This content is supported by {ad.advertiser}. Your engagement
                helps sustain the creator.
            </p>
            <div className="flex items-center gap-2">
              <a
                href={ad.targetUrl}
                target="_blank"
                rel="noopener noreferrer"
                className="flex-1 inline-flex items-center justify-center gap-1.5 px-4 py-2.5 rounded-xl text-white text-sm font-medium transition-transform hover:scale-[1.02]"
                style={{ background: ad.brandColor }}
              >
                {ad.cta} <ExternalLink className="h-3.5 w-3.5" />
              </a>
              <button
                onClick={dismiss}
                className="px-4 py-2.5 rounded-xl text-white/70 hover:text-white text-sm border border-white/15 hover:border-white/30 transition-colors"
              >
                Dismiss
              </button>
            </div>
          </div>
        </div>
      )}
    </>
  );
}
