/**
 * Structured logger — JSON-formatted logs for production observability.
 *
 * Per MASTER_BLUEPRINT action #6: replace ad-hoc console.log/console.error
 * with a structured logger that outputs JSON (parseable by log aggregation
 * tools like Vercel's log drain, Datadog, or plain `jq`).
 *
 * Each log entry includes:
 *   - timestamp (ISO 8601)
 *   - level (info, warn, error)
 *   - message
 *   - optional context (any JSON-serializable object)
 *   - optional requestId (for tracing a single request across routes)
 *
 * Usage:
 *   import { logger } from "@/lib/logger";
 *   logger.info("video uploaded", { videoId, channelId, sizeBytes });
 *   logger.warn("rate limit hit", { ip, route, limit });
 *   logger.error("db write failed", { error: e.message, table: "Video" });
 *
 * In dev: logs are pretty-printed (one line, readable).
 * In prod (Vercel): logs are JSON (one line per entry, parseable).
 *
 * The logger never throws — if JSON.stringify fails (circular refs), it
 * falls back to a plain string log.
 */

type LogLevel = "info" | "warn" | "error";

interface LogEntry {
  timestamp: string;
  level: LogLevel;
  message: string;
  [key: string]: unknown;
}

function format(entry: LogEntry): string {
  // In development, pretty-print for readability.
  // In production, output compact JSON for log aggregation.
  const isDev = process.env.NODE_ENV !== "production";
  if (isDev) {
    // Dev: "  [INFO]  message  {context}"
    const ctx = Object.keys(entry)
      .filter(k => k !== "timestamp" && k !== "level" && k !== "message")
      .reduce((acc, k) => { (acc as any)[k] = (entry as any)[k]; return acc; }, {} as Record<string, unknown>);
    const ctxStr = Object.keys(ctx).length > 0 ? " " + JSON.stringify(ctx) : "";
    return `  [${entry.level.toUpperCase()}]  ${entry.message}${ctxStr}`;
  }
  // Prod: compact JSON
  try {
    return JSON.stringify(entry);
  } catch {
    return JSON.stringify({ ...entry, _serializeError: "circular reference" });
  }
}

function log(level: LogLevel, message: string, context?: Record<string, unknown>) {
  const entry: LogEntry = {
    timestamp: new Date().toISOString(),
    level,
    message,
    ...context,
  };
  const formatted = format(entry);
  if (level === "error") {
    console.error(formatted);
  } else if (level === "warn") {
    console.warn(formatted);
  } else {
    console.log(formatted);
  }
}

export const logger = {
  info: (message: string, context?: Record<string, unknown>) => log("info", message, context),
  warn: (message: string, context?: Record<string, unknown>) => log("warn", message, context),
  error: (message: string, context?: Record<string, unknown>) => log("error", message, context),
};

/**
 * Create a request-scoped logger that includes the requestId in every log.
 * Usage:
 *   const reqLog = createRequestLogger("req_abc123");
 *   reqLog.info("processing video upload", { videoId });
 */
export function createRequestLogger(requestId: string) {
  return {
    info: (message: string, context?: Record<string, unknown>) => log("info", message, { ...context, requestId }),
    warn: (message: string, context?: Record<string, unknown>) => log("warn", message, { ...context, requestId }),
    error: (message: string, context?: Record<string, unknown>) => log("error", message, { ...context, requestId }),
  };
}
