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
 *   size      — pixel size of the square mark
 *   animated  — if false, renders a static mark (favicons, SSR-safe spots)
 *   className  — extra classes on the wrapping element
 */
export function MashahdMark({
  size = 32,
  animated = true,
  className,
}: {
  size?: number;
  animated?: boolean;
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
        <linearGradient id="mashahd-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--gold-light))" />
          <stop offset="50%" stopColor="hsl(var(--rose))" />
          <stop offset="100%" stopColor="hsl(var(--teal-light))" />
        </linearGradient>
      </defs>
      {/* Three interlocking circles forming a triangle (Venn-like). */}
      <circle
        cx="50"
        cy="32"
        r="22"
        stroke="url(#mashahd-grad)"
        strokeWidth="1.5"
        opacity="0.9"
      />
      <circle
        cx="32"
        cy="60"
        r="22"
        stroke="url(#mashahd-grad)"
        strokeWidth="1.5"
        opacity="0.9"
      />
      <circle
        cx="68"
        cy="60"
        r="22"
        stroke="url(#mashahd-grad)"
        strokeWidth="1.5"
        opacity="0.9"
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
