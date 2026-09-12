/**
 * RequestPriority + PriorityClasses for media object requests.
 *
 * Implements v4 section S94: Request priority classes.
 * The scheduler must respect these classes when ordering work.
 */

export type RequestPriority = "CRITICAL" | "HIGH" | "MEDIUM" | "LOW";

export interface PriorityClass {
  level: RequestPriority;
  description: string;
  maxLatency: number; // ms — how long to wait before using a faster source
  canHedge: boolean;
  canPrefetch: boolean;
}

export const PRIORITY_CLASSES: Record<RequestPriority, PriorityClass> = {
  CRITICAL: {
    level: "CRITICAL",
    description: "playback-immediate — the next segment to be consumed",
    maxLatency: 500, // 500ms — must be very fast
    canHedge: false, // no hedge — just use the fastest reliable source
    canPrefetch: false,
  },
  HIGH: {
    level: "HIGH",
    description: "near-future playback — 1-2 segments ahead",
    maxLatency: 2000, // 2s
    canHedge: true,
    canPrefetch: false,
  },
  MEDIUM: {
    level: "MEDIUM",
    description: "cooperative prefetch — 3-5 segments ahead",
    maxLatency: 5000, // 5s
    canHedge: true,
    canPrefetch: true,
  },
  LOW: {
    level: "LOW",
    description: "speculative future — 6+ segments ahead",
    maxLatency: 10000, // 10s
    canHedge: false, // don't waste bandwidth hedging speculative
    canPrefetch: true,
  },
};

/**
 * Determine the priority class for a segment request based on playback context.
 */
export function classifyRequest(
  segmentIndex: number,
  currentPlaybackSegment: number,
  bufferDepth: number,
  segmentDuration: number = 6
): RequestPriority {
  const segmentsAhead = segmentIndex - currentPlaybackSegment;

  if (segmentsAhead <= 1) return "CRITICAL";
  if (segmentsAhead <= 3) return "HIGH";
  if (segmentsAhead <= 6) return "MEDIUM";
  return "LOW";
}
