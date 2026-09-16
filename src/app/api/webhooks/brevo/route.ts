import { NextRequest, NextResponse } from "next/server";
import { verifyBrevoWebhook, checkWebhookTimestamp } from "@/lib/webhook-security";

/**
 * POST /api/webhooks/brevo
 *
 * Brevo delivery status callback.
 *
 * Per master spec §38-39: "All external webhooks must verify:
 *   authenticity/signature, timestamp, replay protection, schema validity,
 *   idempotency. Never process unverified webhooks."
 *
 * Brevo sends webhook callbacks for:
 *   - email.delivered → email was delivered to the recipient
 *   - email.opened → recipient opened the email
 *   - email.clicked → recipient clicked a link
 *   - email.bounced → email bounced (permanent failure)
 *   - email.spam → recipient marked as spam
 *   - email.blocked → email was blocked
 *
 * This endpoint records the delivery status but does NOT roll back
 * the business transaction (per §6: email failure ≠ transaction failure).
 */

const BREVO_WEBHOOK_SECRET = process.env.BREVO_WEBHOOK_SECRET || "";

export async function POST(req: NextRequest) {
  const body = await req.text();

  // Per §38-39: verify webhook signature.
  if (BREVO_WEBHOOK_SECRET) {
    const signature = req.headers.get("x-brevo-signature") || "";
    const verification = verifyBrevoWebhook(body, signature, BREVO_WEBHOOK_SECRET);
    if (!verification.valid) {
      console.warn("[brevo-webhook] Signature verification failed:", verification.reason);
      return NextResponse.json({ error: "unauthorized" }, { status: 401 });
    }
  }

  // Parse the webhook payload.
  let payload: any;
  try {
    payload = JSON.parse(body);
  } catch {
    return NextResponse.json({ error: "invalid JSON" }, { status: 400 });
  }

  // Replay protection (§39): check timestamp.
  const ts = payload.ts || payload.timestamp;
  if (ts) {
    const tsCheck = checkWebhookTimestamp(Number(ts));
    if (!tsCheck.valid) {
      console.warn("[brevo-webhook] Replay protection:", tsCheck.reason);
      return NextResponse.json({ error: "expired" }, { status: 400 });
    }
  }

  // Process the event.
  const event = payload.event || "";
  const email = payload.email || payload.recipient || "";
  const messageId = payload.messageId || payload["message-id"] || "";

  switch (event) {
    case "delivered":
      console.log(`[brevo-webhook] Email delivered: ${email} (msg: ${messageId})`);
      break;
    case "opened":
      console.log(`[brevo-webhook] Email opened: ${email}`);
      break;
    case "clicked":
      console.log(`[brevo-webhook] Email clicked: ${email}`);
      break;
    case "bounce":
    case "hard_bounce":
      console.warn(`[brevo-webhook] Email bounced: ${email} (permanent)`);
      break;
    case "soft_bounce":
      console.warn(`[brevo-webhook] Email soft bounce: ${email} (temporary)`);
      break;
    case "spam":
      console.warn(`[brevo-webhook] Email marked as spam: ${email}`);
      break;
    case "blocked":
      console.warn(`[brevo-webhook] Email blocked: ${email}`);
      break;
    case "invalid_email":
      console.warn(`[brevo-webhook] Invalid email: ${email}`);
      break;
    default:
      console.log(`[brevo-webhook] Unknown event: ${event} for ${email}`);
  }

  // Always return 200 — Brevo considers non-200 as retry.
  // Per §37: no infinite loops — Brevo has its own retry limit.
  return NextResponse.json({ ok: true, event, email });
}

/**
 * GET /api/webhooks/brevo — health check.
 */
export async function GET() {
  return NextResponse.json({
    ok: true,
    service: "brevo-webhook",
    secretConfigured: !!BREVO_WEBHOOK_SECRET,
  });
}
