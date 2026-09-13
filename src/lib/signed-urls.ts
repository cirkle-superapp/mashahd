import { createHmac } from "node:crypto";

/**
 * Signed Media URLs — short-lived playback tokens for private media.
 *
 * Per v6 spec §126: "For private media support: short-lived signed URL
 * or short-lived playback token."
 *
 * How it works:
 *   1. The client requests a playback token from /api/media/videos/[id]/playback
 *   2. The server checks authorization (is the video public? is the user allowed?)
 *   3. If private, the server issues a signed token with an expiry
 *   4. The client uses the token to fetch media from R2/origin
 *   5. The origin verifies the token before serving the media
 *
 * The token is HMAC-signed with MEDIA_SIGNING_KEY (env var). It contains:
 *   - videoId
 *   - renditionId (optional, or "all")
 *   - expiresAt (timestamp)
 *   - signature (HMAC-SHA256)
 *
 * Tokens are URL-safe (base64url encoded) and stateless (no DB lookup needed).
 */

const SIGNING_KEY = process.env.MEDIA_SIGNING_KEY || "mashahd-default-signing-key-change-me";

const TOKEN_TTL_SEC = 4 * 60 * 60; // 4 hours

interface TokenPayload {
  v: string; // videoId
  r: string; // renditionId ("all" = all renditions)
  e: number; // expiresAt (unix seconds)
}

/**
 * Generate a signed playback token for a video.
 */
export function generatePlaybackToken(
  videoId: string,
  renditionId: string = "all",
  ttlSec: number = TOKEN_TTL_SEC
): string {
  const payload: TokenPayload = {
    v: videoId,
    r: renditionId,
    e: Math.floor(Date.now() / 1000) + ttlSec,
  };

  const payloadStr = Buffer.from(JSON.stringify(payload)).toString("base64url");
  const signature = createHmac("sha256", SIGNING_KEY).update(payloadStr).digest("base64url");

  return `${payloadStr}.${signature}`;
}

/**
 * Verify a signed playback token.
 * Returns the decoded payload if valid, or null if invalid/expired.
 */
export function verifyPlaybackToken(token: string): TokenPayload | null {
  try {
    const [payloadStr, signature] = token.split(".");
    if (!payloadStr || !signature) return null;

    // Verify signature.
    const expectedSig = createHmac("sha256", SIGNING_KEY).update(payloadStr).digest("base64url");
    if (signature !== expectedSig) return null;

    // Decode payload.
    const payload = JSON.parse(Buffer.from(payloadStr, "base64url").toString()) as TokenPayload;

    // Check expiry.
    if (payload.e < Math.floor(Date.now() / 1000)) return null;

    return payload;
  } catch {
    return null;
  }
}

/**
 * Check if a video is private (requires a token).
 * Public videos don't need signed URLs — they can be served directly from R2.
 *
 * For now, all videos are public. When private videos are added (e.g.
 * membership-only content), this function will check the video's visibility
 * flag in the database.
 */
export function isPrivateVideo(video: { visibility?: string }): boolean {
  return video.visibility === "private" || video.visibility === "members";
}

/**
 * Extract the token from a query string or Authorization header.
 */
export function extractToken(req: Request): string | null {
  // Try query param first: ?token=xxx
  const url = new URL(req.url);
  const queryToken = url.searchParams.get("token");
  if (queryToken) return queryToken;

  // Try Authorization header: Bearer xxx
  const authHeader = req.headers.get("authorization");
  if (authHeader?.startsWith("Bearer ")) {
    return authHeader.slice(7);
  }

  return null;
}
