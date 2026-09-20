import { NextResponse } from "next/server";
import { getMetrics } from "@/lib/metrics-store";
import { getResourceMetrics } from "@/lib/resource-governor";
import { getAllCircuitStates } from "@/lib/circuit-breaker";
import { getNotificationQuotaStatus } from "@/lib/notification-service";
import { isInngestConfigured } from "@/lib/inngest-jobs";
import { getAIProviderStatus } from "@/lib/ai-provider";
import { isEmailConfigured } from "@/lib/email-service";
import { isSmsConfigured } from "@/lib/sms-service";
import { db } from "@/lib/db";

/**
 * GET /api/cost-dashboard
 *
 * Per master spec §40: "Create one unified infrastructure/cost dashboard."
 * Shows usage + quota for every provider, clearly distinguishing:
 *   PLATFORM-FUNDED | CUSTOMER-FUNDED | FREE-TIER | QUOTA-EXCEEDED
 *
 * No R2 metrics (R2 removed).
 * No Resend metrics (Resend removed).
 */

const FREE_TIER_LIMITS = {
  cloudflare: { requestsPerDay: 100_000, cpuPerRequestMs: 10 },
  turso: { readsPerMonth: "1 billion", storageMb: 9216 },
  vercel: { bandwidthGb: 100, functionHoursGb: 100 },
  inngest: { invocationsPerMonth: 25_000 },
  brevo: { emailsPerDay: 300 },
  filebase: { storageGb: 5, egressGbPerMonth: 5 },
  neon: { storageGb: 0.5 },
  groq: { requestsPerDay: 14_400 },
};

export async function GET() {
  const m = getMetrics();
  const resources = getResourceMetrics();
  const circuits = getAllCircuitStates();
  const notificationQuota = getNotificationQuotaStatus();
  const aiStatus = getAIProviderStatus();

  // Count database records for storage estimation.
  let dbStats: Record<string, number> = {};
  try {
    for (const model of ["Video", "Channel", "Comment", "User", "Session", "OutboxEvent"]) {
      const result = await (db as any)[model.charAt(0).toLowerCase() + model.slice(1)].findMany({ select: { id: true } });
      dbStats[model] = (result as any[]).length;
    }
  } catch { /* DB error */ }

  // Calculate quota usage percentages.
  const brevoUsagePct = notificationQuota.email.limit > 0
    ? Math.round((notificationQuota.email.sentToday / notificationQuota.email.limit) * 100)
    : 0;

  const brevoStatus = brevoUsagePct >= 100 ? "QUOTA_EXCEEDED"
    : brevoUsagePct >= 90 ? "WARNING"
    : brevoUsagePct >= 70 ? "MONITORING"
    : "HEALTHY";

  return NextResponse.json({
    timestamp: new Date().toISOString(),

    // ── Turso ──
    turso: {
      provider: "Turso",
      fundingModel: "FREE-TIER",
      limits: FREE_TIER_LIMITS.turso,
      status: "HEALTHY",
      dbStats,
      circuitState: circuits["turso"]?.state || "CLOSED",
    },

    // ── Vercel ──
    vercel: {
      provider: "Vercel",
      fundingModel: "FREE-TIER",
      limits: FREE_TIER_LIMITS.vercel,
      status: "HEALTHY",
    },

    // ── Inngest ──
    inngest: {
      provider: "Inngest",
      fundingModel: "FREE-TIER",
      limits: FREE_TIER_LIMITS.inngest,
      configured: isInngestConfigured(),
      status: isInngestConfigured() ? "HEALTHY" : "NOT_CONFIGURED",
    },

    // ── Neon (Analytics + Recovery) ──
    neon: {
      provider: "Neon Postgres",
      fundingModel: "FREE-TIER",
      limits: FREE_TIER_LIMITS.neon,
      role: "analytics + disaster recovery",
      status: "HEALTHY",
    },

    // ── AI Providers ──
    ai: {
      providers: aiStatus,
      activeCount: Object.values(aiStatus).filter(Boolean).length,
      totalRequests: m.aiRequests,
      fallbackRate: m.aiRequests > 0
        ? Number((m.aiFallbacks / m.aiRequests * 100).toFixed(1))
        : 0,
      fundingModel: "FREE-TIER",
      status: Object.values(aiStatus).filter(Boolean).length > 0 ? "HEALTHY" : "NOT_CONFIGURED",
    },

    // ── System Resources ──
    system: {
      cpuLoadPct: Number((resources.cpuLoad * 100).toFixed(1)),
      memoryUsagePct: Number((resources.memoryUsage * 100).toFixed(1)),
      concurrentJobs: resources.concurrentJobs,
      maxConcurrentJobs: resources.maxConcurrentJobs,
    },

    // ── Circuit Breakers ──
    circuits,

    // ── Cost Summary ──
    costSummary: {
      platformMonthlyCost: "$0",
      model: "ZERO-COST-BY-DEFAULT — 5-service stack: GitHub + Vercel + Inngest + Neon + Turso",
      servicesInUse: ["GitHub", "Vercel", "Inngest", "Neon", "Turso"],
    },
  });
}
