"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * MashahdMark — animated brand mark.
 *
 * Matches CIRKLE's CircleMark (دواير) exactly: three interlocking circles
 * arranged in a triangle, thin gold→rose→teal gradient stroke, a solid
 * gradient center dot, and ONE animation — a slow continuous 30-second
 * rotation. No draw-in, no breathing, no pulsing — just the rotation.
 *
 * The geometry (viewBox 0 0 100 100) and stroke widths mirror CIRKLE's
 * `src/components/brand/circle-mark.tsx`.
 *
 * Props:
 *   size        — pixel size of the square mark
 *   animated    — if false, renders a static mark (favicons, SSR-safe spots)
 *   strokeWidth — SVG stroke width in viewBox units (default 1.5, mirrors
 *                 CIRKLE's CircleMark). Pass 3-4 for small display contexts
 *                 (modal logos, favicons) so the gradient stays visible at
 *                 sub-pixel rendering. CIRKLE's default size of 40px with
 *                 stroke 1.5 → 0.6px effective stroke, which is borderline
 *                 invisible; pass strokeWidth={3} for any size <= 56px.
 *   className    — extra classes on the wrapping element
 */
export function MashahdMark({
  size = 32,
  animated = true,
  strokeWidth = 1.5,
  className,
}: {
  size?: number;
  animated?: boolean;
  strokeWidth?: number;
  className?: string;
}) {
  const Wrap = animated ? motion.svg : "svg";
  const animProps = animated
    ? {
        animate: { rotate: 360 },
        transition: {
          duration: 30,
          repeat: Infinity,
          ease: "linear" as const,
        },
      }
    : {};

  return (
    <Wrap
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role="img"
      aria-label="Mashahd logo"
      className={className}
      {...(animProps as Record<string, unknown>)}
    >
      <defs>
        {/* Gradient stops mirror CIRKLE's CircleMark exactly: gold → rose → teal.
            We use the saturated base tokens (--gold, --teal) rather than the
            -light variants, so the brand mark reads at small sizes (28-32px)
            and stays visually identical to the CIRKLE super-app mark.

            VERTICAL gradient with gradientUnits="userSpaceOnUse" (Pass 83 fix):
            The 3 circles are clustered around the vertical middle of the
            viewBox (top circle y=10-54, bottom circles y=38-82). A diagonal
            gradient (0,0 → 100,100) maps all 3 circles to the gradient's
            middle (rose), making the mark look uniformly dusty rose.
            A VERTICAL gradient (0,0 → 0,100) puts the top circle in the
            gold→rose band and the bottom circles in the rose→teal band,
            so each circle shows a distinct color shift and the overall
            mark reads as a true gold→rose→teal gradient. */}
        <linearGradient
          id="mashahd-grad"
          x1="0"
          y1="0"
          x2="0"
          y2="100"
          gradientUnits="userSpaceOnUse"
        >
          <stop offset="0%" stopColor="hsl(var(--gold))" />
          <stop offset="50%" stopColor="hsl(var(--rose))" />
          <stop offset="100%" stopColor="hsl(var(--teal))" />
        </linearGradient>
      </defs>
      {/* Three interlocking circles forming a triangle (Venn-like).
          strokeWidth is configurable so modal/hero contexts (small render
          size) can pass a thicker stroke to keep the gradient visible.
          opacity=1 (full) — Pass 83 fix: was 0.9 which dropped saturation
          enough that the gradient read as washed-out grey/cream on the
          modal's glass-strong background. */}
      <circle
        cx="50"
        cy="32"
        r="22"
        stroke="url(#mashahd-grad)"
        strokeWidth={strokeWidth}
        opacity="1"
      />
      <circle
        cx="32"
        cy="60"
        r="22"
        stroke="url(#mashahd-grad)"
        strokeWidth={strokeWidth}
        opacity="1"
      />
      <circle
        cx="68"
        cy="60"
        r="22"
        stroke="url(#mashahd-grad)"
        strokeWidth={strokeWidth}
        opacity="1"
      />
      {/* Center node — the meeting point of the three circles. */}
      <circle cx="50" cy="50" r="6" fill="url(#mashahd-grad)" />
    </Wrap>
  );
}

/**
 * Full lockup: animated mark + "Mashahd" wordmark with the Arabic
 * "مشاهِد" set underneath in muted gold.
 */
export function MashahdLogo({
  size = 30,
  showWordmark = true,
  animated = true,
  className,
  wordmarkClassName,
}: {
  size?: number;
  showWordmark?: boolean;
  animated?: boolean;
  className?: string;
  wordmarkClassName?: string;
}) {
  return (
    <span className={cn("inline-flex items-center gap-2", className)}>
      <MashahdMark size={size} animated={animated} />
      {showWordmark && (
        <span
          className={cn("flex flex-col leading-none", wordmarkClassName)}
        >
          <span className="font-semibold tracking-tight gradient-text-gold text-[1.05em]">
            Mashahd
          </span>
          <span
            className="text-[0.62em] text-muted-foreground -mt-0.5"
            style={{ direction: "rtl", fontFamily: "'Noto Kufi Arabic', system-ui, sans-serif" }}
            lang="ar"
          >
            مشاهِد
          </span>
        </span>
      )}
    </span>
  );
}
