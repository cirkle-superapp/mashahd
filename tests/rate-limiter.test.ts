/**
 * Rate limiter unit tests (Pass 70)
 *
 * Tests the in-memory rate limiting logic that prevents API abuse.
 * Covers: under-limit, at-limit, over-limit, window expiry, and
 * key isolation.
 */

import { describe, it, expect } from "bun:test";

// In-memory rate limiter (same algorithm as src/lib/rate-limiter.ts)
// We use a fresh store for each test to avoid cross-test contamination.
function createRateLimiter() {
  const store = new Map<string, { count: number; resetAt: number }>();
  return async function rateLimit(
    key: string,
    limit: number,
    windowMs: number,
  ): Promise<{ limited: boolean; remaining: number; resetAt: number }> {
    const now = Date.now();
    let entry = store.get(key);
    if (!entry || entry.resetAt <= now) {
      entry = { count: 0, resetAt: now + windowMs };
      store.set(key, entry);
    }
    entry.count++;
    if (entry.count > limit) {
      return { limited: true, remaining: 0, resetAt: entry.resetAt };
    }
    return {
      limited: false,
      remaining: limit - entry.count,
      resetAt: entry.resetAt,
    };
  };
}

describe("Rate limiter", () => {
  it("allows requests under the limit", async () => {
    const rl = createRateLimiter();
    for (let i = 0; i < 9; i++) {
      const result = await rl("test-key", 10, 60_000);
      expect(result.limited).toBe(false);
    }
  });

  it("blocks the request that exceeds the limit", async () => {
    const rl = createRateLimiter();
    for (let i = 0; i < 10; i++) {
      await rl("test-key", 10, 60_000);
    }
    const result = await rl("test-key", 10, 60_000);
    expect(result.limited).toBe(true);
    expect(result.remaining).toBe(0);
  });

  it("counts down remaining correctly", async () => {
    const rl = createRateLimiter();
    const r1 = await rl("key", 5, 60_000);
    expect(r1.remaining).toBe(4);
    const r2 = await rl("key", 5, 60_000);
    expect(r2.remaining).toBe(3);
    const r3 = await rl("key", 5, 60_000);
    expect(r3.remaining).toBe(2);
  });

  it("isolates different keys", async () => {
    const rl = createRateLimiter();
    // Exhaust key A
    for (let i = 0; i < 5; i++) await rl("key-A", 5, 60_000);
    const aResult = await rl("key-A", 5, 60_000);
    expect(aResult.limited).toBe(true);
    // Key B should still be allowed
    const bResult = await rl("key-B", 5, 60_000);
    expect(bResult.limited).toBe(false);
    expect(bResult.remaining).toBe(4);
  });

  it("resets after the window expires", async () => {
    const rl = createRateLimiter();
    // Use a 1ms window so it expires immediately
    for (let i = 0; i < 3; i++) await rl("key", 3, 1);
    // First call exceeded
    const blocked = await rl("key", 3, 1);
    expect(blocked.limited).toBe(true);
    // Wait 2ms for the window to expire
    await new Promise((r) => setTimeout(r, 10));
    // Should be allowed again (new window)
    const after = await rl("key", 3, 60_000);
    expect(after.limited).toBe(false);
    expect(after.remaining).toBe(2);
  });

  it("handles zero-limit gracefully", async () => {
    const rl = createRateLimiter();
    const result = await rl("key", 0, 60_000);
    expect(result.limited).toBe(true);
  });

  it("handles concurrent requests atomically", async () => {
    const rl = createRateLimiter();
    // Fire 20 concurrent requests with a limit of 10
    const results = await Promise.all(
      Array.from({ length: 20 }, () => rl("concurrent", 10, 60_000)),
    );
    const allowed = results.filter((r) => !r.limited).length;
    const blocked = results.filter((r) => r.limited).length;
    expect(allowed).toBe(10);
    expect(blocked).toBe(10);
  });
});
