/**
 * Circuit Breaker — protects against cascading failures from external providers.
 *
 * Per master spec §36: Evaluate Turso, Neon, Vercel Blob, Inngest, Brevo,
 * SMS provider, external APIs with CLOSED/OPEN/HALF_OPEN states.
 *
 * Per §37: No infinite loops — every retry must have max attempts.
 */

export type CircuitState = "CLOSED" | "OPEN" | "HALF_OPEN";

interface CircuitConfig {
  failureThreshold: number; // failures before opening
  recoveryTimeoutMs: number; // time before half-open
  maxRetries: number; // max retry attempts
  retryDelayMs: number; // base delay between retries
  retryBackoffMultiplier: number; // exponential backoff
}

interface CircuitEntry {
  state: CircuitState;
  failureCount: number;
  lastFailureAt: number;
  openedAt: number | null;
}

const DEFAULT_CONFIG: CircuitConfig = {
  failureThreshold: 5,
  recoveryTimeoutMs: 60_000,
  maxRetries: 3,
  retryDelayMs: 1000,
  retryBackoffMultiplier: 2,
};

const _circuits = new Map<string, CircuitEntry>();

function getCircuit(name: string, config: CircuitConfig = DEFAULT_CONFIG): CircuitEntry {
  let circuit = _circuits.get(name);
  if (!circuit) {
    circuit = { state: "CLOSED", failureCount: 0, lastFailureAt: 0, openedAt: null };
    _circuits.set(name, circuit);
  }

  // Check if we should transition from OPEN → HALF_OPEN.
  if (circuit.state === "OPEN" && circuit.openedAt) {
    if (Date.now() - circuit.openedAt > config.recoveryTimeoutMs) {
      circuit.state = "HALF_OPEN";
    }
  }

  return circuit;
}

/**
 * Execute a function with circuit breaker protection.
 * If the circuit is OPEN, throws immediately without calling the function.
 * If the function fails, increments the failure count.
 * After threshold failures, opens the circuit.
 */
export async function withCircuitBreaker<T>(
  name: string,
  fn: () => Promise<T>,
  config?: Partial<CircuitConfig>
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  const circuit = getCircuit(name, cfg);

  if (circuit.state === "OPEN") {
    throw new Error(`CIRCUIT_OPEN: ${name} — failing fast (recovery in ${cfg.recoveryTimeoutMs}ms)`);
  }

  try {
    const result = await fn();

    // Success — reset failure count, close circuit if it was half-open.
    if (circuit.state === "HALF_OPEN") {
      circuit.state = "CLOSED";
      circuit.failureCount = 0;
      circuit.openedAt = null;
    }

    return result;
  } catch (e) {
    circuit.failureCount++;
    circuit.lastFailureAt = Date.now();

    if (circuit.failureCount >= cfg.failureThreshold) {
      circuit.state = "OPEN";
      circuit.openedAt = Date.now();
      console.warn(`[circuit-breaker] ${name} OPENED after ${circuit.failureCount} failures`);
    }

    throw e;
  }
}

/**
 * Execute a function with bounded retries (no infinite loops, per §37).
 * Uses exponential backoff with jitter.
 */
export async function withRetries<T>(
  fn: () => Promise<T>,
  config?: Partial<CircuitConfig>
): Promise<T> {
  const cfg = { ...DEFAULT_CONFIG, ...config };
  let lastError: Error | null = null;

  for (let attempt = 0; attempt <= cfg.maxRetries; attempt++) {
    try {
      return await fn();
    } catch (e) {
      lastError = e as Error;
      if (attempt < cfg.maxRetries) {
        // Exponential backoff with jitter (per §36).
        const delay = cfg.retryDelayMs * Math.pow(cfg.retryBackoffMultiplier, attempt);
        const jitter = Math.random() * 500; // 0-500ms random jitter
        await new Promise(resolve => setTimeout(resolve, delay + jitter));
      }
    }
  }

  throw lastError;
}

/**
 * Get the state of a circuit (for observability / §40).
 */
export function getCircuitState(name: string): { state: CircuitState; failureCount: number } {
  const circuit = _circuits.get(name);
  if (!circuit) return { state: "CLOSED", failureCount: 0 };
  return { state: circuit.state, failureCount: circuit.failureCount };
}

/**
 * Get all circuit states (for /api/metrics).
 */
export function getAllCircuitStates(): Record<string, { state: CircuitState; failureCount: number }> {
  const result: Record<string, { state: CircuitState; failureCount: number }> = {};
  for (const [name, circuit] of _circuits) {
    result[name] = { state: circuit.state, failureCount: circuit.failureCount };
  }
  return result;
}
