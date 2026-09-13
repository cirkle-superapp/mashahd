/**
 * DeliveryDecisionRecord — explains WHY a delivery decision was made.
 *
 * Implements v4 sections:
 *   S168: Algorithm explainability
 *   S169: Delivery decision record (diagnostic JSON)
 *
 * Every delivery decision can be traced back to its reason codes,
 * source scores, and the context that led to the choice.
 */

import type { SourceScore, DeliveryDecision, PlaybackContext } from "./delivery-scheduler";
import type { MediaState, OriginState, P2PState } from "./placement-engine";

export interface DeliveryDecisionRecord {
  timestamp: string;
  object: {
    videoId: string;
    renditionId: string;
    segmentIndex: number;
    swarmId: string;
  };
  decision: DeliveryDecision;
  alternatives: Array<{
    source: string;
    score: number;
    effectiveValue: number;
    reason: string;
    rejected: boolean;
    rejectReason?: string;
  }>;
  context: {
    bufferSeconds: number;
    deadline: string;
    peerCount: number;
    mediaState: MediaState;
    originState: OriginState;
    p2pState: P2PState;
  };
  reasonCodes: string[];
  selectedSource: string;
  hedgeSource?: string;
}

/**
 * Build a decision record from the delivery scheduler's output.
 */
export function buildDecisionRecord(
  videoId: string,
  renditionId: string,
  segmentIndex: number,
  swarmId: string,
  scores: SourceScore[],
  decision: DeliveryDecision,
  ctx: PlaybackContext,
  economyState: { mediaState: MediaState; originState: OriginState; p2pState: P2PState },
  peerCount: number
): DeliveryDecisionRecord {
  const reasonCodes: string[] = [];

  // Explain why the primary source was chosen
  const selected = scores.find((s) => s.tier === decision.primary);
  if (selected) {
    reasonCodes.push(`PRIMARY=${selected.tier}: score=${selected.score.toFixed(2)}, value=${selected.effectiveValue.toFixed(2)}`);
  }

  // Explain why alternatives were rejected
  const alternatives = scores.map((s) => {
    const isRejected = s.tier !== decision.primary && s.tier !== decision.hedge;
    let rejectReason: string | undefined;
    if (isRejected) {
      if (s.score < 0.3) rejectReason = "low score";
      else if (selected?.effectiveValue !== undefined && s.effectiveValue < selected.effectiveValue) rejectReason = "lower effective value than primary";
      else rejectReason = "not selected by scheduler";
    }
    return {
      source: s.tier,
      score: s.score,
      effectiveValue: s.effectiveValue,
      reason: s.reason,
      rejected: isRejected,
      rejectReason,
    };
  });

  // Buffer-based reasoning
  if (ctx.bufferDepth < 5) reasonCodes.push(`CRITICAL_BUFFER: ${ctx.bufferDepth.toFixed(1)}s → reliability-first`);
  else if (ctx.bufferDepth < 10) reasonCodes.push(`LOW_BUFFER: ${ctx.bufferDepth.toFixed(1)}s → HTTP hedge enabled`);
  else if (ctx.bufferDepth >= 20) reasonCodes.push(`HEALTHY_BUFFER: ${ctx.bufferDepth.toFixed(1)}s → cost-optimized`);

  // Economy state reasoning
  if (economyState.originState !== "NORMAL") reasonCodes.push(`ORIGIN_STATE=${economyState.originState}`);
  if (economyState.p2pState === "UNSTABLE") reasonCodes.push("P2P_UNSTABLE: favoring HTTP/edge");
  if (economyState.p2pState === "NO_PEERS") reasonCodes.push("NO_PEERS: HTTP fallback only");
  if (economyState.mediaState === "SUPERHOT") reasonCodes.push("SUPERHOT: aggressive caching/replication recommended");

  // Hedge reasoning
  if (decision.hedge) {
    reasonCodes.push(`HEDGE=${decision.hedge}: parallel fallback enabled${decision.cancelAfter ? ` (cancel after ${decision.cancelAfter}ms)` : ""}`);
  }

  return {
    timestamp: new Date().toISOString(),
    object: { videoId, renditionId, segmentIndex, swarmId },
    decision,
    alternatives,
    context: {
      bufferSeconds: ctx.bufferDepth,
      deadline: ctx.bufferDepth < 5 ? "critical" : ctx.bufferDepth < 10 ? "low" : ctx.bufferDepth < 20 ? "moderate" : "healthy",
      peerCount,
      mediaState: economyState.mediaState,
      originState: economyState.originState,
      p2pState: economyState.p2pState,
    },
    reasonCodes,
    selectedSource: decision.primary,
    hedgeSource: decision.hedge,
  };
}
