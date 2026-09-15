/**
 * NotificationService — unified notification engine.
 *
 * Per master spec §33:
 *   NotificationService
 *      ├── EmailChannel → Brevo
 *      └── SMSChannel   → Customer-funded provider
 *
 * The business layer only says: sendNotification(...)
 * The notification subsystem decides: channel, priority, authorization,
 * quota, cost, provider, retry.
 *
 * Per §6: Email is asynchronous via Inngest (not in the request path).
 * Per §11: Email and SMS have independent quotas, permissions, cost models.
 */

import { sendEmail, getEmailQuotaStatus, type EmailPriority } from "./email-service";
import { getSmsPort, type SmsRequest } from "./sms-service";
import { triggerJob } from "./inngest-jobs";

export type NotificationChannel = "email" | "sms" | "both";
export type NotificationPriority = EmailPriority; // P0-P4

export interface NotificationRequest {
  // Who to notify
  email?: string;
  phone?: string;
  // What to send
  subject: string;
  htmlBody?: string;
  textBody?: string;
  smsMessage?: string;
  // Policy
  priority: NotificationPriority;
  channel: NotificationChannel;
  // Metadata
  correlationId?: string;
  idempotencyKey?: string;
  // SMS-specific (required if channel includes SMS)
  smsCustomerId?: string;
  smsUserId?: string;
  smsPurpose?: string;
  smsAuthorizationReference?: string;
  smsConsentReference?: string;
  smsEstimatedCost?: number;
  smsCurrency?: string;
}

export interface NotificationResult {
  ok: boolean;
  emailStatus?: "SENT" | "DEFERRED" | "FAILED" | "QUOTA_EXCEEDED" | "NOT_CONFIGURED";
  smsStatus?: "SENT" | "QUEUED" | "FAILED" | "NOT_AUTHORIZED" | "NOT_CONFIGURED";
  error?: string;
}

/**
 * Send a notification through the unified engine.
 *
 * Per §6: this function is async — it enqueues the notification via Inngest
 * and returns immediately. The actual delivery happens in a background job.
 *
 * If Inngest is not configured, falls back to synchronous send (best-effort).
 */
export async function sendNotification(req: NotificationRequest): Promise<NotificationResult> {
  const result: NotificationResult = { ok: true };
  const channel = req.channel;

  // ── Email channel ──
  if ((channel === "email" || channel === "both") && req.email) {
    // Per §6: enqueue via Inngest (async — not in the request path).
    if (process.env.INNGEST_KEY) {
      const inngestResult = await triggerJob({
        name: "mashahd/notification/email",
        data: {
          to: req.email,
          subject: req.subject,
          html: req.htmlBody,
          text: req.textBody,
          priority: req.priority,
          correlationId: req.correlationId,
        },
      });

      if (inngestResult.ok) {
        result.emailStatus = "SENT";
      } else {
        // Inngest failed — fall back to synchronous send.
        const emailResult = await sendEmail({
          to: req.email,
          subject: req.subject,
          html: req.htmlBody,
          text: req.textBody,
          priority: req.priority,
        });
        result.emailStatus = emailResult.status;
        if (!emailResult.ok) result.ok = false;
      }
    } else {
      // No Inngest — synchronous send (best-effort, doesn't block transaction).
      const emailResult = await sendEmail({
        to: req.email,
        subject: req.subject,
        html: req.htmlBody,
        text: req.textBody,
        priority: req.priority,
      });
      result.emailStatus = emailResult.status;
      if (!emailResult.ok && req.priority <= "P1") {
        // Only fail the notification for high-priority emails.
        result.ok = false;
        result.error = emailResult.error;
      }
    }
  }

  // ── SMS channel ──
  if ((channel === "sms" || channel === "both") && req.phone) {
    const smsPort = getSmsPort();

    if (!smsPort.isConfigured()) {
      result.smsStatus = "NOT_CONFIGURED";
      // SMS not configured is not a failure for the overall notification
      // if email was also requested and succeeded.
    } else {
      const smsReq: SmsRequest = {
        sms_request_id: `sms_${Date.now()}_${Math.random().toString(36).slice(2, 8)}`,
        customer_id: req.smsCustomerId || "unknown",
        user_id: req.smsUserId || "unknown",
        purpose: req.smsPurpose || "notification",
        destination: req.phone,
        estimated_cost: req.smsEstimatedCost || 0,
        currency: req.smsCurrency || "USD",
        authorization_reference: req.smsAuthorizationReference,
        consent_reference: req.smsConsentReference,
        message: req.smsMessage || req.textBody || req.subject,
      };

      const smsResult = await smsPort.send(smsReq);
      result.smsStatus = smsResult.ok ? "SENT" : smsResult.status === "QUEUED" ? "QUEUED" : "FAILED";
      if (!smsResult.ok && req.priority <= "P0") {
        result.ok = false;
        result.error = smsResult.error;
      }
    }
  }

  return result;
}

/**
 * Get unified quota status for the cost dashboard (§40).
 */
export function getNotificationQuotaStatus(): {
  email: { sentToday: number; remainingToday: number; limit: number };
  sms: { configured: boolean };
} {
  return {
    email: getEmailQuotaStatus(),
    sms: { configured: getSmsPort().isConfigured() },
  };
}
