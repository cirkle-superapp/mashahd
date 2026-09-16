/**
 * Failure Taxonomy — error classification for failover decisions.
 *
 * Per master spec §35: implement a standardized set of error types.
 * Failover decisions MUST be based on error classification.
 */

export type FailureType =
  | "VALIDATION_ERROR"
  | "AUTHENTICATION_ERROR"
  | "AUTHORIZATION_ERROR"
  | "NOT_FOUND"
  | "CONFLICT"
  | "RATE_LIMITED"
  | "DEPENDENCY_TIMEOUT"
  | "DEPENDENCY_UNAVAILABLE"
  | "DATABASE_UNAVAILABLE"
  | "DATABASE_QUOTA_EXCEEDED"
  | "STORAGE_QUOTA_EXCEEDED"
  | "EMAIL_QUOTA_EXCEEDED"
  | "SMS_AUTHORIZATION_FAILED"
  | "SMS_PAYMENT_REQUIRED"
  | "WORKFLOW_FAILURE"
  | "INTERNAL_ERROR"
  | "UNKNOWN_INFRASTRUCTURE_FAILURE";

export interface ClassifiedError {
  type: FailureType;
  retryable: boolean;
  statusCode: number;
  message: string;
  circuitBreakerName?: string; // which circuit breaker to trip
}

/**
 * Classify an error into the failure taxonomy.
 * Used by circuit breakers + retry logic to make failover decisions.
 */
export function classifyError(error: unknown): ClassifiedError {
  const msg = error instanceof Error ? error.message : String(error);
  const lowerMsg = msg.toLowerCase();

  // Database errors.
  if (lowerMsg.includes("database") || lowerMsg.includes("turso") || lowerMsg.includes("sqlite")) {
    if (lowerMsg.includes("quota") || lowerMsg.includes("limit")) {
      return { type: "DATABASE_QUOTA_EXCEEDED", retryable: false, statusCode: 503, message: msg, circuitBreakerName: "turso" };
    }
    if (lowerMsg.includes("timeout") || lowerMsg.includes("unreachable")) {
      return { type: "DATABASE_UNAVAILABLE", retryable: true, statusCode: 503, message: msg, circuitBreakerName: "turso" };
    }
    return { type: "DATABASE_UNAVAILABLE", retryable: true, statusCode: 503, message: msg, circuitBreakerName: "turso" };
  }

  // Storage errors.
  if (lowerMsg.includes("storage") || lowerMsg.includes("blob") || lowerMsg.includes("filebase")) {
    if (lowerMsg.includes("quota") || lowerMsg.includes("limit") || lowerMsg.includes("exceeded")) {
      return { type: "STORAGE_QUOTA_EXCEEDED", retryable: false, statusCode: 507, message: msg, circuitBreakerName: "storage" };
    }
    return { type: "DEPENDENCY_UNAVAILABLE", retryable: true, statusCode: 503, message: msg, circuitBreakerName: "storage" };
  }

  // Email errors.
  if (lowerMsg.includes("email") || lowerMsg.includes("brevo")) {
    if (lowerMsg.includes("quota") || lowerMsg.includes("429") || lowerMsg.includes("limit")) {
      return { type: "EMAIL_QUOTA_EXCEEDED", retryable: false, statusCode: 429, message: msg, circuitBreakerName: "brevo" };
    }
    return { type: "DEPENDENCY_TIMEOUT", retryable: true, statusCode: 504, message: msg, circuitBreakerName: "brevo" };
  }

  // SMS errors.
  if (lowerMsg.includes("sms") || lowerMsg.includes("phone")) {
    if (lowerMsg.includes("authorization") || lowerMsg.includes("consent")) {
      return { type: "SMS_AUTHORIZATION_FAILED", retryable: false, statusCode: 403, message: msg };
    }
    if (lowerMsg.includes("payment") || lowerMsg.includes("billing")) {
      return { type: "SMS_PAYMENT_REQUIRED", retryable: false, statusCode: 402, message: msg };
    }
    return { type: "DEPENDENCY_UNAVAILABLE", retryable: true, statusCode: 503, message: msg, circuitBreakerName: "sms" };
  }

  // Workflow errors.
  if (lowerMsg.includes("workflow") || lowerMsg.includes("inngest")) {
    return { type: "WORKFLOW_FAILURE", retryable: true, statusCode: 502, message: msg, circuitBreakerName: "inngest" };
  }

  // Rate limiting.
  if (lowerMsg.includes("rate") || lowerMsg.includes("429") || lowerMsg.includes("too many")) {
    return { type: "RATE_LIMITED", retryable: true, statusCode: 429, message: msg };
  }

  // Timeout.
  if (lowerMsg.includes("timeout") || lowerMsg.includes("timed out")) {
    return { type: "DEPENDENCY_TIMEOUT", retryable: true, statusCode: 504, message: msg };
  }

  // Auth errors.
  if (lowerMsg.includes("unauthorized") || lowerMsg.includes("401")) {
    return { type: "AUTHENTICATION_ERROR", retryable: false, statusCode: 401, message: msg };
  }
  if (lowerMsg.includes("forbidden") || lowerMsg.includes("403")) {
    return { type: "AUTHORIZATION_ERROR", retryable: false, statusCode: 403, message: msg };
  }

  // Not found.
  if (lowerMsg.includes("not found") || lowerMsg.includes("404")) {
    return { type: "NOT_FOUND", retryable: false, statusCode: 404, message: msg };
  }

  // Conflict.
  if (lowerMsg.includes("conflict") || lowerMsg.includes("409") || lowerMsg.includes("duplicate")) {
    return { type: "CONFLICT", retryable: false, statusCode: 409, message: msg };
  }

  // Validation.
  if (lowerMsg.includes("validation") || lowerMsg.includes("invalid") || lowerMsg.includes("400")) {
    return { type: "VALIDATION_ERROR", retryable: false, statusCode: 400, message: msg };
  }

  // Circuit breaker open.
  if (lowerMsg.includes("circuit") || lowerMsg.includes("CIRCUIT_OPEN")) {
    return { type: "DEPENDENCY_UNAVAILABLE", retryable: false, statusCode: 503, message: msg };
  }

  // Default.
  return { type: "UNKNOWN_INFRASTRUCTURE_FAILURE", retryable: false, statusCode: 500, message: msg };
}
