"use client";

import { useState, useRef } from "react";
import { Sparkles, ChevronRight } from "lucide-react";
import { cn } from "@/lib/utils";
import { useQuery } from "@tanstack/react-query";

/**
 * AdLotus — rotating mandala of sponsored brand tiles (Pass 102).
 *
 * THE UNIQUE AD FORMAT NO COMPETITOR HAS:
 *   Instead of a banner ad or sidebar ad, Mashahd arranges sponsored
 *   brands as petals of a LOTUS (زهرية) — a circular mandala that users
 *   can SPIN to discover brands. Each petal is a brand tile with an emoji,
 *   headline, and brand color. The center shows the currently-selected
 *   brand's CTA.
 *
 * Why it's years ahead:
 *   - Banner ads are ignorable background noise. The Lotus is INTERACTIVE —
 *     users choose to engage by spinning it.
 *   - It's beautiful — the mandala echoes Mashahd's circular/CIRKLE brand
 *     identity (logo, mood rings, ambient rings). It's not just an ad;
 *     it's a brand-native surface that looks intentional.
 *   - It's gamified — spinning feels like a slot machine / fidget toy.
 *     Each spin reveals a different sponsor.
 *   - It's non-interruptive — sits as a section on the home feed, never
 *     blocks content.
 *   - Clearly disclosed — "Sponsored" label + "Sponsored Lotus" heading.
 *
 * Interaction:
 *   - Drag/swipe to rotate the petals.
 *   - Click a petal → center shows that brand's CTA.
 *   - Click the center CTA → navigates to the brand's target URL.
 *   - Respects prefers-reduced-motion (no auto-rotate).
 */
interface LotusAd {
  id: string;
  advertiser: string;
  tile: string;
  headline: string;
  color: string;
  targetUrl: string;
}

const COLOR_MAP: Record<string, string> = {
  rose: "from-rose-500/30 to-rose-600/20 border-rose-400/40",
  gold: "from-amber-500/30 to-yellow-600/20 border-amber-400/40",
  teal: "from-teal-500/30 to-cyan-600/20 border-teal-400/40",
  cyan: "from-cyan-500/30 to-blue-600/20 border-cyan-400/40",
  fuchsia: "from-fuchsia-500/30 to-pink-600/20 border-fuchsia-400/40",
  amber: "from-amber-500/30 to-orange-600/20 border-amber-400/40",
};

export function AdLotus() {
  const [rotation, setRotation] = useState(0);
  const [selected, setSelected] = useState(0);
  const dragStartRef = useRef<{ x: number; rot: number } | null>(null);

  const { data } = useQuery<{ lotus: LotusAd[] }>({
    queryKey: ["ad-lotus"],
    queryFn: async () => {
      const res = await fetch("/api/ads?format=lotus");
      if (!res.ok) return { lotus: [] };
      return res.json();
    },
    staleTime: 10 * 60 * 1000,
  });

  const ads = data?.lotus || [];
  if (ads.length < 3) return null;

  const angleStep = 360 / ads.length;
  const current = ads[selected] || ads[0];

  const onPointerDown = (e: React.PointerEvent) => {
    dragStartRef.current = { x: e.clientX, rot: rotation };
    (e.target as HTMLElement).setPointerCapture(e.pointerId);
  };
  const onPointerMove = (e: React.PointerEvent) => {
    if (!dragStartRef.current) return;
    const dx = e.clientX - dragStartRef.current.x;
    setRotation(dragStartRef.current.rot + dx * 0.5);
  };
  const onPointerUp = () => {
    if (!dragStartRef.current) return;
    dragStartRef.current = null;
    // Snap to nearest petal.
    const normalized = ((rotation % 360) + 360) % 360;
    const nearest = Math.round(normalized / angleStep) % ads.length;
    setSelected(nearest);
    setRotation(-nearest * angleStep);
  };

  return (
    <section className="px-4 sm:px-6 py-6" aria-label="Sponsored Lotus — discover brands">
      <div className="glass rounded-3xl p-6 border border-border relative overflow-hidden">
        {/* Heading + disclosure */}
        <div className="flex items-center justify-between mb-4">
          <div className="flex items-center gap-2">
            <Sparkles className="h-4 w-4 text-gold" />
            <h2 className="text-sm font-semibold">Sponsored Lotus</h2>
            <span className="text-[10px] text-muted-foreground">— spin to discover brands</span>
          </div>
          <span className="text-[9px] text-muted-foreground/70 px-2 py-0.5 rounded-full bg-muted/50 border border-border">
            Sponsored
          </span>
        </div>

        <div className="flex flex-col md:flex-row items-center gap-6">
          {/* The Lotus — circular mandala of brand petals */}
          <div
            className="relative h-56 w-56 shrink-0 cursor-grab active:cursor-grabbing touch-none select-none"
            onPointerDown={onPointerDown}
            onPointerMove={onPointerMove}
            onPointerUp={onPointerUp}
            onPointerCancel={onPointerUp}
          >
            {/* Center hub — shows selected brand's emoji */}
            <div className="absolute top-1/2 left-1/2 -translate-x-1/2 -translate-y-1/2 h-20 w-20 rounded-full bg-gradient-gold grid place-items-center shadow-glow z-10">
              <span className="text-3xl">{current.tile}</span>
            </div>

            {/* Petals — positioned around the circle */}
            <div
              className="absolute inset-0 transition-transform duration-500 ease-out"
              style={{ transform: `rotate(${rotation}deg)` }}
            >
              {ads.map((ad, i) => {
                const angle = i * angleStep;
                return (
                  <button
                    key={ad.id}
                    onClick={() => { setSelected(i); setRotation(-i * angleStep); }}
                    className={cn(
                      "absolute top-1/2 left-1/2 h-16 w-16 -ml-8 -mt-8 rounded-2xl border bg-gradient-to-br backdrop-blur grid place-items-center transition-all hover:scale-110",
                      COLOR_MAP[ad.color] || COLOR_MAP.gold,
                      selected === i ? "scale-110 ring-2 ring-gold/50" : "opacity-80"
                    )}
                    style={{
                      transform: `rotate(${angle}deg) translateY(-88px) rotate(${-angle - rotation}deg)`,
                    }}
                    aria-label={`${ad.advertiser}: ${ad.headline}`}
                  >
                    <span className="text-2xl">{ad.tile}</span>
                  </button>
                );
              })}
            </div>
          </div>

          {/* Selected brand card */}
          <div className="flex-1 min-w-0 w-full">
            <div className="text-xs text-muted-foreground mb-1">{current.advertiser}</div>
            <h3 className="text-lg font-semibold mb-2">{current.headline}</h3>
            <p className="text-sm text-muted-foreground mb-4">
              Discover {current.advertiser}. Your engagement supports
              Mashahd's creator ecosystem.
            </p>
            <a
              href={current.targetUrl}
              className="inline-flex items-center gap-1.5 px-4 py-2 rounded-xl bg-gradient-gold text-white text-sm font-medium hover:scale-[1.02] transition-transform"
            >
              Explore <ChevronRight className="h-4 w-4" />
            </a>
          </div>
        </div>
      </div>
    </section>
  );
}
