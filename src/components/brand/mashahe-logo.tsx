"use client";

import { motion } from "framer-motion";
import { cn } from "@/lib/utils";

/**
 * MashaheLogo — animated brand mark.
 *
 * Adapted from CIRKLE's CircleMark (دواير): three interlocking circles
 * arranged in a triangle, with a gold→rose→teal gradient stroke and a
 * solid gold center node. The whole mark rotates slowly (30s linear) to
 * evoke the "cirkle" motion. A soft float is layered on top via the
 * `.animate-orb-float` class.
 *
 * Props:
 *   size      — pixel size of the square mark
 *   animated  — if false, renders a static mark (for favicons / SSR-safe spots)
 *   className  — extra classes on the wrapping element
 */
export function MashaheMark({
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
      aria-label="Mashahe logo"
      className={cn(animated && "animate-orb-float", className)}
      {...(animProps as Record<string, unknown>)}
    >
      <defs>
        <linearGradient id="mashahe-grad" x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="hsl(var(--gold-light))" />
          <stop offset="45%" stopColor="hsl(var(--gold))" />
          <stop offset="75%" stopColor="hsl(var(--rose))" />
          <stop offset="100%" stopColor="hsl(var(--teal-light))" />
        </linearGradient>
        <radialGradient id="mashahe-core" cx="0.5" cy="0.5" r="0.5">
          <stop offset="0%" stopColor="hsl(var(--gold-light))" />
          <stop offset="100%" stopColor="hsl(var(--gold-dark))" />
        </radialGradient>
      </defs>

      {/* Three interlocking circles forming a triangle (Venn-like). */}
      <circle
        cx="50"
        cy="32"
        r="22"
        stroke="url(#mashahe-grad)"
        strokeWidth="3.5"
        opacity="0.95"
      />
      <circle
        cx="32"
        cy="60"
        r="22"
        stroke="url(#mashahe-grad)"
        strokeWidth="3.5"
        opacity="0.95"
      />
      <circle
        cx="68"
        cy="60"
        r="22"
        stroke="url(#mashahe-grad)"
        strokeWidth="3.5"
        opacity="0.95"
      />
      {/* Center node — the meeting point of the three circles. */}
      <circle cx="50" cy="50.5" r="6.5" fill="url(#mashahe-core)" />
      <circle cx="50" cy="50.5" r="2.2" fill="hsl(var(--cream))" opacity="0.85" />
    </Wrap>
  );
}

/**
 * Full lockup: animated mark + "Mashahe" wordmark with the Arabic
 * "مشاهِد" set underneath in muted gold.
 */
export function MashaheLogo({
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
      <MashaheMark size={size} animated={animated} />
      {showWordmark && (
        <span
          className={cn(
            "flex flex-col leading-none",
            wordmarkClassName
          )}
        >
          <span className="font-semibold tracking-tight gradient-text-gold text-[1.05em]">
            Mashahe
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
