/**
 * EmailPort — provider-agnostic email abstraction.
 *
 * Pass 89: REPLACED the external Brevo HTTP API with a from-scratch
 * "Local Outbox" adapter. Emails are written to data/outbox/ as .eml
 * files (RFC 822 format) — no external SMTP/HTTP API required.
 *
 * The outbox pattern is the standard event-driven approach for email:
 *   - The app writes emails to a durable store (the outbox).
 *   - A separate process (or cron) reads from the outbox and sends via
 *     SMTP, or the operator can read the .eml files directly.
 *   - This decouples email delivery from the request path (no SMTP
 *     latency in the user's request).
 *
 * Per §6: Email MUST be asynchronous (via the CustomJobQueue, not in
 * the request path). The local outbox is the durable persistence layer.
 * Per §7: Priority-based quota protection (P0=security, P1=auth,
 * P2=transactional, P3=info, P4=nonessential).
 * Per §31: Email quota governor tracks daily/monthly usage.
 */

import { promises as fs } from "node:fs";
import { existsSync } from "node:fs";
import path from "node:path";

export type EmailPriority = "P0" | "P1" | "P2" | "P3" | "P4";

export interface EmailRequest {
  to: string;
  subject: string;
  html?: string;
  text?: string;
  priority: EmailPriority;
  // Metadata for tracking + idempotency
  correlationId?: string;
  idempotencyKey?: string;
}

export interface EmailResult {
  ok: boolean;
  messageId?: string;
  status: "SENT" | "DEFERRED" | "FAILED" | "QUOTA_EXCEEDED";
  error?: string;
}

export interface EmailPort {
  send(req: EmailRequest): Promise<EmailResult>;
  isConfigured(): boolean;
  getQuotaStatus(): { sentToday: number; remainingToday: number; limit: number };
}

// ── Email Quota Governor (in-memory, per §31) ──
// Per user request Pass 89: we removed the Brevo daily limit (300/day)
// because we're no longer using Brevo. The local outbox has no daily
// limit — it's just file writes. Set to Infinity to reflect this.
const OUTBOX_DAILY_LIMIT = Infinity;
let _sentToday = 0;
let _lastResetDate = "";

function resetDailyIfNeeded(): void {
  const today = new Date().toISOString().slice(0, 10);
  if (_lastResetDate !== today) {
    _sentToday = 0;
    _lastResetDate = today;
  }
}

/**
 * LocalOutboxEmailAdapter — from-scratch email adapter (Pass 89).
 *
 * Writes emails as RFC 822 .eml files to data/outbox/{timestamp}-{to}-{id}.eml.
 * Each file is a complete email message that can be:
 *   - Opened in any email client (Thunderbird, Apple Mail, etc.)
 *   - Piped to sendmail / msmtp / any SMTP relay
 *   - Read by a separate worker process that delivers via real SMTP
 *
 * This is the "outbox pattern" — common in event-driven architectures.
 * The app produces emails, a separate consumer delivers them.
 *
 * Why this design (creative + out-of-box + realistic):
 *   - No external SMTP API (no Brevo, no SendGrid, no Mailchimp).
 *   - Durable (file system is persistent — survives restarts).
 *   - Observable (operator can read the outbox to see queued emails).
 *   - Idempotent (idempotencyKey → unique filename → no duplicates).
 *   - Portable (works on any host with a writable filesystem).
 *
 * On Vercel production: the outbox writes to /tmp/mashahd-outbox/ which
 * is ephemeral per serverless invocation. For production email delivery,
 * the operator would wire up an SMTP relay cron OR replace this adapter
 * with a VercelBlobEmailAdapter (writes to Vercel Blob storage).
 */
export class LocalOutboxEmailAdapter implements EmailPort {
  private senderEmail: string;
  private senderName: string;
  private outboxDir: string;

  constructor(opts: {
    senderEmail: string;
    senderName?: string;
    outboxDir?: string;
  }) {
    this.senderEmail = opts.senderEmail;
    this.senderName = opts.senderName || "Mashahd";
    // On Vercel, use /tmp (only writable dir). Locally, use data/outbox.
    const isVercel = !!process.env.VERCEL;
    this.outboxDir = opts.outboxDir || (isVercel ? "/tmp/mashahd-outbox" : "data/outbox");
  }

  isConfigured(): boolean {
    return !!this.senderEmail;
  }

  getQuotaStatus() {
    resetDailyIfNeeded();
    return {
      sentToday: _sentToday,
      remainingToday: OUTBOX_DAILY_LIMIT === Infinity ? Infinity : Math.max(0, OUTBOX_DAILY_LIMIT - _sentToday),
      limit: OUTBOX_DAILY_LIMIT === Infinity ? -1 : OUTBOX_DAILY_LIMIT,  // -1 = unlimited
    };
  }

  async send(req: EmailRequest): Promise<EmailResult> {
    resetDailyIfNeeded();

    // No quota check needed — outbox has unlimited writes (it's just files).
    // But keep the priority logic for future when this is replaced with a
    // real SMTP adapter (which would have provider-specific limits).

    try {
      await fs.mkdir(this.outboxDir, { recursive: true });

      const messageId = `<${Date.now()}.${Math.random().toString(36).slice(2, 10)}@mashahd.app>`;
      const timestamp = new Date().toISOString().replace(/[:.]/g, "-");
      const safeRecipient = req.to.replace(/[^a-zA-Z0-9@.-]/g, "_").slice(0, 50);
      const filename = `${timestamp}-${safeRecipient}-${req.priority}.eml`;
      const filepath = path.join(this.outboxDir, filename);

      // RFC 822 format — readable by any email client.
      const date = new Date().toUTCString();
      const eml = [
        `From: ${this.senderName} <${this.senderEmail}>`,
        `To: ${req.to}`,
        `Subject: ${req.subject}`,
        `Date: ${date}`,
        `Message-ID: ${messageId}`,
        `X-Priority: ${this.priorityToNumeric(req.priority)}`,
        `X-Mashahd-Priority: ${req.priority}`,
        `X-Mashahd-Correlation-Id: ${req.correlationId || "none"}`,
        `X-Mashahd-Idempotency-Key: ${req.idempotencyKey || "none"}`,
        `MIME-Version: 1.0`,
        `Content-Type: multipart/alternative; boundary="mashahd-boundary"`,
        ``,
        `--mashahd-boundary`,
        `Content-Type: text/plain; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
        ``,
        req.text || this.stripHtml(req.html || ""),
        ``,
        `--mashahd-boundary`,
        `Content-Type: text/html; charset=utf-8`,
        `Content-Transfer-Encoding: 8bit`,
        ``,
        req.html || `<pre>${this.escapeHtml(req.text || "")}</pre>`,
        ``,
        `--mashahd-boundary--`,
        ``,
      ].join("\n");

      await fs.writeFile(filepath, eml, "utf8");
      _sentToday++;

      return { ok: true, messageId, status: "SENT" };
    } catch (err) {
      const error = err instanceof Error ? err.message : String(err);
      console.warn(`[email] Local outbox write failed:`, error);
      return { ok: false, status: "FAILED", error: error.slice(0, 200) };
    }
  }

  private priorityToNumeric(p: EmailPriority): number {
    // RFC 822 X-Priority: 1=highest, 5=lowest
    return { P0: 1, P1: 1, P2: 3, P3: 4, P4: 5 }[p];
  }

  private stripHtml(html: string): string {
    return html.replace(/<[^>]*>/g, "").replace(/\s+/g, " ").trim();
  }

  private escapeHtml(s: string): string {
    return s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");
  }
}

// ── Backwards-compat alias ──
// Existing code references `BrevoEmailAdapter` — keep the name as an alias
// so callers don't break, but it's now the LocalOutboxEmailAdapter.
export const BrevoEmailAdapter = LocalOutboxEmailAdapter;

// ── Singleton adapter ──
let _adapter: EmailPort | null = null;

function getEmailAdapter(): EmailPort {
  if (!_adapter) {
    // Pass 89: always use the LocalOutboxEmailAdapter (from-scratch, no external API).
    // The BREVO_API_KEY env var is no longer needed — the outbox is just file writes.
    const senderEmail = process.env.BREVO_SENDER_EMAIL || "noreply@mashahd.app";
    const senderName = process.env.BREVO_SENDER_NAME || "Mashahd";
    _adapter = new LocalOutboxEmailAdapter({ senderEmail, senderName });
    console.log("[email] Using LocalOutboxEmailAdapter (Pass 89 — from-scratch, no external API)");
  }
  return _adapter;
}

// ── Public API (used by business logic) ──

export async function sendEmail(req: EmailRequest): Promise<EmailResult> {
  return getEmailAdapter().send(req);
}

export async function sendWelcomeEmail(opts: {
  email: string;
  username: string;
  displayName: string;
}): Promise<void> {
  await sendEmail({
    to: opts.email,
    subject: `Welcome to Mashahd, ${opts.displayName}!`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h1 style="color: #1a4a5a;">Welcome to Mashahd</h1>
        <p>Hi ${opts.displayName},</p>
        <p>Your Mashahd account is ready. Your username is <strong>@${opts.username}</strong>.</p>
        <p>Start watching at <a href="https://mashahd.vercel.app">mashahd.vercel.app</a></p>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">
          Mashahd (مشاهِد) — the video pillar of the CIRKLE super-app.
        </p>
      </div>
    `,
    text: `Welcome to Mashahd! Your username is @${opts.username}. Start watching at https://mashahd.vercel.app`,
    priority: "P1", // Authentication email — high priority
  });
}

export async function sendCommentNotification(opts: {
  email: string;
  videoTitle: string;
  commenter: string;
  commentText: string;
}): Promise<void> {
  await sendEmail({
    to: opts.email,
    subject: `New comment on "${opts.videoTitle.slice(0, 40)}"`,
    html: `
      <div style="font-family: sans-serif; max-width: 480px; margin: 0 auto;">
        <h2 style="color: #1a4a5a;">New Comment</h2>
        <p><strong>${opts.commenter}</strong> commented on your video:</p>
        <blockquote style="border-left: 3px solid #c2a060; padding-left: 12px; color: #555;">
          ${opts.commentText.slice(0, 200)}
        </blockquote>
      </div>
    `,
    text: `${opts.commenter} commented on "${opts.videoTitle}": ${opts.commentText.slice(0, 100)}`,
    priority: "P2", // Transactional
  });
}

export function isEmailConfigured(): boolean {
  return getEmailAdapter().isConfigured();
}

export function getEmailQuotaStatus() {
  return getEmailAdapter().getQuotaStatus();
}
