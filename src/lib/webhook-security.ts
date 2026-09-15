/**
 * Webhook Security — signature verification for all external webhooks.
 *
 * Per master spec §38-39: "All external webhooks must verify:
 *   authenticity/signature, timestamp where supported, replay protection,
 *   schema validity, idempotency. Never process unverified webhooks."
 */

import { createHmac, timingSafeEqual } from "node:crypto";

export interface WebhookVerificationResult {
  valid: boolean;
  reason?: string;
}

/**
 * Verify a Brevo webhook signature.
 *
 * Brevo sends a signature in the `X-Postmark-Signature` or
 * the body contains a `signature` field computed with the webhook secret.
 *
 * @param body — the raw request body (string)
 * @param signature — the signature from the header/body
 * @param secret — the webhook signing secret
 */
export function verifyBrevoWebhook(
  body: string,
  signature: string,
  secret: string
): WebhookVerificationResult {
  if (!secret) {
    return { valid: false, reason: "webhook secret not configured" };
  }
  if (!signature) {
    return { valid: false, reason: "no signature provided" };
  }

  const expected = createHmac("sha256", secret).update(body).digest("hex");

  // Timing-safe comparison to prevent timing attacks.
  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    if (a.length !== b.length) {
      return { valid: false, reason: "signature length mismatch" };
    }
    if (!timingSafeEqual(a, b)) {
      return { valid: false, reason: "signature mismatch" };
    }
    return { valid: true };
  } catch {
    return { valid: false, reason: "invalid signature format" };
  }
}

/**
 * Verify an Inngest webhook signature.
 *
 * Inngest signs webhooks with the signing key using HMAC-SHA256.
 */
export function verifyInngestWebhook(
  body: string,
  signature: string,
  signingKey: string
): WebhookVerificationResult {
  return verifyBrevoWebhook(body, signature, signingKey); // Same HMAC-SHA256 pattern
}

/**
 * Verify a generic webhook signature (any provider that uses HMAC).
 */
export function verifyWebhookSignature(
  body: string,
  signature: string,
  secret: string,
  algorithm: "sha256" | "sha1" = "sha256"
): WebhookVerificationResult {
  if (!secret || !signature) {
    return { valid: false, reason: "missing secret or signature" };
  }

  const expected = createHmac(algorithm, secret).update(body).digest("hex");

  try {
    const a = Buffer.from(expected, "hex");
    const b = Buffer.from(signature, "hex");
    if (a.length !== b.length) return { valid: false, reason: "signature mismatch" };
    if (!timingSafeEqual(a, b)) return { valid: false, reason: "signature mismatch" };
    return { valid: true };
  } catch {
    return { valid: false, reason: "invalid signature format" };
  }
}

/**
 * Check webhook timestamp for replay protection.
 *
 * Per §39: "replay protection" — reject webhooks older than MAX_AGE.
 */
export function checkWebhookTimestamp(
  timestamp: number,
  maxAgeMs: number = 5 * 60 * 1000 // 5 minutes default
): WebhookVerificationResult {
  const now = Date.now();
  const age = now - timestamp;
  if (age > maxAgeMs) {
    return { valid: false, reason: `webhook expired (${Math.round(age / 1000)}s > ${maxAgeMs / 1000}s)` };
  }
  if (age < -maxAgeMs) {
    return { valid: false, reason: "webhook timestamp is in the future (possible replay attack)" };
  }
  return { valid: true };
}
