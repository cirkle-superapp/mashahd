/**
 * Outbox Processor — reads PENDING OutboxEvents from Turso and processes them.
 *
 * Per master spec §20-21:
 *   Turso → Outbox → Inngest → Neon (replication)
 *
 * This module runs on the self-hosted worker (or as an Inngest scheduled function).
 * It reads PENDING outbox events, marks them PROCESSING, triggers Inngest
 * workflows, and marks them PROCESSED on success.
 *
 * Per §30: every step is idempotent — safe to replay.
 * Per §37: bounded retries — max 5 attempts, then DEAD_LETTER.
 */

import { db } from "./db";
import { triggerJob } from "./inngest-jobs";

const MAX_ATTEMPTS = 5;
const BATCH_SIZE = 20;
const POLL_INTERVAL_MS = 10_000; // 10 seconds

let _pollTimer: ReturnType<typeof setInterval> | null = null;

/**
 * Process a batch of PENDING outbox events.
 * Returns the number of events processed.
 */
export async function processOutboxBatch(): Promise<number> {
  let processed = 0;

  try {
    // Find PENDING events (oldest first, limited batch).
    const events = await db.outboxEvent.findMany({
      where: { status: "PENDING" },
      orderBy: { createdAt: "asc" },
      take: BATCH_SIZE,
    });

    for (const event of (events as any[])) {
      const attemptCount = event.attemptCount || 0;

      // Check if max attempts exceeded → dead letter.
      if (attemptCount >= MAX_ATTEMPTS) {
        await db.outboxEvent.update({
          where: { id: event.id },
          data: { status: "DEAD_LETTER", lastError: "max attempts exceeded" },
        });
        console.warn(`[outbox] Event ${event.id} → DEAD_LETTER (max attempts)`);
        continue;
      }

      // Mark as PROCESSING.
      await db.outboxEvent.update({
        where: { id: event.id },
        data: { status: "PROCESSING", attemptCount: attemptCount + 1 },
      });

      try {
        // Trigger the appropriate Inngest workflow based on eventType.
        const inngestResult = await triggerJob({
          name: `mashahd/outbox/${event.eventType}`,
          data: {
            eventId: event.id,
            eventType: event.eventType,
            aggregateType: event.aggregateType,
            aggregateId: event.aggregateId,
            payload: JSON.parse(event.payload || "{}"),
            idempotencyKey: event.idempotencyKey,
            correlationId: event.correlationId,
            causationId: event.causationId,
          },
        });

        if (inngestResult.ok) {
          // Mark as PROCESSED.
          await db.outboxEvent.update({
            where: { id: event.id },
            data: { status: "PROCESSED", processedAt: new Date(), lastError: "" },
          });
          processed++;
          console.log(`[outbox] Event ${event.id} (${event.eventType}) → PROCESSED`);
        } else {
          // Inngest failed — mark as PENDING again for retry.
          await db.outboxEvent.update({
            where: { id: event.id },
            data: { status: "PENDING", lastError: inngestResult.error || "inngest trigger failed" },
          });
          console.warn(`[outbox] Event ${event.id} → PENDING (retry: ${inngestResult.error})`);
        }
      } catch (e) {
        // Processing failed — mark as PENDING for retry.
        await db.outboxEvent.update({
          where: { id: event.id },
          data: { status: "PENDING", lastError: String(e).slice(0, 500) },
        });
        console.warn(`[outbox] Event ${event.id} → PENDING (error: ${String(e).slice(0, 100)})`);
      }
    }
  } catch (e) {
    console.error("[outbox] Batch processing failed:", e);
  }

  return processed;
}

/**
 * Start the outbox processor on a polling interval.
 * Returns a cleanup function.
 */
export function startOutboxProcessor(): () => void {
  if (_pollTimer) return () => {};

  _pollTimer = setInterval(async () => {
    const count = await processOutboxBatch();
    if (count > 0) {
      console.log(`[outbox] Processed ${count} events`);
    }
  }, POLL_INTERVAL_MS);

  console.log(`[outbox] Processor running every ${POLL_INTERVAL_MS / 1000}s`);
  return () => {
    if (_pollTimer) {
      clearInterval(_pollTimer);
      _pollTimer = null;
    }
  };
}

/**
 * Get outbox stats for the cost dashboard.
 */
export async function getOutboxStats(): Promise<{
  pending: number;
  processing: number;
  processed: number;
  failed: number;
  deadLetter: number;
}> {
  try {
    const statuses = ["PENDING", "PROCESSING", "PROCESSED", "FAILED", "DEAD_LETTER"];
    const counts: Record<string, number> = {};
    for (const status of statuses) {
      const result = await db.outboxEvent.findMany({
        where: { status },
        select: { id: true },
      });
      counts[status] = (result as any[]).length;
    }
    return {
      pending: counts.PENDING || 0,
      processing: counts.PROCESSING || 0,
      processed: counts.PROCESSED || 0,
      failed: counts.FAILED || 0,
      deadLetter: counts.DEAD_LETTER || 0,
    };
  } catch {
    return { pending: 0, processing: 0, processed: 0, failed: 0, deadLetter: 0 };
  }
}
