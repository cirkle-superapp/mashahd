"use client";

import { BadgeCheck } from "lucide-react";
import { cn } from "@/lib/utils";

/**
 * Verified badge — gold ring checkmark for channels with >= 1M subscribers.
 * Visual language adapted from CIRKLE's CircleAvatar `verified` prop.
 */
export function VerifiedBadge({
  className,
  size = 14,
}: {
  className?: string;
  size?: number;
}) {
  return (
    <BadgeCheck
      className={cn("text-[hsl(var(--gold))]", className)}
      style={{ width: size, height: size }}
      aria-label="Verified"
    />
  );
}
