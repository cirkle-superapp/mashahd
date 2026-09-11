"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * MashahdMark — animated brand mark.
 *
 * Animation language adapted from CIRKLE (دواير), which uses three layered
 * motions on its CircleMark:
 *
 *   1. **Draw-in** — each of the three circles strokes itself in using
 *      `pathLength: [0, 1]`, staggered 0s / 0.4s / 0.8s so the mark
 *      assembles like a Venn diagram being drawn by hand. (from circle-aura)
 *   2. **Pulsing core** — the center node breathes (`scale` + `opacity`)
 *      on a 1.6s loop so the mark never looks frozen. (from circle-aura)
 *   3. **Slow rotation** — the whole SVG rotates 360° over 30s, linear,
 *      giving the "cirkle" turning motion. (from circle-mark base)
 *
 * On top of those, the parent wrapper does a gentle "breathing" scale +
 * tilt over 8s (from CIRKLE's onboarding) so the mark has presence even
 * when sitting still.
 *
 * Props:
 *   size      — pixel size of the square mark
 *   animated  — if false, renders a static mark (favicons, SSR-safe spots)
 *   className  — extra classes on the wrapping element
 *   full      — if true, all three animations run (default). If false,
 *               only the slow rotation runs (for tiny sizes where
 *               draw-in would be invisible).
 */
export function MashahdMark({
  size = 32,
  animated = true,
  full = true,
  className,
}: {
  size?: number;
  animated?: boolean;
  full?: boolean;
  className?: string;
}) {
  if (!animated) {
    return (
      <svg
        width={size}
        height={size}
        viewBox="0 0 100 100"
        fill="none"
        role="img"
        aria-label="Mashahd logo"
        className={className}
      >
        <defs>
          <linearGradient id="mashahd-grad-static" x1="0" y1="0" x2="1" y2="1">
            <stop offset="0%" stopColor="hsl(var(--gold-light))" />
            <stop offset="45%" stopColor="hsl(var(--gold))" />
            <stop offset="75%" stopColor="hsl(var(--rose))" />
            <stop offset="100%" stopColor="hsl(var(--teal-light))" />
          </linearGradient>
        </defs>
        <StaticCircles gradientId="mashahd-grad-static" />
      </svg>
    );
  }

  // The rotation layer — always on when animated.
  const RotateLayer = (
    <motion.svg
      width={size}
      height={size}
      viewBox="0 0 100 100"
      fill="none"
      role="img"
      aria-label="Mashahd logo"
      animate={{ rotate: 360 }}
      transition={{ duration: 30, repeat: Infinity, ease: "linear" }}
    >
      <defs>
        <linearGradient id="mashahd-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--gold-light))" />
          <stop offset="45%" stopColor="hsl(var(--gold))" />
          <stop offset="75%" stopColor="hsl(var(--rose))" />
          <stop offset="100%" stopColor="hsl(var(--teal-light))" />
        </linearGradient>
        <radialGradient id="mashahd-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="hsl(var(--gold-light))" />
          <stop offset="100%" stopColor="hsl(var(--gold-dark))" />
        </radialGradient>
      </defs>

      {full ? (
        <>
          {/* Three circles that draw themselves in, staggered. */}
          <motion.circle
            cx="50"
            cy="32"
            r="22"
            stroke="url(#mashahd-grad)"
            strokeWidth="3.5"
            opacity="0.95"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: [0, 1, 1] }}
            transition={{
              duration: 4.8,
              times: [0, 0.55, 1],
              repeat: Infinity,
              ease: "easeInOut",
              delay: 0,
            }}
          />
          <motion.circle
            cx="32"
            cy="60"
            r="22"
            stroke="url(#mashahd-grad)"
            strokeWidth="3.5"
            opacity="0.95"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: [0, 1, 1] }}
            transition={{
              duration: 4.8,
              times: [0, 0.55, 1],
              repeat: Infinity,
              ease: "easeInOut",
              delay: 0.4,
            }}
          />
          <motion.circle
            cx="68"
            cy="60"
            r="22"
            stroke="url(#mashahd-grad)"
            strokeWidth="3.5"
            opacity="0.95"
            initial={{ pathLength: 0 }}
            animate={{ pathLength: [0, 1, 1] }}
            transition={{
              duration: 4.8,
              times: [0, 0.55, 1],
              repeat: Infinity,
              ease: "easeInOut",
              delay: 0.8,
            }}
          />
          {/* Pulsing center node — breathes so the mark never looks dead. */}
          <motion.circle
            cx="50"
            cy="50.5"
            r="6.5"
            fill="url(#mashahd-core)"
            animate={{ scale: [1, 1.4, 1], opacity: [0.7, 1, 0.7] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
            style={{ transformOrigin: "50px 50.5px" }}
          />
          <motion.circle
            cx="50"
            cy="50.5"
            r="2.2"
            fill="hsl(var(--cream))"
            animate={{ opacity: [0.85, 0.5, 0.85] }}
            transition={{ duration: 1.6, repeat: Infinity, ease: "easeInOut" }}
          />
        </>
      ) : (
        <StaticCircles gradientId="mashahd-grad" />
      )}
    </motion.svg>
  );

  // The breathing wrapper — gentle scale + tilt (from CIRKLE onboarding).
  // Only applied when `full` so tiny marks in tight chrome don't wobble.
  if (!full) {
    return <span className={cn("inline-block", className)}>{RotateLayer}</span>;
  }
  return (
    <motion.span
      className={cn("inline-block", className)}
      animate={{ scale: [1, 1.04, 1], rotate: [0, 4, 0] }}
      transition={{ duration: 8, repeat: Infinity, ease: "easeInOut" }}
    >
      {RotateLayer}
    </motion.span>
  );
}

/** Static (non-animated) three-circle set, used for tiny marks and SSR. */
function StaticCircles({ gradientId }: { gradientId: string }) {
  return (
    <>
      <circle cx="50" cy="32" r="22" stroke={`url(#${gradientId})`} strokeWidth="3.5" opacity="0.95" />
      <circle cx="32" cy="60" r="22" stroke={`url(#${gradientId})`} strokeWidth="3.5" opacity="0.95" />
      <circle cx="68" cy="60" r="22" stroke={`url(#${gradientId})`} strokeWidth="3.5" opacity="0.95" />
      <circle cx="50" cy="50.5" r="6.5" fill={`url(#${gradientId})`} />
      <circle cx="50" cy="50.5" r="2.2" fill="hsl(var(--cream))" opacity="0.85" />
    </>
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
      <MashahdMark size={size} animated={animated} full={size >= 28} />
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
