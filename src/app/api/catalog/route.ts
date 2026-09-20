import { NextResponse } from "next/server";

/**
 * GET /api/catalog
 *
 * Per spec §71: "Every major capability should have a modular boundary/API.
 * Potential domains: Auth API, User API, Profile API, Video API, Playback API,
 * Search API, Recommendation API, Discovery API, Playlist API, Library API,
 * Comment API, Moderation API, Creator API, Live API, Analytics API, Rights API,
 * Transcript API, Subtitle API, AI API, Notification API, Advertising API,
 * Payment API, Media Delivery API."
 *
 * Returns a catalog of all API domains in Mashahd, organized by capability.
 * This serves as the modular API boundary documentation (§71).
 */

const API_CATALOG = [
  {
    domain: "Auth",
    specSection: "§57",
    endpoints: [
      { method: "POST", path: "/api/auth/register", description: "Register with email/phone/username" },
      { method: "POST", path: "/api/auth/login", description: "Login with identifier + password" },
      { method: "POST", path: "/api/auth/logout", description: "Logout (invalidate session)" },
      { method: "POST", path: "/api/auth/session", description: "Verify session token" },
      { method: "GET", path: "/api/auth/check-username", description: "Check username availability" },
    ],
  },
  {
    domain: "User / Profile",
    specSection: "§55-56,§69",
    endpoints: [
      { method: "GET/POST", path: "/api/preferences", description: "Get/set user preferences (25+ fields)" },
      { method: "GET", path: "/api/data-export", description: "GDPR-style full data export" },
      { method: "GET/POST/DELETE", path: "/api/sessions", description: "Active sessions + device management (§57)" },
      { method: "GET/POST", path: "/api/sync", description: "Cross-device state sync (§59)" },
      { method: "GET/POST/PATCH/DELETE", path: "/api/interest-profiles", description: "Multiple recommendation contexts (§28)" },
    ],
  },
  {
    domain: "Video",
    specSection: "§33-44",
    endpoints: [
      { method: "GET", path: "/api/videos", description: "List videos with 8 sort options + pagination (§12)" },
      { method: "GET", path: "/api/videos/[id]", description: "Get video + like/dislike state" },
      { method: "POST", path: "/api/videos/[id]/views", description: "Increment view count (rate limited)" },
      { method: "POST", path: "/api/videos/[id]/like", description: "Like/dislike with mutual exclusion (§22)" },
      { method: "POST", path: "/api/videos/[id]/share", description: "Share with 5 types (§44)" },
      { method: "GET", path: "/api/videos/[id]/context", description: "Information context (§65)" },
      { method: "POST", path: "/api/videos/[id]/live-to-vod", description: "Convert live to VOD (§46)" },
      { method: "GET", path: "/api/videos/[id]/renditions", description: "List playback resolutions (§35 multi-resolution choice)" },
      { method: "POST", path: "/api/videos/[id]/comments/[commentId]/like", description: "Like/dislike a comment (Pass 50)" },
    ],
  },
  {
    domain: "Recommendation / Discovery",
    specSection: "§6-11,§63-64,§70",
    endpoints: [
      { method: "GET", path: "/api/feed/for-you", description: "Personalized FYP with 6 modes + reasons (§6-9)" },
      { method: "GET", path: "/api/feed/discovery", description: "Intentional discovery — different content (§63)" },
      { method: "GET", path: "/api/feed/diversity", description: "Diversity-optimized feed (§64)" },
      { method: "POST/DELETE", path: "/api/recommendation-feedback", description: "Negative controls with real effects (§10)" },
      { method: "GET/POST/DELETE", path: "/api/blocks", description: "Topic/keyword/creator blocking (§11)" },
      { method: "POST", path: "/api/reset-recommendations", description: "Reset with preservation options (§27)" },
      { method: "GET", path: "/api/recommendation-changelog", description: "Recommendation profile transparency (§70)" },
    ],
  },
  {
    domain: "Search",
    specSection: "§12-15",
    endpoints: [
      { method: "GET", path: "/api/videos?q=...&sort=...", description: "Search with 8 deterministic sorts (§12)" },
    ],
  },
  {
    domain: "Playlist / Library",
    specSection: "§29-31",
    endpoints: [
      { method: "GET/POST/DELETE", path: "/api/playlists", description: "Playlist CRUD" },
      { method: "GET/POST/DELETE", path: "/api/playlists/[id]/items", description: "Items with watched/unwatched filter (§29)" },
      { method: "GET/POST/PATCH/DELETE", path: "/api/playlist-folders", description: "Folders with 1-level nesting (§29)" },
      { method: "GET/POST/DELETE", path: "/api/smart-playlists", description: "Rule-based dynamic playlists (§30)" },
      { method: "GET", path: "/api/smart-playlists/[id]/resolve", description: "Resolve rules to matching videos" },
    ],
  },
  {
    domain: "Comment / Moderation",
    specSection: "§22-24",
    endpoints: [
      { method: "GET/POST", path: "/api/videos/[id]/comments", description: "Comments with 6 sort options (§22)" },
    ],
  },
  {
    domain: "Creator / Studio",
    specSection: "§49-52",
    endpoints: [
      { method: "GET", path: "/api/channels/[id]/studio", description: "Creator Studio dashboard (§49)" },
      { method: "GET", path: "/api/channels/[id]/distribution", description: "Distribution diagnostics (§50)" },
      { method: "GET", path: "/api/channels/[id]/export", description: "Creator data portability (§52)" },
      { method: "GET/POST", path: "/api/videos/[id]/corrections", description: "Creator corrections + viewer notification (§66)" },
      { method: "PATCH", path: "/api/videos/[id]/corrections", description: "Notify viewers of corrections (§66)" },
    ],
  },
  {
    domain: "Live Streaming",
    specSection: "§45-46",
    endpoints: [
      { method: "GET/POST", path: "/api/live-streams", description: "List live streams + create new (Pass 47)" },
      { method: "GET/PATCH/DELETE", path: "/api/live-streams/[id]", description: "Get / update viewer count / end a stream (Pass 47)" },
      { method: "GET/POST/PATCH", path: "/api/videos/[id]/polls", description: "Live polls with vote + close (§45)" },
      { method: "GET/POST/PATCH", path: "/api/videos/[id]/qa", description: "Live Q&A with answer + upvote (§45)" },
    ],
  },
  {
    domain: "Rights",
    specSection: "§24,§53-54",
    endpoints: [
      { method: "GET/POST", path: "/api/videos/[id]/rights-claims", description: "Rights claims with transparency (§53-54)" },
      { method: "GET/POST/PATCH", path: "/api/rights-claims/[id]/disputes", description: "Appeal workflow (§24)" },
    ],
  },
  {
    domain: "AI",
    specSection: "§38-40,§74",
    endpoints: [
      { method: "POST", path: "/api/ai/summarize", description: "AI recap/summary" },
      { method: "POST", path: "/api/ai/chapters", description: "Smart chapters" },
      { method: "POST", path: "/api/ai/oracle", description: "Ask this video (Q&A)" },
      { method: "GET", path: "/api/ai/transcript", description: "Chaptered transcript" },
      { method: "POST", path: "/api/ai/translate", description: "Live comment translation" },
      { method: "POST", path: "/api/ai/tone", description: "Tone analysis" },
      { method: "POST", path: "/api/ai/starters", description: "Comment starters" },
      { method: "GET", path: "/api/ai/trending-digest", description: "AI trending digest" },
      { method: "POST", path: "/api/ai/search-in-video", description: "Find where a topic is discussed (§38)" },
      { method: "POST", path: "/api/ai/multi-video-research", description: "Multi-video analysis (§40)" },
    ],
  },
  {
    domain: "Notification",
    specSection: "§47,§70",
    endpoints: [
      { method: "GET/POST", path: "/api/notifications", description: "DB-backed notifications + mark read" },
    ],
  },
  {
    domain: "Advertising",
    specSection: "§61",
    endpoints: [
      { method: "GET/POST", path: "/api/videos/[id]/ad-disclosures", description: "Ad transparency with 4 types (§61)" },
    ],
  },
  {
    domain: "Media Delivery",
    specSection: "§72",
    endpoints: [
      { method: "GET", path: "/api/media/health", description: "Media pipeline health" },
      { method: "POST", path: "/api/media/telemetry", description: "Playback telemetry" },
      { method: "GET", path: "/api/media/videos", description: "Media videos list" },
      { method: "POST", path: "/api/media/presign-upload", description: "Presign upload URL" },
      { method: "POST", path: "/api/media/upload-complete", description: "Complete upload" },
      { method: "POST", path: "/api/media/videos/[id]/upload", description: "Direct upload (protected)" },
      { method: "GET", path: "/api/media/videos/[id]/playback", description: "Playback authorization" },
      { method: "GET", path: "/api/media/videos/[id]/status", description: "Processing status" },
      { method: "DELETE", path: "/api/media/videos/[id]/delete", description: "Delete video (admin-only)" },
      { method: "GET", path: "/api/media/videos/[id]/manifest/[...path]", description: "HLS manifest serving" },
    ],
  },
  {
    domain: "Clips",
    specSection: "§43",
    endpoints: [
      { method: "GET/POST", path: "/api/clips", description: "Clips with clipPolicy enforcement (§43)" },
      { method: "GET", path: "/api/clips/[id]", description: "Get a single clip" },
    ],
  },
  {
    domain: "Continue Watching",
    specSection: "§32",
    endpoints: [
      { method: "GET/POST/DELETE", path: "/api/continue-watching", description: "Cross-device resume positions (§32)" },
    ],
  },
  {
    domain: "Video Relationships",
    specSection: "§41",
    endpoints: [
      { method: "GET/POST/DELETE", path: "/api/videos/[id]/relationships", description: "Video relationship graph (§41)" },
    ],
  },
  {
    domain: "Platform",
    specSection: "§67,§77",
    endpoints: [
      { method: "GET", path: "/api/ready", description: "Readiness check" },
      { method: "GET", path: "/api/cost-dashboard", description: "Unified cost dashboard" },
      { method: "GET", path: "/api/metrics", description: "System metrics" },
      { method: "GET", path: "/api/analytics", description: "Neon analytics (501 if not configured)" },
      { method: "GET", path: "/api/decisions", description: "Admin decision explanations" },
      { method: "GET", path: "/api/premium", description: "Premium features (§62)" },
      { method: "GET", path: "/api/platform-changelog", description: "Platform change log (§67)" },
      { method: "GET", path: "/api/catalog", description: "This API catalog (§71)" },
    ],
  },
];

export async function GET() {
  const totalEndpoints = API_CATALOG.reduce((sum, domain) => sum + domain.endpoints.length, 0);
  return NextResponse.json({
    generatedAt: new Date().toISOString(),
    totalDomains: API_CATALOG.length,
    totalEndpoints,
    domains: API_CATALOG,
    principle: "Per spec §71: Every major capability should have a modular boundary/API. Per spec §82: Before adding any API, inspect whether an equivalent API already exists. Reuse and extend rather than duplicate.",
  });
}
