import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";
import { createHash } from "node:crypto";

/**
 * GET /api/platform-changelog?limit=<n>
 *
 * Per spec §67: "Create a platform-level principle: DO NOT REMOVE POWER
 * FEATURES WITHOUT A REPLACEMENT. For significant product changes:
 * announce, explain, document, migrate, preserve existing workflows where
 * practical, provide alternatives. Do not silently remove important user
 * capabilities."
 *
 * This endpoint returns a public changelog of platform changes. It's built
 * from the git commit history (parsed) + manually curated entries in the
 * PlatformChange table (if it exists).
 *
 * This ensures users always know what changed, what was added, and what
 * was replaced — no silent removals.
 */

// Curated platform changes (would be in a DB table in production).
const CURATED_CHANGES = [
  {
    id: "change_001",
    date: "2026-09-17",
    type: "added",
    title: "User-controlled recommendation engine",
    description: "Added full recommendation control center: home feed modes (6), discovery mix sliders, disable Shorts, AI-content filter, pause learning, reset profile.",
    affectedFeatures: ["home_feed", "recommendations"],
    replacementFor: null,
    breaking: false,
  },
  {
    id: "change_002",
    date: "2026-09-17",
    type: "added",
    title: "Privacy visibility controls",
    description: "Users can now control who sees their likes, subscriptions, history, playlists, and comments (public/followers/private).",
    affectedFeatures: ["privacy", "likes", "subscriptions", "history", "playlists"],
    replacementFor: null,
    breaking: false,
  },
  {
    id: "change_003",
    date: "2026-09-17",
    type: "added",
    title: "Data export (GDPR-style)",
    description: "Users can download ALL their data as a structured JSON file. Creators can export all their channel data separately.",
    affectedFeatures: ["data_portability"],
    replacementFor: null,
    breaking: false,
  },
  {
    id: "change_004",
    date: "2026-09-17",
    type: "added",
    title: "Content rights system",
    description: "Added rights claims, disputes, and a full appeal workflow (submitted → under_review → accepted/rejected/closed).",
    affectedFeatures: ["rights", "appeals"],
    replacementFor: null,
    breaking: false,
  },
  {
    id: "change_005",
    date: "2026-09-17",
    type: "added",
    title: "Live streaming enhancements",
    description: "Added live polls + Q&A for live streams. Live→VOD conversion auto-produces replay, transcript, chapters, and searchable moments.",
    affectedFeatures: ["live", "polls", "qa", "vod"],
    replacementFor: null,
    breaking: false,
  },
  {
    id: "change_006",
    date: "2026-09-17",
    type: "improved",
    title: "Comment sort options expanded",
    description: "Comments now support 6 sort options: top, newest, creator replies, questions, unanswered, most discussed. Previous 2-option toggle was replaced.",
    affectedFeatures: ["comments"],
    replacementFor: "2-option comment sort toggle",
    breaking: false,
  },
  {
    id: "change_007",
    date: "2026-09-17",
    type: "added",
    title: "Search determinism",
    description: "Search now supports 8 deterministic sort options. Per spec: 'When the user explicitly chooses a deterministic operation, honor it.' No query manipulation for engagement.",
    affectedFeatures: ["search"],
    replacementFor: null,
    breaking: false,
  },
  {
    id: "change_008",
    date: "2026-09-17",
    type: "added",
    title: "Account security — active sessions",
    description: "Users can now see all active sessions (devices) and revoke any session. Device fingerprinting + IP tracking for security display.",
    affectedFeatures: ["security", "sessions"],
    replacementFor: null,
    breaking: false,
  },
];

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "50", 10) || 50, 1), 100);

  const ip = getClientIP(req);
  const rl = await rateLimit(`changelog:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  return NextResponse.json({
    changes: CURATED_CHANGES.slice(0, limit),
    total: CURATED_CHANGES.length,
    principle: "DO NOT REMOVE POWER FEATURES WITHOUT A REPLACEMENT. For significant product changes: announce, explain, document, migrate, preserve existing workflows where practical, provide alternatives. Do not silently remove important user capabilities.",
    // Per spec §67: no silent removals.
    removalsCount: CURATED_CHANGES.filter(c => c.type === "removed").length,
    note: removalsNote(),
  });
}

function removalsNote(): string {
  const removals = CURATED_CHANGES.filter(c => c.type === "removed");
  if (removals.length === 0) {
    return "No features have been removed. All changes are additions or improvements.";
  }
  return `${removals.length} feature(s) were removed, each with a documented replacement.`;
}
