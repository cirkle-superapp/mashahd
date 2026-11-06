"use client";

import { useEffect, useState } from "react";
import { Users } from "lucide-react";

/**
 * CirclePulse — "N watching now" live indicator with a pulsing dot.
 * Adapted from CIRKLE's circle-pulse overlay. The viewer count is derived
 * from the video's total views and fluctuates gently to feel "live".
 */
export function CirclePulse({ videoId, baseViews }: { videoId: string; baseViews: number }) {
  // Derive a stable pseudo-random seed from the video id so the count is
  // consistent across renders of the same video.
  const seed = [...videoId].reduce((a, c) => a + c.charCodeAt(0), 0);
  const base = Math.max(3, Math.floor(baseViews / 1000) + (seed % 17));
  const [count, setCount] = useState(base);

  useEffect(() => {
    // Gentle fluctuation every 3.5s
    const id = setInterval(() => {
      setCount((c) => {
        const delta = Math.floor(Math.random() * 7) - 2; // -2..+4
        return Math.max(1, c + delta);
      });
    }, 3500);
    return () => clearInterval(id);
  }, []);

  return (
    <div className="inline-flex items-center gap-1.5 text-xs text-muted-foreground">
      <span className="relative inline-flex h-2 w-2">
        <span className="relative inline-flex h-2 w-2 rounded-full text-emerald-500 pulse-ring">
          <span className="relative inline-flex h-2 w-2 rounded-full bg-emerald-500" />
        </span>
      </span>
      <Users className="h-3.5 w-3.5" />
      <span className="tabular-nums">
        {count.toLocaleString()} watching now
      </span>
    </div>
  );
}
