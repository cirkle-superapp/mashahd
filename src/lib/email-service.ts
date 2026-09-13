/**
 * Resend Email Service — transactional emails for Mashahd.
 *
 * Uses Resend (free tier: 3,000 emails/month, 100 emails/day).
 * No payment card required for the free tier.
 *
 * Use cases:
 *   - Email verification on registration (§84: "Verify email/phone")
 *   - Creator notifications (new comments, new subscribers)
 *   - Watch Party invitations
 *   - Upload pipeline status notifications
 *
 * The from domain must be verified at resend.com/domains.
 * Until verified, emails can only be sent to the account owner.
 */

const RESEND_API_KEY = process.env.RESEND_API_KEY || "";
const FROM_EMAIL = process.env.FROM_EMAIL || "Mashahd <noreply@mashahd.app>";

interface EmailOptions {
  to: string;
  subject: string;
  html?: string;
  text?: string;
}

/**
 * Send an email via Resend.
 * Returns { ok, id } on success, { ok: false, error } on failure.
 */
export async function sendEmail(opts: EmailOptions): Promise<{ ok: boolean; id?: string; error?: string }> {
  if (!RESEND_API_KEY) {
    console.warn("[email] RESEND_API_KEY not configured — email not sent");
    return { ok: false, error: "email service not configured" };
  }

  try {
    const response = await fetch("https://api.resend.com/emails", {
      method: "POST",
      headers: {
        "Authorization": `Bearer ${RESEND_API_KEY}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        from: FROM_EMAIL,
        to: opts.to,
        subject: opts.subject,
        html: opts.html,
        text: opts.text,
      }),
    });

    if (!response.ok) {
      const error = await response.json().catch(() => ({}));
      console.warn("[email] Send failed:", response.status, error);
      return { ok: false, error: JSON.stringify(error).slice(0, 200) };
    }

    const data = await response.json();
    return { ok: true, id: data.id };
  } catch (e) {
    console.warn("[email] Send error:", e);
    return { ok: false, error: String(e).slice(0, 200) };
  }
}

/**
 * Send a welcome email on registration.
 */
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
        <p>Your Mashahd account is ready. Your CIRKLE username is <strong>@${opts.username}</strong>.</p>
        <p>Start watching at <a href="https://mashahd.vercel.app">mashahd.vercel.app</a></p>
        <p style="color: #999; font-size: 12px; margin-top: 24px;">
          Mashahd (مشاهِد) — the video pillar of the CIRKLE super-app.
        </p>
      </div>
    `,
    text: `Welcome to Mashahd! Your username is @${opts.username}. Start watching at https://mashahd.vercel.app`,
  });
}

/**
 * Send a creator notification (new comment on your video).
 */
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
        <p><a href="https://mashahd.vercel.app">View on Mashahd</a></p>
      </div>
    `,
    text: `${opts.commenter} commented on "${opts.videoTitle}": ${opts.commentText.slice(0, 100)}`,
  });
}

/**
 * Check if the email service is configured.
 */
export function isEmailConfigured(): boolean {
  return !!RESEND_API_KEY;
}
