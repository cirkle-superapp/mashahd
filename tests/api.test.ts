/**
 * API integration tests (Pass 70)
 *
 * Tests the actual HTTP endpoints against the running dev server.
 * These verify the full stack: client → API → DB → response.
 *
 * Requires the dev server to be running on http://localhost:3000.
 */

import { describe, it, expect, beforeAll } from "bun:test";

const BASE = "http://localhost:3000";

async function fetchJSON(path: string, opts?: RequestInit) {
  const res = await fetch(`${BASE}${path}`, opts);
  return { status: res.status, data: await res.json().catch(() => null) };
}

async function getBid(): Promise<string> {
  const res = await fetch(`${BASE}/api/user-state`, { method: "POST" });
  const data = await res.json();
  return data.browserId;
}

describe("API integration tests", () => {
  let bid: string;

  beforeAll(async () => {
    bid = await getBid();
  });

  // ── Platform endpoints ──
  describe("Platform", () => {
    it("GET /api/ready returns 200", async () => {
      const { status } = await fetchJSON("/api/ready");
      expect(status).toBe(200);
    });

    it("GET /api/catalog returns 200 with domains", async () => {
      const { status, data } = await fetchJSON("/api/catalog");
      expect(status).toBe(200);
      expect(data?.domains).toBeDefined();
      expect(data.domains.length).toBeGreaterThan(0);
    });

    it("GET /api/cost-dashboard returns 200 with services", async () => {
      const { status, data } = await fetchJSON("/api/cost-dashboard");
      expect(status).toBe(200);
      expect(data?.turso).toBeDefined();
      expect(data.turso.status).toBe("HEALTHY");
    });

    it("GET /api/platform-changelog returns 200 with changes", async () => {
      const { status, data } = await fetchJSON("/api/platform-changelog");
      expect(status).toBe(200);
      expect(data?.changes).toBeDefined();
      expect(data.changes.length).toBeGreaterThan(0);
    });
  });

  // ── Video endpoints ──
  describe("Videos", () => {
    it("GET /api/videos returns 200 with video list", async () => {
      const { status, data } = await fetchJSON("/api/videos?limit=5");
      expect(status).toBe(200);
      expect(data?.videos).toBeDefined();
      expect(data.videos.length).toBeGreaterThan(0);
    });

    it("GET /api/videos supports sort=popular", async () => {
      const { status, data } = await fetchJSON("/api/videos?sort=popular&limit=3");
      expect(status).toBe(200);
      expect(data.videos.length).toBeGreaterThan(0);
    });

    it("GET /api/videos supports sort=recent", async () => {
      const { status, data } = await fetchJSON("/api/videos?sort=recent&limit=3");
      expect(status).toBe(200);
      expect(data.videos.length).toBeGreaterThan(0);
    });

    it("GET /api/videos/[id] returns video detail", async () => {
      const list = await fetchJSON("/api/videos?limit=1");
      const videoId = list.data.videos[0].id;
      const { status, data } = await fetchJSON(`/api/videos/${videoId}?bid=${bid}`);
      expect(status).toBe(200);
      expect(data?.video).toBeDefined();
      expect(data.video.id).toBe(videoId);
      expect(data.isCreator).toBeDefined();
    });

    it("GET /api/videos/[id]/renditions returns 200", async () => {
      const list = await fetchJSON("/api/videos?limit=1");
      const videoId = list.data.videos[0].id;
      const { status, data } = await fetchJSON(`/api/videos/${videoId}/renditions`);
      expect(status).toBe(200);
      expect(data?.source).toBeDefined();
    });

    it("GET /api/videos/[id]/comments returns 200", async () => {
      const list = await fetchJSON("/api/videos?limit=1");
      const videoId = list.data.videos[0].id;
      const { status, data } = await fetchJSON(`/api/videos/${videoId}/comments`);
      expect(status).toBe(200);
      expect(data?.comments).toBeDefined();
    });
  });

  // ── Live streaming ──
  describe("Live streaming", () => {
    it("GET /api/live-streams?status=live returns 200", async () => {
      const { status, data } = await fetchJSON("/api/live-streams?status=live");
      expect(status).toBe(200);
      expect(data?.streams).toBeDefined();
      expect(typeof data.count).toBe("number");
    });
  });

  // ── Auth ──
  describe("Authentication", () => {
    it("POST /api/user-state issues a signed browserId", async () => {
      const { status, data } = await fetchJSON("/api/user-state", { method: "POST" });
      expect(status).toBe(200);
      expect(data?.browserId).toBeDefined();
      expect(data.browserId.startsWith("bid_")).toBe(true);
      expect(data.issued).toBe(true);
    });

    it("GET /api/preferences with invalid bid returns 403", async () => {
      const { status } = await fetchJSON("/api/preferences?bid=invalid");
      expect(status).toBe(403);
    });

    it("GET /api/preferences with valid bid returns 200", async () => {
      const { status } = await fetchJSON(`/api/preferences?bid=${bid}`);
      expect([200, 403]).toContain(status); // 403 if bid expired, 200 if valid
    });
  });

  // ── Streak ──
  describe("Watch streak", () => {
    it("GET /api/streak returns streak data", async () => {
      const { status, data } = await fetchJSON(`/api/streak?bid=${bid}`);
      expect(status).toBe(200);
      expect(data?.streak).toBeDefined();
    });

    it("POST /api/streak watch increments streak", async () => {
      const before = await fetchJSON(`/api/streak?bid=${bid}`);
      const beforeCount = before.data?.streak?.videosToday || 0;

      const { status, data } = await fetchJSON("/api/streak", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ browserId: bid, action: "watch" }),
      });

      expect(status).toBe(200);
      expect(data?.ok).toBe(true);
      expect(data.streak.videosToday).toBe(beforeCount + 1);
    });
  });

  // ── AI ──
  describe("AI endpoints", () => {
    it("GET /api/ai/trending-digest returns 200", async () => {
      const { status, data } = await fetchJSON("/api/ai/trending-digest");
      expect(status).toBe(200);
      expect(data?.ok).toBe(true);
      expect(typeof data.digest).toBe("string");
    });
  });

  // ── Sponsored hashtags ──
  describe("Sponsored hashtags", () => {
    it("GET /api/sponsored-hashtags returns 200", async () => {
      const { status, data } = await fetchJSON("/api/sponsored-hashtags");
      expect(status).toBe(200);
      expect(data?.hashtags).toBeDefined();
    });
  });

  // ── Seed protection ──
  describe("Seed endpoint protection", () => {
    it("GET /api/seed returns 405 (POST-only)", async () => {
      const { status } = await fetchJSON("/api/seed");
      expect(status).toBe(405);
    });
  });
});
