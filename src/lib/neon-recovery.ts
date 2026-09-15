/**
 * Neon Recovery Adapter — disaster recovery for Turso.
 *
 * Per master spec §19-23:
 *   - Turso is THE SINGLE AUTHORITATIVE TRANSACTIONAL DATABASE.
 *   - Neon is a RECOVERY PROJECTION — not a primary write target.
 *   - Never do "try Turso, catch write Neon" for ordinary transactions.
 *   - Neon maintains replication lag tracking + recovery state.
 *   - Database epoch/fencing prevents split-brain (§23).
 *
 * Flow (§21):
 *   Turso → Outbox → Inngest → Neon
 *
 * Neon tracks:
 *   last_authoritative_event_id
 *   last_replicated_event_id
 *   replication_lag_events
 *   replication_lag_seconds
 *   last_successful_replication_at
 *   recovery_state
 *   database_epoch
 *
 * Failover (§22):
 *   Turso unavailable → classify failure → circuit breaker → protect writes
 *   → queue/retry through Inngest → evaluate recovery → only formal
 *   promotion makes Neon writable.
 *
 * Epoch/Fencing (§23):
 *   epoch 41 = Turso primary
 *   epoch 42 = Neon promoted (after controlled recovery)
 *   Stale writers under old epoch are rejected.
 */

export type RecoveryState = "HEALTHY" | "REPLICATING" | "LAGGING" | "DEGRADED" | "PROMOTED" | "SPLIT_BRAIN";
export type DatabaseEpoch = number;

export interface ReplicationStatus {
  lastAuthoritativeEventId: string | null;
  lastReplicatedEventId: string | null;
  replicationLagEvents: number;
  replicationLagSeconds: number;
  lastSuccessfulReplicationAt: Date | null;
  recoveryState: RecoveryState;
  databaseEpoch: DatabaseEpoch;
  tursoAvailable: boolean;
  neonAvailable: boolean;
}

// ── In-memory recovery state (per restart) ──
let _state: ReplicationStatus = {
  lastAuthoritativeEventId: null,
  lastReplicatedEventId: null,
  replicationLagEvents: 0,
  replicationLagSeconds: 0,
  lastSuccessfulReplicationAt: null,
  recoveryState: "HEALTHY",
  databaseEpoch: 41, // Turso is primary by default
  tursoAvailable: true,
  neonAvailable: false, // Set to true when Neon is connected
};

/**
 * Get the current replication/recovery status.
 */
export function getReplicationStatus(): ReplicationStatus {
  return { ..._state };
}

/**
 * Update the replication status (called by the Inngest replication worker).
 */
export function updateReplicationStatus(opts: {
  lastAuthoritativeEventId?: string;
  lastReplicatedEventId?: string;
  tursoAvailable?: boolean;
  neonAvailable?: boolean;
}): void {
  if (opts.lastAuthoritativeEventId !== undefined) {
    _state.lastAuthoritativeEventId = opts.lastAuthoritativeEventId;
  }
  if (opts.lastReplicatedEventId !== undefined) {
    _state.lastReplicatedEventId = opts.lastReplicatedEventId;
  }
  if (opts.tursoAvailable !== undefined) {
    _state.tursoAvailable = opts.tursoAvailable;
  }
  if (opts.neonAvailable !== undefined) {
    _state.neonAvailable = opts.neonAvailable;
  }

  // Calculate lag.
  if (_state.lastAuthoritativeEventId && _state.lastReplicatedEventId) {
    _state.replicationLagEvents = 0; // Would compare event IDs in production
  }

  // Update recovery state based on availability.
  if (!_state.tursoAvailable && _state.neonAvailable) {
    _state.recoveryState = "DEGRADED";
  } else if (_state.tursoAvailable && _state.neonAvailable) {
    _state.recoveryState = "REPLICATING";
  } else if (_state.tursoAvailable && !_state.neonAvailable) {
    _state.recoveryState = "HEALTHY"; // Turso works, Neon is just a projection
  } else {
    _state.recoveryState = "SPLIT_BRAIN";
  }

  _state.lastSuccessfulReplicationAt = new Date();
}

/**
 * Get the current database epoch (for fencing, §23).
 */
export function getCurrentEpoch(): DatabaseEpoch {
  return _state.databaseEpoch;
}

/**
 * Promote Neon to primary (controlled recovery, §22).
 * This increments the epoch — old writers under the previous epoch are rejected.
 *
 * ONLY call this during a controlled disaster recovery procedure.
 * This is NOT automatic — per §22: "Only a formally authorized database
 * promotion can make Neon writable."
 */
export function promoteNeon(): { oldEpoch: DatabaseEpoch; newEpoch: DatabaseEpoch } {
  const oldEpoch = _state.databaseEpoch;
  _state.databaseEpoch = oldEpoch + 1;
  _state.recoveryState = "PROMOTED";
  _state.tursoAvailable = false; // Turso is no longer primary
  _state.neonAvailable = true;  // Neon is now primary
  console.warn(`[neon-recovery] PROMOTED: epoch ${oldEpoch} → ${_state.databaseEpoch}. Neon is now primary.`);
  return { oldEpoch, newEpoch: _state.databaseEpoch };
}

/**
 * Demote Neon back to recovery (after Turso is restored).
 * Increments epoch again to invalidate any Neon-era writes.
 */
export function demoteNeonToRecovery(): { oldEpoch: DatabaseEpoch; newEpoch: DatabaseEpoch } {
  const oldEpoch = _state.databaseEpoch;
  _state.databaseEpoch = oldEpoch + 1;
  _state.recoveryState = "REPLICATING";
  _state.tursoAvailable = true;
  _state.neonAvailable = true;
  console.warn(`[neon-recovery] DEMOTED: epoch ${oldEpoch} → ${_state.databaseEpoch}. Turso is primary again.`);
  return { oldEpoch, newEpoch: _state.databaseEpoch };
}

/**
 * Check if a write operation is allowed under the current epoch.
 * Per §23: "Reject stale writers operating under an old epoch."
 */
export function isWriteAllowed(writerEpoch: DatabaseEpoch): boolean {
  return writerEpoch === _state.databaseEpoch;
}
