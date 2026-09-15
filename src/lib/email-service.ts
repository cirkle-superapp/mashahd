/**
 * EmailPort — provider-agnostic email abstraction.
 *
 * Per master spec §4: "Create EmailPort → BrevoEmailAdapter.
 * Do not spread Brevo-specific code throughout business logic."
 *
 * Per §5: Brevo free = 300 emails/day, $0/month, no time limit.
 * Per §6: Email MUST be asynchronous (via Inngest, not in the request path).
 * Per §7: Priority-based quota protection (P0=security, P1=auth, P2=transactional, P3=info, P4=nonessential).
 * Per §31: Email quota governor tracks daily/monthly usage.
 */

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
const BREVO_DAILY_LIMIT = 300;
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
 * Brevo Email Adapter — uses Brevo's REST API (no SDK needed).
 *
 * Brevo API docs: https://developers.brevo.com/reference/sendtransacemail
 *
 * Per §7: P0/P1 are highest priority (never deferred).
 * P3 is deferred when necessary. P4 is suppressed under quota pressure.
 */
export class BrevoEmailAdapter implements EmailPort {
  private apiKey: string;
  private senderEmail: string;
  private senderName: string;

  constructor(opts: {
    apiKey: string;
    senderEmail: string;
    senderName?: string;
  }) {
    this.apiKey = opts.apiKey;
    this.senderEmail = opts.senderEmail;
    this.senderName = opts.senderName || "Mashahd";
  }

  isConfigured(): boolean {
    return !!this.apiKey;
  }

  getQuotaStatus() {
    resetDailyIfNeeded();
    return {
      sentToday: _sentToday,
      remainingToday: Math.max(0, BREVO_DAILY_LIMIT - _sentToday),
      limit: BREVO_DAILY_LIMIT,
    };
  }

  async send(req: EmailRequest): Promise<EmailResult> {
    resetDailyIfNeeded();

    // Quota check — per §7: P0/P1 bypass quota, P3/P4 are deferred.
    if (_sentToday >= BREVO_DAILY_LIMIT) {
      if (req.priority === "P3" || req.priority === "P4") {
        console.warn(`[email] Quota exceeded (${_sentToday}/${BREVO_DAILY_LIMIT}) — deferring P${req.priority[1]} email`);
        return { ok: false, status: "DEFERRED", error: "daily quota exceeded" };
      }
      // P0/P1 still try to send (security-critical) but may fail at Brevo's side.
      console.warn(`[email] Quota exceeded but sending P${req.priority[1]} (security-critical)`);
    }

    // Soft quota — 90% usage: defer P4 only.
    if (_sentToday >= BREVO_DAILY_LIMIT * 0.9 && req.priority === "P4") {
      return { ok: false, status: "DEFERRED", error: "quota approaching — P4 suppressed" };
    }

    try {
      const response = await fetch("https://api.brevo.com/v3/smtp/email", {
        method: "POST",
        headers: {
          "api-key": this.apiKey,
          "Content-Type": "application/json",
        },
        body: JSON.stringify({
          sender: { email: this.senderEmail, name: this.senderName },
          to: [{ email: req.to }],
          subject: req.subject,
          htmlContent: req.html,
          textContent: req.text,
        }),
      });

      if (response.status === 429) {
        // Rate limited by Brevo — defer.
        return { ok: false, status: "DEFERRED", error: "Brevo rate limited (429)" };
      }

      if (!response.ok) {
        const error = await response.text();
        console.warn("[email] Brevo send failed:", response.status, error.slice(0, 200));
        return { ok: false, status: "FAILED", error: error.slice(0, 200) };
      }

      const data = await response.json();
      _sentToday++;
      return { ok: true, messageId: data.messageId, status: "SENT" };
    } catch (e) {
      console.warn("[email] Send error:", e);
      return { ok: false, status: "FAILED", error: String(e).slice(0, 200) };
    }
  }
}

// ── Singleton adapter ──
let _adapter: EmailPort | null = null;

function getEmailAdapter(): EmailPort {
  if (!_adapter) {
    const apiKey = process.env.BREVO_API_KEY || "";
    const senderEmail = process.env.BREVO_SENDER_EMAIL || "noreply@mashahd.app";
    const senderName = process.env.BREVO_SENDER_NAME || "Mashahd";

    if (apiKey) {
      _adapter = new BrevoEmailAdapter({ apiKey, senderEmail, senderName });
      console.log("[email] Using Brevo email adapter");
    } else {
      // No-op adapter (email disabled).
      _adapter = {
        send: async () => ({ ok: false, status: "FAILED", error: "email not configured" }),
        isConfigured: () => false,
        getQuotaStatus: () => ({ sentToday: 0, remainingToday: 0, limit: 0 }),
      };
      console.warn("[email] BREVO_API_KEY not set — email disabled");
    }
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
