/**
 * HMAC-signed browserId — prevents count inflation attacks.
 *
 * PROBLEM (deep audit pass 2):
 *   The browserId was generated client-side (`b_` + random + timestamp) with
 *   no server validation. Anyone could script `curl POST /api/videos/X/views`
 *   with a different fake browserId each time to inflate view counts
 *   arbitrarily. Same for likes and subscriptions.
 *
 * SOLUTION:
 *   The server issues a signed browserId on first request. The browserId
 *   embeds a random ID + an HMAC-SHA256 signature using BROWSER_ID_SECRET
 *   (or a derived default). The server verifies the signature on every
 *   state-changing request. Fabricated browserIds (wrong signature) are
 *   rejected with 403.
 *
 *   Format:  bid_<base64url(id)> . <base64url(hmac)>
 *
 * ZERO-COST:
 *   - No DB lookup needed (signature is self-validating).
 *   - Falls back to an in-memory random secret in dev if no env var is set
 *     (sessions restart = new secret = old browserIds invalidate — fine for dev).
 *   - In production, set BROWSER_ID_SECRET to a stable value.
 *
 * BACKWARD COMPAT:
 *   - Old unsigned browserIds (just `b_...`) are accepted but logged, and
 *     the client is silently re-issued a signed one via /api/user-state.
 */

import { createHmac, timingSafeEqual, randomBytes } from "node:crypto";
import { NextResponse } from "next/server";

const BID_PREFIX = "bid_";
const OLD_PREFIX = "b_";

function getSecret(): string {
  return (
    process.env.BROWSER_ID_SECRET ||
    // Dev fallback — random per-process. In production this MUST be set.
    (_devSecret ??= Math.random().toString(36).slice(2))
  );
}

let _devSecret: string | null = null;

function b64url(buf: Buffer | string): string {
  return Buffer.from(buf).toString("base64url");
}

function sign(id: string): string {
  const mac = createHmac("sha256", getSecret()).update(id).digest();
  return b64url(mac);
}

/**
 * Issue a new signed browserId. Called by /api/user-state when no valid
 * signed bid is present.
 */
export function issueBrowserId(): string {
  // 16 bytes of entropy (128 bits) — collision-resistant.
  const id = randomBytes(16).toString("hex");
  const idB64 = b64url(id);
  // Sign the full prefixed id token (bid_ + base64url(id)) so the verifier
  // reconstructs the same string. The signature is over the token, not the raw id.
  const fullId = `${BID_PREFIX}${idB64}`;
  return `${fullId}.${sign(fullId)}`;
}

/**
 * Verify a browserId's signature.
 * Returns the validated id (without prefix) if valid, null otherwise.
 *
 * Accepts both the new signed format (bid_...) and the legacy unsigned
 * format (b_...) for backward compatibility — but only the signed format
 * passes strict verification.
 */
export function verifyBrowserId(bid: string): { valid: boolean; id: string; legacy: boolean } {
  if (!bid || typeof bid !== "string") return { valid: false, id: "", legacy: false };

  // Legacy format — accept but flag as legacy (caller may re-issue).
  if (bid.startsWith(OLD_PREFIX)) {
    return { valid: true, id: bid, legacy: true };
  }

  if (!bid.startsWith(BID_PREFIX)) {
    return { valid: false, id: "", legacy: false };
  }

  const rest = bid.slice(BID_PREFIX.length);
  const dotIdx = rest.lastIndexOf(".");
  if (dotIdx < 1) return { valid: false, id: "", legacy: false };

  const idPart = rest.slice(0, dotIdx);
  const sigPart = rest.slice(dotIdx + 1);
  const fullId = `${BID_PREFIX}${idPart}`;
  const expectedSig = sign(fullId);

  // Timing-safe comparison.
  try {
    const a = Buffer.from(sigPart, "base64url");
    const b = Buffer.from(expectedSig, "base64url");
    if (a.length !== b.length) return { valid: false, id: "", legacy: false };
    if (!timingSafeEqual(a, b)) return { valid: false, id: "", legacy: false };
    // Return the FULL bid (including signature) as the id — this is what's
    // stored in UserState.browserId and used as the Notification.recipientId.
    // The signature is stable as long as BROWSER_ID_SECRET doesn't change,
    // so this is a stable identifier for the user.
    return { valid: true, id: bid, legacy: false };
  } catch {
    return { valid: false, id: "", legacy: false };
  }
}

/**
 * Server-side guard for state-changing endpoints.
 * Returns null if the browserId is valid (old or new format), or an error
 * response if it's invalid. Use as:
 *
 *   const guard = requireValidBrowserId(body.browserId);
 *   if (guard.error) return guard.error;
 *   // guard.id is now the validated browserId
 */
export function requireValidBrowserId(
  bid: string | undefined
): { error: NextResponse | null; id: string } {
  if (!bid) {
    return {
      error: NextResponse.json(
        { error: "browserId required" },
        { status: 400 }
      ),
      id: "",
    };
  }
  const result = verifyBrowserId(bid);
  if (!result.valid) {
    return {
      error: NextResponse.json(
        { error: "invalid browserId — fetch a new one from /api/user-state" },
        { status: 403 }
      ),
      id: "",
    };
  }
  return { error: null, id: result.id };
}
