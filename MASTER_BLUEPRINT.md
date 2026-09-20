# MASHAHD — MASTER PLATFORM BLUEPRINT
## Single Authoritative Technical + Product Source of Truth

**Document version**: 1.0 (Pass 54)
**Last updated**: 2026-09-20
**Author**: Lead AI Platform Architect (CTO + COO + Principal Systems Engineer)
**Inspection basis**: Deep discovery audit (Task ID: DEEP-DISCOVERY-54) — verified against actual code, endpoints, and database

---

## CURRENT STATE VERIFICATION SUMMARY

This blueprint is built on **verified facts** from a deep discovery audit. The platform was inspected end-to-end: 97 API routes, 42 Prisma models, 52 components, 2 mini-services, 2 test files. Production (mashahd.vercel.app) returns 200 on all 8 smoke-test endpoints. The 5-service stack (GitHub + Vercel + Inngest + Neon + Turso) is HEALTHY on the production cost-dashboard. Turso DB has real data (34 Videos, 12 Channels, 88 Comments, 3 Users, 4 Sessions). TypeScript: 0 errors. ESLint: 0 errors. The platform is production-deployed and operational.

**Key uncertainty**: AI provider API keys are absent from the local `.env` (all 5 report NOT_CONFIGURED locally) but report `true` on the production cost-dashboard — they appear to be set on the Vercel project directly. This needs verification.

---

# 1. EXECUTIVE SUMMARY

Mashahd (مشاهِد) is the video pillar of the CIRKLE super-app — a zero-cost, edge-first, user-controlled media platform built on Next.js 16. It combines a YouTube-like viewing experience with TikTok-style Shorts, live streaming, AI-powered content understanding, and a P2P media fabric for zero-cost video delivery.

**Current state**: The platform is production-deployed at mashahd.vercel.app with a 5-service zero-cost stack (GitHub + Vercel + Inngest + Neon + Turso). It has 97 API routes, 42 database models, 52 UI components, real video upload, real live streaming (broadcaster + viewer), multi-resolution quality selection, comment likes + moderation, signed-browserId authentication, and P2P-accelerated HLS playback.

**Architecture choice**: The platform uses a hybrid transactional/analytics database split — Turso (libSQL) for transactional data (the authoritative control plane) and Neon (Postgres) for analytics + disaster recovery. Media storage uses local filesystem in dev (Vercel's filesystem is read-only in production, so new uploads are ephemeral on Vercel — a documented trade-off).

**Zero-cost model**: $0/month. No billing details required by any service. The 5-service free-tier stack covers: source control (GitHub), deployment (Vercel), durable workflows (Inngest), analytics (Neon), transactional DB (Turso). AI providers (Groq, OpenRouter, NVIDIA, Gemini, HF) are all free-tier.

**Critical gaps**: (1) Comment moderation UI not wired (backend exists), (2) AI keys absent locally, (3) Production uploads ephemeral (read-only FS), (4) 22 API routes lack rate limiting, (5) Tests reference removed services (Brevo/Filebase).

---

# 2. PLATFORM MISSION

**Purpose**: Mashahd is a video discovery + streaming platform that gives users control over their content experience while keeping platform costs at zero.

**Core problem solved**: Mainstream video platforms (YouTube, TikTok) operate opaque recommendation engines, monetize user data, and impose costs on creators. Mashahd provides a transparent, user-controlled alternative where: the recommendation engine is fully tunable, privacy controls are first-class, creators own their audience, and the platform costs $0/month to operate.

**Target users**:
- **Viewers**: People who want to discover + watch videos without algorithmic manipulation
- **Creators**: People who want to publish videos, go live, and build an audience without platform fees
- **Power users**: People who want fine-grained control over their feed, quality, and data

**User categories**:
- Anonymous (signed browserId — no signup required)
- Registered (email/phone, username, password)
- Creator (owns channels, uploads videos, goes live)
- Channel team member (owner/manager/editor/viewer roles)

**Primary value propositions**:
1. **Zero-cost**: $0/month, no billing details, no payment card
2. **User-controlled**: 6 home feed modes, discovery mix sliders, disable Shorts, AI-content filter, pause learning, reset profile
3. **Privacy-first**: visibility controls for likes/subscriptions/history/playlists/comments
4. **Real live streaming**: DB-backed, real-time chat over WebSocket, real viewer counts
5. **AI-native**: every video comes with AI Recap, Smart Chapters, Oracle Q&A, comment translation
6. **P2P acceleration**: WebRTC peer-to-peer segment delivery reduces origin bandwidth
7. **Multi-resolution**: adaptive bitrate streaming (hls.js ABR + manual quality selection)

**Platform boundaries**:
- Mashahd is a video module of the CIRKLE super-app, not a standalone product
- Mashahd does NOT handle payments, SMS, or non-video content
- Mashahd does NOT replace the super-app's auth system (uses signed browserId for anonymous identity)

**Explicit non-goals**:
- Not a YouTube clone (different recommendation philosophy)
- Not a TikTok clone (no ephemeral Stories — documented as intentionally excluded)
- Not a paid platform (no billing, no premium tier that costs money)
- Not a social network (no DMs, no friend graph — community happens around videos)

---

# 3. PRODUCT SCOPE

**In scope**:
- Video discovery (home feed, search, categories, trending)
- Video playback (HLS with P2P acceleration, multi-resolution, quality persistence)
- Video upload (multipart form, local storage in dev)
- Live streaming (broadcaster + viewer, real chat, presence, viewer count)
- Shorts (TikTok-style vertical feed)
- Channels (creation, roles, revenue transparency, distribution diagnostics)
- Comments (threaded, 6 sort options, likes, pin/delete moderation, AI translation)
- Playlists (folders, smart playlists, save-to-playlist)
- Clips (clip a segment, permalink to a moment)
- AI features (Recap, Chapters, Oracle, comment starters, trending digest, comment translation)
- Recommendations (6 feed modes, discovery mix, reset, pause learning)
- Privacy (visibility controls, data export, account sessions)
- Notifications (in-app, notification preferences)
- P2P media fabric (WebRTC peer-to-peer segment delivery)
- Watch party (synchronized co-watching with chat)

**Out of scope (intentionally excluded)**:
- Payments/billing (no payment card required by any service)
- SMS (customer-funded, not platform-paid — currently NOT_CONFIGURED)
- Email (Brevo was removed in Pass 53 — email service exists but no provider)
- Cloud media storage (R2 + Filebase removed in Pass 53 — local-only)
- Stories/ephemeral content (documented as intentionally excluded)
- Community text posts (documented as a gap — not implemented)
- Per-creator paid memberships (only platform-level premium exists)

---

# 4. CURRENT-STATE ASSESSMENT

## CURRENT PLATFORM STATE

| Component | Status | Verification |
|---|---|---|
| Next.js 16 App Router | IMPLEMENTED AND VERIFIED | `next.config.ts`, dev server 200 |
| Turso DB (libSQL) | IMPLEMENTED AND VERIFIED | cost-dashboard HEALTHY, 34 videos |
| Neon Postgres (analytics) | IMPLEMENTED AND VERIFIED | `/api/analytics?days=7` returns ok=true |
| Inngest (workflows) | IMPLEMENTED AND VERIFIED | endpoint reachable, signature verification working |
| Vercel (deployment) | IMPLEMENTED AND VERIFIED | mashahd.vercel.app 8/8 endpoints 200 |
| GitHub (source control) | IMPLEMENTED AND VERIFIED | push works, repo up-to-date |
| Prisma schema (42 models) | IMPLEMENTED AND VERIFIED | `bun run db:push` in sync |
| Signed browserId (HMAC) | IMPLEMENTED AND VERIFIED | `verifyBrowserId()` in all POST routes |
| Rate limiting | PARTIALLY IMPLEMENTED | 75/97 routes use it; 22 lack it |
| Video upload (POST /api/videos) | IMPLEMENTED AND VERIFIED | curl test: 200, file on disk, DB row created |
| Media serving (Range support) | IMPLEMENTED AND VERIFIED | `/api/media/uploads/[filename]` 200 |
| Live streaming (broadcaster) | IMPLEMENTED AND VERIFIED | POST/PATCH/DELETE work, watch-party WS |
| Live streaming (viewer) | IMPLEMENTED AND VERIFIED | live-stream-view.tsx, join via WS |
| Live now shelf | IMPLEMENTED AND VERIFIED | auto-refreshes, hides when empty |
| Past streams (profile) | IMPLEMENTED AND VERIFIED | scoped to user's bid |
| Multi-resolution selector | IMPLEMENTED AND VERIFIED | hls.js levels + Auto, preference persisted |
| Comment likes | IMPLEMENTED AND VERIFIED | POST /like, optimistic UI, double-like prevention |
| Comment moderation (backend) | IMPLEMENTED BUT NOT FULLY VERIFIED | endpoint exists, UI NOT WIRED |
| AI providers (5) | PARTIALLY IMPLEMENTED | prod: all 5 HEALTHY; local: all 5 NOT_CONFIGURED |
| P2P media fabric | IMPLEMENTED AND VERIFIED | p2p-tracker port 3003, p2p-media-loader-hlsjs |
| Watch party | IMPLEMENTED AND VERIFIED | port 3004, sync/presence/chat |
| Protected files (101) | IMPLEMENTED AND VERIFIED | verify-protected.sh exit 0 |
| .env anti-strip | IMPLEMENTED AND VERIFIED | ensure-env.sh wired to predev/prebuild/prestart |
| Git hooks (pre-commit, pre-push) | IMPLEMENTED AND VERIFIED | block deletions + rollback |
| Backup system | IMPLEMENTED AND VERIFIED | backup.sh retains 6 backups |
| Tests (2 files) | PRESENT BUT BROKEN | reference removed Brevo/Filebase/SMS modules |
| Cloudflare R2 | INTENTIONALLY EXCLUDED | removed in Pass 53 |
| Filebase | INTENTIONALLY EXCLUDED | removed in Pass 53 |
| Brevo (email) | INTENTIONALLY EXCLUDED | removed in Pass 53 |
| Video upload on Vercel prod | PRESENT BUT BROKEN | read-only FS — uploads ephemeral |
| Creator comment moderation UI | MISSING | backend exists, no Pin/Delete buttons |

---

# 5. EXISTING ARCHITECTURE

## System Architecture (OBSERVED)

```
USER / CLIENT (browser)
       ↓
FRONTEND (Next.js 16, React, Tailwind, shadcn/ui)
       ↓
API GATEWAY (Next.js Route Handlers — /api/*)
       ↓
AUTHENTICATION (signed browserId HMAC-SHA256)
       ↓
AUTHORIZATION (verifyBrowserId + channel ownership checks)
       ↓
BUSINESS LOGIC (route handlers + lib/ modules)
       ↓
SERVICES (mini-services: p2p-tracker, watch-party)
       ↓
AI / AUTOMATION (5 providers with fallback: Groq→OpenRouter→NVIDIA→Gemini→HF)
       ↓
DATABASE (Turso libSQL — transactional, Neon Postgres — analytics)
       ↓
CACHE (in-memory, TanStack Query client-side)
       ↓
STORAGE (local filesystem — dev; read-only on Vercel prod)
       ↓
QUEUES / JOBS (Inngest durable workflows)
       ↓
EXTERNAL INTEGRATIONS (GitHub, Vercel, Inngest, Neon, Turso)
       ↓
OBSERVABILITY (cost-dashboard, /api/ready, dev.log)
       ↓
ADMIN / OPERATIONS (no admin console — cost-dashboard is the closest)
```

### Layer responsibilities:

**FRONTEND**: 52 components under `src/components/youtube/`. Views dispatched from `src/app/page.tsx` based on `useAppStore` view kind (home/watch/channel/search/trending/subs/history/liked/library/category/settings/profile/favorites/watchLater/playlist/clip/recommendationProfile/shorts/live). State: Zustand (app-store) + TanStack Query (server state). Styling: Tailwind CSS 4 + shadcn/ui (New York style). Icons: Lucide.

**API GATEWAY**: 97 route.ts files under `src/app/api/`. All use Next.js Route Handlers (no server actions per project rule). Each route is self-contained — imports `db` from `@/lib/db`, `verifyBrowserId` + `rateLimit` as needed.

**AUTHENTICATION**: `src/lib/browser-id-security.ts` — HMAC-SHA256 signed browserId. Format: `bid_<base64url(id)>.<base64url(hmac)>`. Server issues on first request via POST /api/user-state. Client caches in localStorage. Secret: `BROWSER_ID_SECRET` env var (stable, anti-stripped by ensure-env.sh). Falls back to per-process random secret in dev if env var missing (invalidates all browserIds on restart — now permanently fixed).

**AUTHORIZATION**: `verifyBrowserId(bid)` returns `{ valid, id, legacy }`. Used in all POST/PATCH/DELETE routes. Channel ownership checked via `channel.ownerId === verification.id` OR `channel.links.includes("owner:<bid-id>")` (anonymous ownership pattern).

**BUSINESS LOGIC**: Distributed across route handlers + `src/lib/` modules (58 lib files). No separate service layer — routes call `db.*` directly. This is intentional for a zero-cost edge deployment (no separate API server to pay for).

**SERVICES**: 2 mini-services (separate bun processes):
- `mini-services/p2p-tracker/` (port 3003) — WebSocket signaling for P2P segment exchange
- `mini-services/watch-party/` (port 3004) — WebSocket for co-watch sync, presence, chat

**AI**: `src/lib/ai-provider.ts` — multi-provider with fallback chain: Groq → OpenRouter → NVIDIA → Gemini → HF. All free-tier. Used by `/api/ai/*` routes (chapters, oracle, starters, trending-digest, comment-translation). Falls back to static content if all providers fail.

**DATABASE**: `src/lib/db.ts` — `getDb()` checks for Turso env vars. If TURSO_URL + TURSO_AUTH_TOKEN set, uses Turso (via `src/lib/turso-db.ts` wrapper over `@libsql/client`). Falls back to Prisma + local SQLite. The Turso wrapper auto-creates all 42 tables on cold start via `ensureAllTables()` (CREATE TABLE IF NOT EXISTS + indexes).

**CACHE**: In-memory only (no Redis — zero-cost). TanStack Query for client-side caching with `staleTime` + `refetchInterval`. Server-side: no cache layer (each request hits the DB).

**STORAGE**: `src/lib/storage.ts` — `getStorage()` returns LocalFilesystemStorage (only option after Pass 53 restructure). Cloud providers (R2, Filebase) were removed. On Vercel production, the filesystem is read-only except `/tmp` (ephemeral) — uploads work in dev, viewing works everywhere.

**QUEUES / JOBS**: Inngest for durable workflows. `/api/inngest` endpoint with webhook signature verification (INNGEST_WEBHOOK_SECRET). Used for: media processing, email sending (removed), scheduled tasks.

**OBSERVABILITY**: `/api/cost-dashboard` (service health + DB stats + circuit breakers), `/api/ready` (readiness check), `/api/platform-changelog` (change history). Dev: `dev.log` (tee'd from next dev). No external monitoring (zero-cost).

---

# 6. TARGET ARCHITECTURE

The target architecture IS the current architecture — the platform is already structured for optimum zero-cost production. No major architectural changes are recommended.

**Target state**: The 5-service stack (GitHub + Vercel + Inngest + Neon + Turso) with local media storage in dev + a future cloud storage provider when the user enables one.

**What would change if the user re-adds cloud storage**:
- Set `STORAGE_PROVIDER=r2` (or `filebase`) in `.env` + on Vercel
- The `getStorage()` factory would need re-wiring (currently simplified to local-only in Pass 53)
- The `server-lib/r2-storage.ts` + `server-lib/filebase-storage.ts` providers still exist — just need to be re-imported in `storage.ts`

**What should NOT change**:
- The 5-service stack (don't re-add Filebase/Cloudflare/Brevo per user's Pass 53 directive)
- The Turso + Neon split (transactional + analytics)
- The signed browserId auth (proven secure)
- The mini-services architecture (p2p-tracker + watch-party)
- The 42-model Prisma schema (covers all spec domains)

---

# 7. ARCHITECTURE PRINCIPLES

1. **Zero-cost by default**: No service requires billing details. All 5 production services are free-tier. No payment card.
2. **Edge-first**: Next.js serverless functions run at the edge. Database is Turso (libSQL edge database).
3. **User-controlled**: Every recommendation/privacy/quality choice is tunable + persisted.
4. **Real, not mocked**: Every feature touches the DB or WebSocket — no mock data, no FAKE_ constants.
5. **Evolution, not replacement**: Don't rewrite working systems. Add to them.
6. **Protected files**: 101 critical files are protected against deletion (verify-protected.sh + git hooks).
7. **Anti-strip**: `.env` is anti-stripped by ensure-env.sh (runs on every predev/prebuild/prestart).
8. **Honest verification**: Use VERIFIED/UNVERIFIED/UNKNOWN labels. Don't claim something works without testing.
9. **No server actions**: All mutations go through API routes (per project rule).
10. **Single port**: Only port 3000 is exposed externally. Mini-services use `XTransformPort` query param via the Caddy gateway.

---

# 8. TECHNOLOGY STACK

| Layer | Technology | Version | Cost |
|---|---|---|---|
| Framework | Next.js 16 (App Router, Turbopack) | 16.1.3 | Free |
| Language | TypeScript 5 | 5.x | Free |
| Styling | Tailwind CSS 4 | 4.x | Free |
| UI Components | shadcn/ui (New York) + Lucide icons | latest | Free |
| State (client) | Zustand | latest | Free |
| State (server) | TanStack Query | latest | Free |
| Database (transactional) | Turso (libSQL) | — | Free (9GB, 1B reads/month) |
| Database (analytics) | Neon Postgres | — | Free (0.5GB) |
| ORM | Prisma 6 + libSQL adapter | 6.19.2 | Free |
| Deployment | Vercel | — | Free (Hobby) |
| Source control | GitHub | — | Free |
| Workflows | Inngest | — | Free |
| HLS player | hls.js | latest | Free |
| P2P engine | p2p-media-loader-hlsjs | latest | Free |
| WebSocket | ws (mini-services) | latest | Free |
| AI providers | Groq, OpenRouter, NVIDIA, Gemini, HF | — | Free-tier |
| Video processing | FFmpeg (local) | 7.1.5 | Free |

**No paid services. No billing details. $0/month.**

---

# 9. SYSTEM COMPONENTS

## 9.1 Frontend Components (52 files in src/components/youtube/)

**Main views**: home-view, watch-view, channel-view, category-view, settings-view, profile-view, search/list-views, playlist-view, clip-view, recommendation-profile-view, shorts-feed-view, live-stream-view

**Player**: mashahd-player (HLS + P2P + multi-resolution), mashahd-player-lazy, mini-player

**Live streaming**: go-live (broadcaster), live-stream-view (viewer), live-now-shelf (home), past-streams (profile)

**Shelves**: shorts-shelf, continue-watching-shelf, live-now-shelf

**Overlays**: header (search + Go Live + Create), header-overlays (CreateButton with real upload, ShareButton, NotificationsButton), dock (5 primary tabs), sidebar, footer

**AI panels**: ai-recap, ai-watch-panel, trending-digest

**Comments**: comment-meta, watch-view comments section (6 sort options, threaded, likes, pin/delete backend)

**Utility**: video-card, avatar-picker, auth-screen, bullet-comments, category-chips, circle-pulse, clip-dialog, command-palette, end-screen, keyboard-shortcuts, mood-filter, onboarding-tour, save-to-playlist, smart-chapters, smart-playlist-creator, splash, user-avatar

## 9.2 Backend API Routes (97 files in src/app/api/)

Organized into 18 domains (per /api/catalog):
1. Auth (check-username, login, logout, register, session)
2. User / Profile (user-state, preferences, sync, data-export, avatar)
3. Video (videos, views, like, share, context, live-to-vod, renditions)
4. Recommendation / Discovery (feed, continue-watching, recommendations, sponsored-hashtags)
5. Search (videos?search)
6. Playlist / Library (playlists, items, folders, smart-playlists)
7. Comment / Moderation (comments, like, moderate, comment-meta)
8. Creator / Studio (channels, roles, revenue, studio, distribution, export)
9. Live Streaming (live-streams, polls, qa)
10. Rights (rights-claims, disputes)
11. AI (chapters, oracle, starters, trending-digest, comment-translation)
12. Notification (notifications, preferences)
13. Advertising (ad-disclosures, sponsored-hashtags)
14. Media Delivery (media/uploads, media/telemetry, media/videos, manifest)
15. Clips (clips)
16. Continue Watching (continue-watching)
17. Video Relationships (relationships, corrections)
18. Platform (ready, catalog, cost-dashboard, platform-changelog, seed, inngest, analytics, decisions, premium, metrics, quotas)

## 9.3 Mini-Services (2 services)

### p2p-tracker (port 3003)
- WebSocket signaling server for P2P WebRTC peer connections
- Tracks active peers per video swarm
- Brokers SDP offers/answers + ICE candidates
- Heartbeat-based liveness (expires inactive peers)
- Max 6 peers per viewer (bounded participation)

### watch-party (port 3004)
- WebSocket server for synchronized co-watching
- Party rooms with 6-char codes
- Host-controlled playback sync (play/pause/seek)
- Real-time presence (who's watching)
- Live chat (max 4KB per message, max 12 members)
- Heartbeat + 60s timeout
- Used by both watch-party.tsx (co-watch) + go-live.tsx (live chat)

## 9.4 Library Modules (58 files in src/lib/)

**Database**: db.ts, turso-db.ts (Turso wrapper with ensureAllTables), neon-analytics.ts, neon-recovery.ts

**Auth**: browser-id-security.ts (HMAC signed browserId)

**Security**: rate-limiter.ts, circuit-breaker.ts

**Storage**: storage.ts (LocalFilesystemStorage), blob-storage.ts, storage-quota-governor.ts, storage-replication.ts

**AI**: ai-provider.ts (multi-provider fallback)

**Media**: media-object.ts, media-transport.ts, media-worker.ts, demand-transcoder.ts, delivery-scheduler.ts, local-media-cache.ts, lan-optimization.ts, media-reconciliation.ts, mashahd-bridge.ts

**P2P**: p2p-policy.ts (cellular/saveData/background gating)

**Other**: content-gc.ts, decision-record.ts, economy-state.ts, email-service.ts (no provider after Pass 53), failure-taxonomy.ts, feature-flags.ts, format.ts, filebase-storage.ts (removed from factory but file exists), heat-predictor.ts, inngest-jobs.ts, job-manager.ts, metrics-store.ts, migration-safety.ts, notification-service.ts, r2-storage.ts (removed from factory but file exists), seed-data.ts, types.ts, user-state.ts

## 9.5 Server-Lib Modules (2 files in server-lib/)

- `r2-storage.ts` — Cloudflare R2 S3-compatible storage provider (NOT wired after Pass 53)
- `filebase-storage.ts` — Filebase S3 + IPFS storage provider (NOT wired after Pass 53)

Both still exist in case the user re-adds cloud storage.

---

# 10. FEATURE REGISTRY

## FEATURE 1: Video Discovery (Home Feed)
- **ID**: FEAT-001
- **Purpose**: Show users videos they'll like, with full control over the recommendation mix
- **User story**: As a viewer, I want to see a personalized feed of videos so I can discover content
- **Actors**: Viewer (anonymous or registered)
- **Frontend**: home-view.tsx, category-chips.tsx, mood-filter.tsx, trending-digest.tsx, live-now-shelf.tsx, continue-watching-shelf.tsx, shorts-shelf.tsx
- **Backend**: /api/feed/for-you, /api/videos?sort=, /api/sponsored-hashtags, /api/ai/trending-digest, /api/live-streams?status=live, /api/continue-watching
- **Database**: Video, Channel, UserPreference, ContinueWatching, SponsoredHashtag, LiveStream
- **AI**: trending-digest (curated editorial wrap-up)
- **Status**: IMPLEMENTED AND VERIFIED
- **Verification**: home page renders, all shelves work, feed modes toggle

## FEATURE 2: Video Playback (Watch View)
- **ID**: FEAT-002
- **Purpose**: Play a video with full-featured player + context
- **User story**: As a viewer, I want to watch a video with quality selection, chapters, Oracle Q&A, comments
- **Frontend**: watch-view.tsx, mashahd-player.tsx, smart-chapters.tsx, ai-recap.tsx, ai-watch-panel.tsx
- **Backend**: /api/videos/[id], /api/videos/[id]/{views,like,share,context,knowledge-graph,fact-checks,rights-claims,corrections,renditions,comments}
- **Database**: Video, Comment, VideoSource, VideoRendition, VideoManifest, MediaProcessingJob, RightsClaim, RightsDispute, FactCheckNote, VideoCorrection, VideoRelationship, CommentMeta, AdDisclosure, ContentProvenance
- **AI**: chapters, oracle, starters, comment-translation
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 3: Video Upload
- **ID**: FEAT-003
- **Purpose**: Let creators publish videos to the platform
- **User story**: As a creator, I want to upload a video file so it appears on my channel + the home feed
- **Frontend**: header-overlays.tsx (CreateButton), mashahd-player.tsx (playback)
- **Backend**: POST /api/videos (multipart/form-data), GET /api/media/uploads/[filename] (Range serving)
- **Database**: Video, Channel (auto-created "My Uploads" if no channelId)
- **Storage**: LocalFilesystemStorage (dev), read-only on Vercel prod
- **Status**: IMPLEMENTED AND VERIFIED (dev); PRESENT BUT BROKEN (prod — read-only FS)

## FEATURE 4: Live Streaming (Broadcaster)
- **ID**: FEAT-004
- **Purpose**: Let creators go live with a real DB-backed stream
- **User story**: As a creator, I want to click "Go Live" and start broadcasting with real viewer counts + chat
- **Frontend**: go-live.tsx (setup dialog + live control screen)
- **Backend**: POST /api/live-streams, PATCH /api/live-streams/[id], DELETE /api/live-streams/[id]
- **Database**: LiveStream (id, title, status, viewerCount, peakViewerCount, streamKey, watchPartyCode)
- **WebSocket**: watch-party mini-service (port 3004) for live chat
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 5: Live Streaming (Viewer)
- **ID**: FEAT-005
- **Purpose**: Let viewers watch a live stream + participate in chat
- **User story**: As a viewer, I want to click a live stream, join the chat, see real-time viewer count
- **Frontend**: live-stream-view.tsx, live-now-shelf.tsx (home page discovery)
- **Backend**: GET /api/live-streams?status=live, GET /api/live-streams/[id]
- **WebSocket**: use-watch-party.ts hook (join via watchPartyCode)
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 6: Multi-Resolution Quality Selection
- **ID**: FEAT-006
- **Purpose**: Let viewers pick the video resolution (Auto + manual)
- **User story**: As a viewer, I want to choose 480p to save data, or 1080p for quality
- **Frontend**: mashahd-player.tsx (settings popover with Speed + Quality sections)
- **Backend**: GET /api/videos/[id]/renditions
- **Database**: VideoRendition, UserPreference (preferredQuality)
- **HLS**: hls.js levels + ABR (currentLevel = -1 for Auto)
- **Persistence**: preferredQuality saved to /api/preferences POST, loaded on mount
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 7: Comments
- **ID**: FEAT-007
- **Purpose**: Let viewers discuss videos with threaded comments + likes
- **User story**: As a viewer, I want to comment, like comments, sort by top/newest, see creator replies
- **Frontend**: watch-view.tsx (CommentsSection), comment-meta
- **Backend**: GET/POST /api/videos/[id]/comments, POST /api/videos/[id]/comments/[cid]/like, POST /api/videos/[id]/comments/[cid]/moderate
- **Database**: Comment (threaded via parentId), CommentMeta (isQuestion, isCreatorReply, pinnedBy, pinnedAt), UserState (likedCommentIds via "c:" prefix in likedVideoIds)
- **Sort options**: top (default, pinned first), newest, creator_replies, questions, unanswered, most_discussed
- **Status**: IMPLEMENTED AND VERIFIED (likes); IMPLEMENTED BUT NOT FULLY VERIFIED (moderation backend exists, UI NOT WIRED)

## FEATURE 8: Shorts (TikTok-style)
- **ID**: FEAT-008
- **Purpose**: Vertical swipe-to-next video feed
- **User story**: As a viewer, I want to swipe through short videos vertically
- **Frontend**: shorts-feed-view.tsx, shorts-shelf.tsx
- **Backend**: /api/videos?sort=popular (repurposed as shorts)
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 9: Channels
- **ID**: FEAT-009
- **Purpose**: Creator home pages with videos, roles, revenue, analytics
- **User story**: As a creator, I want a channel page that shows my videos + team + revenue
- **Frontend**: channel-view.tsx (with ChannelRolesSection)
- **Backend**: /api/channels, /api/channels/[id]/{roles,revenue,studio,distribution,export}
- **Database**: Channel, ChannelRole, Video
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 10: Playlists
- **ID**: FEAT-010
- **Purpose**: Save + organize videos into playlists
- **User story**: As a viewer, I want to create playlists, add videos, share them
- **Frontend**: playlist-view.tsx, save-to-playlist.tsx, smart-playlist-creator.tsx
- **Backend**: /api/playlists, /api/playlists/[id]/items
- **Database**: Playlist, PlaylistItem, PlaylistFolder, SmartPlaylist
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 11: Clips
- **ID**: FEAT-011
- **Purpose**: Clip a segment of a video + share a permalink to a moment
- **User story**: As a viewer, I want to clip a 30s segment + share it
- **Frontend**: clip-dialog.tsx, clip-view.tsx
- **Backend**: /api/clips, /api/clips/[id]
- **Database**: Clip
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 12: AI Features
- **ID**: FEAT-012
- **Purpose**: AI Recap, Smart Chapters, Oracle Q&A, comment starters, trending digest, comment translation
- **User story**: As a viewer, I want AI to summarize a video, find chapters, answer questions about it
- **Frontend**: ai-recap.tsx, ai-watch-panel.tsx, smart-chapters.tsx, trending-digest.tsx
- **Backend**: /api/ai/{chapters,oracle,starters,trending-digest}
- **AI**: 5-provider fallback chain (Groq → OpenRouter → NVIDIA → Gemini → HF)
- **Status**: PARTIALLY IMPLEMENTED (prod: all 5 providers HEALTHY; local: all 5 NOT_CONFIGURED, fallback to static content)

## FEATURE 13: Recommendations Control Center
- **ID**: FEAT-013
- **Purpose**: Let users control their recommendation engine
- **User story**: As a user, I want to tune my feed mix, disable Shorts, pause learning, reset my profile
- **Frontend**: settings-view.tsx (12 tabs including Recommendations, Discovery, Updates)
- **Backend**: /api/preferences (GET + POST)
- **Database**: UserPreference (25+ fields), RecommendationFeedback, RecommendationChangelog, InterestProfile, SmartPlaylist
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 14: Privacy Controls
- **ID**: FEAT-014
- **Purpose**: Let users control who sees their activity
- **User story**: As a user, I want to make my likes private, my subscriptions followers-only
- **Frontend**: settings-view.tsx (Privacy tab)
- **Backend**: /api/preferences
- **Database**: UserPreference (likesVisibility, subscriptionsVisibility, historyVisibility, playlistsVisibility, commentsVisibility)
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 15: P2P Media Fabric
- **ID**: FEAT-015
- **Purpose**: Reduce origin bandwidth via WebRTC peer-to-peer segment exchange
- **User story**: As a viewer, I want my video to load faster + use less server bandwidth
- **Frontend**: mashahd-player.tsx (p2p-media-loader-hlsjs integration)
- **Backend**: p2p-tracker mini-service (port 3003)
- **Policy**: p2p-policy.ts (gates cellular/saveData/background)
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 16: Watch Party
- **ID**: FEAT-016
- **Purpose**: Synchronized co-watching with friends
- **User story**: As a viewer, I want to watch a video with friends, synced + with chat
- **Frontend**: watch-party.tsx, use-watch-party.ts hook
- **Backend**: watch-party mini-service (port 3004)
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 17: Account Security
- **ID**: FEAT-017
- **Purpose**: Active sessions, device management
- **User story**: As a user, I want to see my active sessions + revoke any
- **Frontend**: settings-view.tsx (Security tab)
- **Backend**: /api/preferences, /api/auth/session
- **Database**: ActiveSession, Session
- **Status**: IMPLEMENTED AND VERIFIED

## FEATURE 18: Data Export
- **ID**: FEAT-018
- **Purpose**: GDPR-style data portability
- **User story**: As a user, I want to download all my data as JSON
- **Frontend**: settings-view.tsx (Data Export tab)
- **Backend**: /api/data-export, /api/channels/[id]/export
- **Status**: IMPLEMENTED AND VERIFIED

---

# 11. USER ROLES

| Role | Auth | Permissions | How assigned |
|---|---|---|---|
| Anonymous | Signed browserId (HMAC) | View, like, subscribe, comment, upload, go live | Automatic (first visit) |
| Registered | Username + password (bcrypt) | All anonymous + cross-device sync, username | Signup (POST /api/auth/register) |
| Channel Owner | browserId linked to channel | All registered + channel management, revenue, roles | Channel creation (POST /api/channels) |
| Channel Manager | ChannelRole.role="manager" | Upload, edit videos, moderate comments | Invited by owner (POST /api/channels/[id]/roles) |
| Channel Editor | ChannelRole.role="editor" | Edit videos, moderate comments | Invited by owner |
| Channel Viewer | ChannelRole.role="viewer" | View channel content | Invited by owner |
| Admin | (not implemented) | (not implemented) | (no admin console exists) |

**Note**: There is NO admin role or admin console. The closest thing is `/api/cost-dashboard` (read-only service health) + `/api/seed` (destructive, locked to dev or admin token in prod).

---

# 12. USER JOURNEYS

## Journey 1: First-time visitor discovers a video
1. Entry: mashahd.vercel.app/
2. Onboarding tour shows (3 steps, skippable)
3. Home renders: categories, mood filter, trending digest, live now shelf, continue watching, shorts shelf, feed
4. User clicks a video card → navigates to ?v=watch&id=...
5. Watch view renders: player, title, channel, like/dislike, comments, AI panels
6. User plays video → hls.js loads, P2P engine initializes (if Wi-Fi)
7. User likes video → POST /api/videos/[id]/like → optimistic UI update
8. User scrolls comments → 6 sort options available
9. User navigates back → home feed refetches

## Journey 2: Creator uploads a video
1. Entry: Click "Create" (video icon) in header
2. Upload dialog opens: drop zone, title, description, category, visibility
3. User selects file (MP4/WebM/MOV ≤500MB)
4. User fills title + clicks Publish
5. XHR uploads with progress bar (POST /api/videos multipart/form-data)
6. Server validates file, writes to storage/uploads/, creates Video row, auto-creates "My Uploads" channel
7. On success: toast "Upload complete!" + navigate to watch view
8. Video appears on home feed (sort=recent) + user's channel

## Journey 3: Creator goes live
1. Entry: Click "Go Live" (radio icon) in header
2. Setup dialog: title, category, privacy
3. Click "Go Live" → POST /api/live-streams creates DB row (status=preparing)
4. Webcam starts (getUserMedia), watch-party WebSocket connects
5. Broadcaster creates party room → partyCode synced to DB
6. Live phase renders: LIVE badge, viewer count (from WS members), chat panel
7. Viewer clicks Live Now shelf card → joins party → real-time chat
8. Broadcaster clicks "End stream" → DELETE → status=ended, endedAt set
9. Viewer detects end (10s refetch) → shows "Stream ended" state

## Journey 4: Viewer switches quality
1. Entry: Watch view, click Settings (gear) in player
2. Settings popover: Speed + Quality sections
3. Quality shows: Auto + available renditions (e.g., 1080p, 720p, 480p, 288p, 184p)
4. User clicks 480p → hls.currentLevel = <index>, preference POSTed to /api/preferences
5. On next video: preference loaded from /api/preferences, applied when manifest parses

## Journey 5: Viewer likes a comment
1. Entry: Watch view, scroll to comments
2. Click Like (ThumbsUp) on a comment
3. commentLikeMutation fires → POST /api/videos/[id]/comments/[cid]/like
4. Optimistic UI: count increments instantly
5. On success: count stays (server confirmed)
6. On error: count rolls back + toast "Could not update like"
7. Double-like: returns {noOp: true}, count unchanged

---

# 13. UX/UI ARCHITECTURE

## Visual Language
- **Brand**: Mashahd (مشاهِد) — gold + charcoal gradient, aurora wash backdrop
- **Color system**: Tailwind CSS built-in variables (`bg-primary`, `text-primary-foreground`, `bg-background`). Gold brand color (`hsl(var(--gold))`). NO indigo/blue (per project rule).
- **Typography**: Tailwind defaults + `font-display` for headings, `font-mono` for code/stats
- **Icons**: Lucide (consistent, tree-shakeable)
- **Motion**: Subtle transitions (hover scale, fade), no Framer Motion (zero-cost)

## Component System
- shadcn/ui (New York style) — all UI primitives (Button, Dialog, Input, etc.)
- Custom components in `src/components/youtube/` (52 files)
- Card alignment: `p-4` or `p-6` padding, `gap-4` or `gap-6` spacing
- Long lists: `max-h-96 overflow-y-auto` with custom scrollbar styling

## Responsive Design
- Mobile-first (Tailwind `sm:`/`md:`/`lg:`/`xl:` breakpoints)
- Touch targets: `min-h-[44px]` (WCAG minimum) — fixed in Pass 50
- Bottom Dock for mobile navigation (5 primary tabs)
- Sticky footer: `min-h-screen flex flex-col` with `mt-auto` on footer

## States
- **Loading**: Skeleton components (shadcn/ui Skeleton)
- **Error**: Inline error messages with "Back to home" button
- **Empty**: "No X available" with helpful CTA
- **Offline**: (not implemented — TanStack Query retries on reconnect)

---

# 14. FRONTEND ARCHITECTURE

## View Dispatcher
`src/app/page.tsx` — single route, dispatches based on `useAppStore` view kind:
- 17 view kinds (home, watch, channel, search, trending, subs, history, liked, library, category, settings, profile, favorites, watchLater, playlist, smartPlaylist, clip, recommendationProfile, shorts, live)
- URL serialized via `viewToQuery` + `queryToView` (e.g., `?v=watch&id=<id>`)
- Popstate listener for back/forward navigation

## State Management
- **Client state**: Zustand (`src/store/app-store.ts` — view, sidebar, search draft)
- **Server state**: TanStack Query (per-component `useQuery` with queryKey invalidation)
- **Local UI state**: React `useState` (forms, dialogs, etc.)
- **No global state for data** — each component fetches its own data

## Data Fetching
- TanStack Query with `queryKey` arrays (e.g., `["videos", videoId, bid]`)
- `refetchInterval` for live data (LiveNowShelf: 15s, LiveStreamView: 10s)
- `enabled` flag to gate queries (e.g., wait for bid before fetching)
- Optimistic updates via `onMutate` (e.g., likeMutation, commentLikeMutation)

## Code Splitting
- `mashahd-player-lazy.tsx` — lazy-loaded player (only loaded when watching)
- Turbopack handles automatic code splitting
- No manual `next/dynamic` imports (Turbopack handles it)

---

# 15. BACKEND ARCHITECTURE

## Route Handlers
- 97 `route.ts` files under `src/app/api/`
- Each route is self-contained (imports db, auth, rate-limit as needed)
- No middleware layer (auth + rate-limit called inline)
- No server actions (per project rule)

## Database Access
- `db` from `@/lib/db` — Turso (prod) or Prisma + SQLite (dev fallback)
- `db.model.findMany/findUnique/create/update/count/deleteMany`
- The Turso wrapper (`turso-db.ts`) implements a Prisma-compatible API over `@libsql/client`
- `ensureAllTables()` runs on every cold start (CREATE TABLE IF NOT EXISTS for all 42 models)

## Background Jobs
- Inngest for durable workflows (media processing, scheduled tasks)
- `/api/inngest` endpoint with webhook signature verification
- No cron jobs (Inngest handles scheduling)

---

# 16. API ARCHITECTURE

## API Catalog (18 domains, ~97 endpoints)

Full catalog at `/api/catalog` (self-documenting). Key endpoints:

### Video
- GET /api/videos — list with 8 sort options + pagination
- POST /api/videos — upload (multipart, 500MB cap, signed browserId required)
- GET /api/videos/[id] — get video + like/dislike state
- POST /api/videos/[id]/views — increment views (rate-limited)
- POST /api/videos/[id]/like — like/dislike with mutual exclusion
- GET /api/videos/[id]/renditions — list playback resolutions
- POST /api/videos/[id]/comments/[cid]/like — like a comment (double-like prevention)
- POST /api/videos/[id]/comments/[cid]/moderate — pin/unpin/delete (creator-only)

### Live Streaming
- POST /api/live-streams — create stream (returns streamKey + watchPartyCode)
- GET /api/live-streams?status=live — list live streams
- GET/PATCH/DELETE /api/live-streams/[id] — get/update/end a stream

### Auth
- POST /api/user-state — issue signed browserId
- POST /api/auth/register — signup (username, email/phone, bcrypt password)
- POST /api/auth/login — login
- POST /api/auth/logout — logout
- GET /api/auth/session — current session

### AI
- GET /api/ai/chapters — smart chapters for a video
- POST /api/ai/oracle — Q&A about a video
- GET /api/ai/starters — comment starter suggestions
- GET /api/ai/trending-digest — curated trending wrap-up

### Platform
- GET /api/ready — readiness check
- GET /api/catalog — self-documenting API catalog
- GET /api/cost-dashboard — service health + DB stats + circuit breakers
- GET /api/platform-changelog — change history

## API Patterns
- **Auth**: `verifyBrowserId(bid)` in all POST/PATCH/DELETE routes
- **Rate limiting**: `rateLimit(key, limit, windowMs)` — in-memory (dev) or Turso-backed (prod)
- **Validation**: inline (parse body, check required fields, validate enums)
- **Errors**: `{ error: "message" }` with appropriate HTTP status (400, 403, 404, 429, 500)
- **Idempotency**: double-like prevention via UserState.likedCommentIds
- **Pagination**: `limit` + `offset` query params (capped at 200)
- **Sorting**: `sort` query param (e.g., `?sort=recent`)

---

# 17. DATABASE ARCHITECTURE

## Database Split
- **Turso (libSQL)** — transactional/control-plane (authoritative). 42 models. 9GB free, 1B reads/month.
- **Neon (Postgres)** — analytics/telemetry warehouse + disaster recovery. 0.5GB free.
- **Local SQLite** — dev fallback when Turso env vars not set.

## Models (42 total)

### Core (14 models)
- Channel, Video, Comment, User, Session, UserState
- VideoSource, VideoRendition, VideoManifest, MediaProcessingJob
- Swarm, PlaybackSession, PlaybackTelemetry, OutboxEvent

### User Preferences (8 models)
- UserPreference (25+ fields), RecommendationFeedback, UserBlock
- ContinueWatching, ContentProvenance, InterestProfile
- SmartPlaylist, RecommendationChangelog

### Social (6 models)
- Notification, NotificationPreference, Share, Playlist, PlaylistItem, Clip

### Live Streaming (2 models)
- LiveStream (Pass 47), LivePoll, LiveQA

### Creator Economy (4 models)
- ChannelRole, PlaylistFolder, ActiveSession, CommentMeta

### Rights + Quality (6 models)
- RightsClaim, RightsDispute, AdDisclosure, SponsoredHashtag
- FactCheckNote, VideoRelationship, VideoCorrection

## Database Integrity Rules
1. **Channel ownership**: `channel.ownerId === bid.id` OR `channel.links.includes("owner:<bid>")`
2. **Comment likes**: double-like prevention via UserState.likedCommentIds (pipe-separated with "c:" prefix)
3. **Live stream status transitions**: preparing → live → ended (enforced in PATCH handler)
4. **Stream key auth**: PATCH/DELETE require timingSafeEqual(streamKey, providedKey)
5. **FK constraints**: relaxed in dev (nullable ownerId) — anonymous ownership via `links` field

---

# 18. STATE MACHINES

## LiveStream State Machine
```
preparing → live → ended
    ↓         ↓       ↓
 (POST)   (PATCH)  (DELETE/PATCH)
```
- **preparing**: initial state after POST /api/live-streams. No viewers yet.
- **live**: PATCH with status=live. Viewer count tracked. Chat active.
- **ended**: DELETE or PATCH with status=ended. endedAt set. viewerCount=0. Row preserved for audit.
- **Forbidden transitions**: live → preparing, ended → live (must start a new stream)

## Video Processing State Machine
```
UPLOADING → UPLOADED → QUEUED → CLAIMED → PROCESSING → PACKAGING → VALIDATING → READY
                                                                        ↓
                                                              RETRYABLE_FAILURE
                                                                        ↓
                                                                  PERMANENT_FAILURE
                                                                        ↓
                                                                  CANCELLED
```
- Tracked in MediaProcessingJob.status
- Currently UNUSED (no transcoding worker running) — videos play directly from the source URL

## Comment Moderation State Machine
```
unpinned → pinned → unpinned
            ↓
         deleted (terminal)
```
- Pin: upsert CommentMeta with pinnedBy + pinnedAt
- Unpin: clear pinnedBy + pinnedAt
- Delete: delete Comment row (cascade-deletes replies) + delete CommentMeta

---

# 19. AUTHENTICATION

## Signed browserId (HMAC-SHA256)
- **Format**: `bid_<base64url(id)>.<base64url(hmac)>`
- **Secret**: `BROWSER_ID_SECRET` env var (stable, anti-stripped)
- **Issue**: POST /api/user-state (on first visit, no valid bid in localStorage)
- **Verify**: `verifyBrowserId(bid)` — checks HMAC signature, returns `{ valid, id, legacy }`
- **Legacy support**: old unsigned `b_<...>` bids accepted but logged + re-issued
- **Storage**: client localStorage (`yt-clone-browser-id` key)

## Registered auth (optional)
- Signup: POST /api/auth/register (username, email/phone, bcrypt password)
- Login: POST /api/auth/login (bcrypt verify)
- Session: token-based, stored in Session table
- Linking: Session.browserId links to anonymous UserState for upgrade

---

# 20. AUTHORIZATION

## Permission Model
- **User**: browserId-holder. Can view, like, subscribe, comment, upload, go live.
- **Channel Owner**: owns a Channel (via ownerId or links field). Can manage channel, roles, revenue.
- **Channel Team**: ChannelRole (owner/manager/editor/viewer). Invited via POST /api/channels/[id]/roles.
- **Admin**: NOT IMPLEMENTED (no admin console, no admin role).

## Authorization Checks
- **POST /api/videos**: requires signed browserId. If channelId provided, verifies ownership.
- **POST /api/live-streams**: requires signed browserId. Prevents concurrent streams per user.
- **PATCH/DELETE /api/live-streams/[id]**: requires streamKey (timingSafeEqual).
- **POST /api/videos/[id]/comments/[cid]/moderate**: requires channel ownership (ownerId OR links field).
- **POST /api/seed**: BLOCKED in production unless SEED_ADMIN_TOKEN provided.

---

# 21. SECURITY ARCHITECTURE

## Security Controls (VERIFIED)
1. **HMAC signed browserId** — prevents count inflation attacks (Pass 47)
2. **Rate limiting** — 75/97 routes use `rateLimit()` (in-memory dev, Turso-backed prod)
3. **Channel ownership verification** — in upload + moderation routes
4. **Stream key auth** — timingSafeEqual prevents timing attacks
5. **File validation** — MIME type + extension + size (500MB cap) on uploads
6. **Path-traversal guard** — /api/media/uploads/[filename] validates filename pattern
7. **Webhook signature verification** — Inngest endpoint verifies INNGEST_WEBHOOK_SECRET
8. **CORS** — ALLOWED_ORIGINS env var (https://mashahd.vercel.app, http://localhost:3000)
9. **CSRF** — no cookies used (browserId in localStorage, Bearer-style auth)
10. **SQL injection** — Prisma + parameterized queries (no raw SQL concatenation)

## Security Gaps
- **22 API routes lack rate limiting** — mostly read-only GETs, but POST /api/seed lacks it in prod
- **No admin console** — no way to ban users, delete content, or view audit trails
- **No suspicious activity detection** — no login anomaly detection, no brute-force lockout
- **No MFA** — registered users use bcrypt password only
- **AI prompt injection** — AI routes (chapters, oracle) don't sanitize user input against prompt injection

---

# 22. AI ARCHITECTURE

## AI Authority Boundary

| Action | AI may do? |
|---|---|
| Summarize video content | ✅ Autonomous (chapters, recap) |
| Answer questions about a video | ✅ Autonomous (oracle) |
| Suggest comment starters | ✅ Autonomous |
| Curate trending digest | ✅ Autonomous |
| Translate comments | ✅ Autonomous |
| Upload a video | ❌ Never |
| Delete a video | ❌ Never |
| Moderate comments | ❌ Never (requires creator) |
| Go live | ❌ Never (requires browserId) |
| Modify user preferences | ❌ Never |
| Access payment data | ❌ Never (no payments exist) |

## AI Providers (5, all free-tier)
1. **Groq** — primary (fastest, free)
2. **OpenRouter** — fallback 1
3. **NVIDIA** — fallback 2
4. **Gemini** (Google) — fallback 3
5. **HF** (HuggingFace) — fallback 4

**Fallback chain**: Groq → OpenRouter → NVIDIA → Gemini → HF → static content
**Status**: prod: all 5 HEALTHY; local: all 5 NOT_CONFIGURED (keys only in .env.example, not .env)

## AI Cost Control
- No per-request cost tracking (all providers are free-tier)
- Fallback to static content if all providers fail (no error shown to user)
- No usage limits (free-tier is self-limiting)

---

# 23. AUTOMATION ARCHITECTURE

## Inngest Durable Workflows
- **Endpoint**: /api/inngest (webhook with signature verification)
- **Jobs**: media processing, scheduled tasks (currently minimal usage)
- **Retry**: Inngest handles automatic retries with backoff
- **Idempotency**: Inngest provides idempotency keys

## Synchronous Operations
- All API routes are synchronous (request → response)
- No background job queue for async operations (except Inngest)

---

# 24. INTEGRATIONS

## Active Integrations (5-service stack)

| Provider | Purpose | Auth | Free tier | Status |
|---|---|---|---|---|
| GitHub | Source control | SSH key | Free | VERIFIED HEALTHY |
| Vercel | Deployment + runtime | API token | Free (Hobby) | VERIFIED HEALTHY |
| Inngest | Durable workflows | signkey | Free | VERIFIED HEALTHY |
| Neon | Analytics + DR | postgresql URL | Free (0.5GB) | VERIFIED HEALTHY |
| Turso | Transactional DB | libsql URL + token | Free (9GB, 1B reads) | VERIFIED HEALTHY |

## Removed Integrations (Pass 53)
- Cloudflare R2 — media storage (removed, code still in server-lib/)
- Filebase — backup storage (removed, code still in server-lib/)
- Brevo — email (removed, email-service.ts exists but no provider)

---

# 25. EMAIL / NOTIFICATIONS

## Current State
- **Email**: NO PROVIDER (Brevo removed in Pass 53). `email-service.ts` exists but has no configured provider. Email-related code paths return early or skip.
- **Notifications**: In-app only (Notification model + /api/notifications). No email/push delivery.
- **Notification preferences**: UserPreference model has newVideos, comments, subscribers, tips, mentions, emailEnabled, pushEnabled flags.

## Gap
- No way to deliver notifications outside the app (no email, no push, no SMS)

---

# 26. FILE / STORAGE ARCHITECTURE

## Current Storage
- **Provider**: LocalFilesystemStorage (only option after Pass 53)
- **Path**: MEDIA_STORAGE_PATH/uploads/ (default: /home/z/my-project/storage/uploads/)
- **Serving**: GET /api/media/uploads/[filename] with HTTP Range support (206 Partial Content)
- **Path-traversal guard**: validates filename against `vid_<ts>_<rand>.<ext>` pattern
- **Content-type**: per-extension (mp4, webm, mov, mkv)

## Trade-off
- **Dev**: uploads work (files written to disk, served via /api/media/uploads/)
- **Prod (Vercel)**: filesystem is READ-ONLY — new uploads fail. Existing demo videos play from public URLs.
- **Future**: if cloud storage re-added, re-wire storage.ts to use R2StorageProvider or FilebaseStorageProvider

---

# 27. PERFORMANCE ARCHITECTURE

## Performance Targets
- First load: <3s (Turbopack + code splitting)
- Navigation: <500ms (client-side routing)
- API response: <100ms (Turso edge database)
- Video startup: <2s (hls.js + P2P acceleration)
- DB query: <50ms (indexed queries, Turso edge)

## Optimization Strategies
- **Client caching**: TanStack Query with staleTime + refetchInterval
- **Code splitting**: Turbopack automatic + lazy-loaded player
- **DB indexing**: 42 models with explicit indexes (see ensureAllTables)
- **Pagination**: limit + offset (capped at 200)
- **P2P**: WebRTC segment exchange reduces origin bandwidth
- **HLS ABR**: hls.js adapts quality to bandwidth

---

# 28. RELIABILITY

## Failure Modes
- **Turso unavailable**: circuit breaker opens, falls back to local SQLite (dev only)
- **Neon unavailable**: analytics endpoint returns empty arrays (non-fatal)
- **Inngest unavailable**: background jobs skip (non-fatal)
- **WebSocket disconnect**: watch-party + p2p-tracker auto-reconnect after 2s
- **AI provider unavailable**: falls back to next provider, then static content
- **Upload failure**: error surfaced to user, no partial state
- **Duplicate request**: idempotency via double-like prevention, Inngest idempotency keys

---

# 29. OBSERVABILITY

## Current
- `/api/cost-dashboard` — service health + DB stats + circuit breakers + system resources
- `/api/ready` — readiness check
- `/api/platform-changelog` — change history
- `dev.log` — server-side logging (tee'd from next dev)
- Console logs in route handlers (error cases)

## Gap
- No structured logging (no JSON logs, no log aggregation)
- No metrics (no Prometheus, no Grafana)
- No traces (no OpenTelemetry)
- No error tracking (no Sentry)

---

# 30. DATA GOVERNANCE

## Data Ownership
- **User data**: owned by the user (browserId). Exportable via /api/data-export.
- **Video data**: owned by the channel owner. Exportable via /api/channels/[id]/export.
- **Comment data**: owned by the comment author. Deletable by the author or channel owner.
- **Analytics data**: aggregated, anonymized in Neon.

## Data Retention
- No automatic retention policy (data persists indefinitely)
- No soft-delete (delete is hard delete)
- Backups retained (6 backups, keep=20)

## Privacy
- Visibility controls (likes/subs/history/playlists/comments)
- Signed browserId (anonymous identity without signup)
- No tracking cookies
- No third-party analytics

---

# 31. ADMIN / OPERATIONS

## Current State
- **No admin console** — the closest is /api/cost-dashboard (read-only)
- **No user administration** — no way to ban users, reset passwords, view audit trails
- **No moderation console** — comment moderation is per-creator only
- **No feature flags** — feature-flags.ts exists but not wired
- **No incident response** — no runbook, no alerting

## Gap
This is the biggest operational gap. A real platform needs admin tooling.

---

# 32. TESTING ARCHITECTURE

## Current Tests (2 files)
- `tests/basic.test.ts` — quota checks, failure taxonomy, circuit breaker (23 assertions)
- `tests/chaos.test.ts` — Neon split-brain prevention, infinite retry prevention (17 assertions)

## Test Status
- **PRESENT BUT BROKEN** — tests reference removed Brevo/Filebase/SMS modules
- The lib files still exist locally so tests may still pass, but they're fragile

## Test Matrix Gaps
- No unit tests for route handlers
- No integration tests for the DB layer
- No API tests (no HTTP-level testing)
- No end-to-end browser tests (agent-browser is manual, not automated)
- No accessibility tests
- No security tests
- No performance tests

---

# 33. DEPLOYMENT ARCHITECTURE

## Environments
- **LOCAL**: `bun run dev:app` (port 3000) + mini-services (3003, 3004). Local SQLite or Turso.
- **PRODUCTION**: Vercel (mashahd.vercel.app). Turso + Neon + Inngest. Auto-deploys from GitHub on push to main.

## Deployment Procedure
1. Commit + push to GitHub (`git push origin main`)
2. Vercel auto-detects the push + triggers a build
3. Build: `bun run build` (Turbopack, standalone output)
4. Deploy: serverless functions deployed to Vercel's edge network
5. Env vars: set on Vercel project (via scripts/set-vercel-env.sh or dashboard)
6. Verify: `curl https://mashahd.vercel.app/api/ready` returns 200

## Rollback
- Vercel keeps previous deployments — rollback via Vercel dashboard or CLI
- Git pre-push hook blocks rollback to older git (prevents accidental `git push -f origin main^`)

---

# 34. COST ARCHITECTURE

## Cost Model
| Service | Provider | Free tier | Current usage | Cost |
|---|---|---|---|---|
| Source control | GitHub | Free | 1 repo, unlimited commits | $0 |
| Deployment | Vercel | Hobby (100 deployments/day) | ~1 deployment/pass | $0 |
| Transactional DB | Turso | 9GB, 1B reads/month | 34 videos, 88 comments | $0 |
| Analytics DB | Neon | 0.5GB | 0 records (empty) | $0 |
| Workflows | Inngest | Free tier | minimal usage | $0 |
| AI (5 providers) | Groq/OpenRouter/NVIDIA/Gemini/HF | Free-tier | fallback to static | $0 |
| Media storage | Local filesystem | — | dev only | $0 |
| **TOTAL** | | | | **$0/month** |

## Cost Boundaries
- No billing details required by any service
- No payment card required
- Free-tier limits are generous (Turso: 1B reads/month, Vercel: 100 deploys/day)

---

# 35. THREAT MODEL

| Threat | Attack vector | Impact | Prevention | Detection |
|---|---|---|---|---|
| Count inflation | Scripted fake browserIds | Inflated views/likes | HMAC signed browserId | Rate limiting |
| Spam uploads | Automated POST /api/videos | Storage fill | Rate limit (10/hour), signed browserId | Rate limit alerts |
| Comment spam | Automated POST /api/comments | Noise | Rate limit, signed browserId | Manual review |
| Stream key brute-force | Guessing streamKey | End someone else's stream | timingSafeEqual, 192-bit key | Rate limit on PATCH/DELETE |
| Path traversal | `../` in filename | Read arbitrary files | Filename pattern validation | — |
| Prompt injection | Malicious video title/description | AI returns bad content | (GAP — no sanitization) | — |
| XSS | Malicious comment text | Script execution | React auto-escaping | — |
| CSRF | Forged POST from another site | State change | No cookies (localStorage + Bearer) | — |
| DDoS | Flood of requests | Service unavailable | Vercel edge rate limits, Turso connection limits | Vercel analytics |

---

# 36. CURRENT GAPS

## IMPLEMENTED
- 97 API routes (88 with DB, 75 with rate limiting)
- 42 Prisma models (all auto-created on cold start)
- 52 UI components
- 2 mini-services (p2p-tracker, watch-party)
- Video upload (dev), live streaming, multi-resolution, comments, AI, P2P, watch party
- 5-service production stack (all HEALTHY)
- Protected files (101), anti-strip .env, git hooks, backup system

## PARTIAL
- Comment moderation (backend exists, UI NOT WIRED)
- AI providers (prod HEALTHY, local NOT_CONFIGURED)
- Tests (2 files but reference removed modules)

## BROKEN
- Video upload on Vercel production (read-only filesystem)
- Tests reference removed Brevo/Filebase/SMS modules

## MISSING
- Admin console
- Email/push notifications (no provider)
- Community text posts
- Stories/ephemeral content
- Per-creator paid memberships
- Structured logging / metrics / traces
- Automated tests (unit, integration, e2e, security)

## DUPLICATED
- `server-lib/{r2,filebase}-storage.ts` still exist but are NOT wired (dead code after Pass 53)

## OBSOLETE
- `/api/webhooks/brevo` route (Brevo removed)
- `email-service.ts` (no provider configured)

## RISKY
- 22 API routes lack rate limiting
- No AI prompt injection defense
- No admin tooling (can't ban users, delete content)

---

# 37. TECHNICAL DEBT

| Item | Severity | Reason |
|---|---|---|
| Tests reference removed modules | Medium | Will break if lib files are deleted |
| Comment moderation UI not wired | Medium | Backend exists, unused |
| 22 routes lack rate limiting | Low | Mostly read-only GETs |
| Dead code (server-lib storage providers) | Low | Not wired, not imported |
| No structured logging | Medium | Hard to debug production issues |
| No automated tests | High | No regression protection |

---

# 38. ARCHITECTURAL RISKS

| Risk ID | Risk | Probability | Impact | Mitigation |
|---|---|---|---|---|
| RISK-001 | Vercel read-only FS breaks prod uploads | VERIFIED | Medium | Documented trade-off; re-add cloud storage if needed |
| RISK-002 | AI keys absent locally | VERIFIED | Low | Set in .env for local dev; prod has them |
| RISK-003 | Tests reference removed modules | VERIFIED | Medium | Update tests or remove |
| RISK-004 | No admin console | HYPOTHETICAL | High | Build admin tooling if user base grows |
| RISK-005 | No automated test suite | VERIFIED | High | Add unit + integration tests |
| RISK-006 | Comment moderation UI missing | VERIFIED | Medium | Wire Pin/Delete buttons (backend ready) |
| RISK-007 | AI prompt injection | HYPOTHETICAL | Medium | Add input sanitization |

---

# 39. MIGRATION REQUIREMENTS

No migrations are currently required. The platform is at a stable state.

If the user re-adds cloud storage:
1. Re-wire `storage.ts` to import R2StorageProvider or FilebaseStorageProvider
2. Set STORAGE_PROVIDER=r2 (or filebase) in .env + on Vercel
3. Set the provider's credentials in .env
4. No DB migration needed (videoUrl is already a string field)

---

# 40. DEVELOPMENT ROADMAP

## FIRST 10 ENGINEERING ACTIONS

1. **Wire comment moderation UI** — add Pin/Delete buttons to watch-view.tsx CommentsSection. Backend ready (POST /api/videos/[id]/comments/[cid]/moderate). Needs ownership detection (video API response should include `isCreator` flag based on bid).

2. **Fix tests** — update tests/basic.test.ts + tests/chaos.test.ts to remove Brevo/Filebase/SMS references. Or delete the tests if they're not relevant anymore.

3. **Add AI keys to local .env** — copy Groq/OpenRouter/NVIDIA/Gemini/HF keys from .env.example to .env so local dev has AI features.

4. **Add rate limiting to remaining 22 routes** — audit which POST routes lack rateLimit() + add it.

5. **Add structured logging** — replace console.log/console.error with a structured logger (JSON format, request ID, timestamp).

6. **Add unit tests for critical routes** — POST /api/videos, POST /api/live-streams, POST /api/videos/[id]/comments/[cid]/like.

7. **Add automated browser test** — a single Playwright/agent-browser test that runs the golden path (home → watch → like → comment).

8. **Remove dead code** — delete server-lib/{r2,filebase}-storage.ts OR re-wire them. Delete /api/webhooks/brevo route. Clean up email-service.ts.

9. **Add admin console** — a /admin route with user/content moderation tools (ban users, delete content, view audit trails). Requires admin role + auth.

10. **Add AI prompt injection defense** — sanitize user input (video titles, descriptions, comment text) before sending to AI providers.

---

# 41. PRODUCTION READINESS

## PRODUCTION READINESS CHECKLIST

| Item | Status |
|---|---|
| Code quality (tsc, lint) | PASS (0 errors) |
| Build | PASS (Turbopack) |
| Environment variables | PASS (set on Vercel) |
| Secrets | PASS (anti-stripped by ensure-env.sh) |
| Database migrations | PASS (42 models, ensureAllTables) |
| Database | PASS (Turso HEALTHY, 34 videos) |
| Security (auth) | PASS (signed browserId) |
| Security (rate limit) | PARTIAL (75/97 routes) |
| Monitoring | PARTIAL (cost-dashboard only) |
| Logging | PARTIAL (console.log, no structure) |
| Backups | PASS (6 retained) |
| Recovery | PARTIAL (no DR runbook) |
| APIs | PASS (97 routes, 8/8 smoke test 200) |
| Integrations | PASS (5-service stack HEALTHY) |
| AI | PARTIAL (prod HEALTHY, local not configured) |
| Rate limits | PARTIAL (75/97) |
| Performance | PASS (edge deployment) |
| Accessibility | PARTIAL (touch targets fixed, no a11y tests) |
| Browser compatibility | NOT TESTED |
| Tests | FAIL (2 files, reference removed modules) |
| Deployment | PASS (auto-deploy from GitHub) |
| Rollback | PASS (Vercel deployments + git pre-push hook) |
| Incident response | FAIL (no runbook) |
| Documentation | PARTIAL (this blueprint + worklog) |

---

# 42. DOCUMENTATION STRUCTURE

## Existing Documentation
- `MASTER_BLUEPRINT.md` (this document)
- `worklog.md` (7700+ lines, 53 passes)
- `DEPLOYMENT.md`, `DEPLOYMENT_READINESS_REVIEW.md`
- `COO_AUDIT_REPORT.md`, `COO_AUDIT_REPORT_v2.md`, `COO_RECOMMENDATIONS.md`
- `FINAL_REPORT.md`, `NEUTRAL_AUDIT.md`
- `PRODUCTION_CLASSIFICATION.md`, `PRODUCTION_GATE.md`
- `ZERO_COST_ARCHITECTURE.md`, `SELF_HOSTED_DEPLOYMENT.md`
- `VIDEO_STREAMING_ARCHITECTURE.md`, `MEDIA_FABRIC_CHECKLIST.md`
- `P2P_NETWORKING.md`, `INTEGRATION.md`, `MEDIA_PIPELINE.md`
- `PROVIDER_RESPONSIBILITY_MATRIX.md`
- `.env.example`, `.mashahd-protected`

## Gap
- No API_REFERENCE.md (the /api/catalog endpoint is the closest)
- No ADRs (Architecture Decision Records)
- No RUNBOOK (operations + incident response)
- No USER_FLOWS.md (documented in this blueprint section 12)

---

# 43. CRITICAL INVARIANTS

1. **Unauthorized users cannot access protected resources** — all POST/PATCH/DELETE routes verify browserId
2. **AI cannot bypass authorization** — AI routes are read-only, no write access
3. **Deleted records cannot silently reappear** — hard deletes (no soft-delete with resurrection)
4. **Duplicate requests cannot create duplicate irreversible operations** — double-like prevention, Inngest idempotency
5. **External events must be validated** — Inngest webhook signature verification
6. **Audit records cannot be silently modified** — no audit table exists (GAP)
7. **Privileged actions must be traceable** — channel ownership via ownerId/links
8. **Stream key must not leak** — only returned in POST response, never in GET
9. **File uploads must be validated** — MIME type + extension + size
10. **Path traversal must be blocked** — filename pattern validation

---

# 44. MASTER DEPENDENCY GRAPH

```
GitHub (source) → Vercel (build + deploy) → mashahd.vercel.app
                                                ↓
                                         Turso (transactional DB) ← all /api/* routes
                                                ↓
                                         Neon (analytics) ← /api/analytics
                                                ↓
                                         Inngest (workflows) ← /api/inngest
                                                ↓
                                         p2p-tracker (port 3003) ← mashahd-player
                                                ↓
                                         watch-party (port 3004) ← go-live + live-stream-view + watch-party
                                                ↓
                                         Local FS (storage) ← POST /api/videos
                                                ↓
                                         AI providers (5) ← /api/ai/*
```

---

# 45. FEATURE-TO-TECHNOLOGY MATRIX

| Feature | Frontend | API | DB | AI | Storage | Status |
|---|---|---|---|---|---|---|
| Video Discovery | home-view | /api/feed/for-you | Video, UserPreference | trending-digest | — | VERIFIED |
| Video Playback | watch-view, mashahd-player | /api/videos/[id] | Video, VideoRendition | chapters, oracle | /api/media/uploads | VERIFIED |
| Video Upload | CreateButton | POST /api/videos | Video, Channel | — | Local FS | VERIFIED (dev) |
| Live Streaming | go-live, live-stream-view | /api/live-streams | LiveStream | — | — | VERIFIED |
| Multi-resolution | mashahd-player | /api/videos/[id]/renditions | VideoRendition, UserPreference | — | — | VERIFIED |
| Comments | watch-view CommentsSection | /api/videos/[id]/comments | Comment, CommentMeta | translation | — | VERIFIED |
| Comment Likes | watch-view | /api/.../like | Comment, UserState | — | — | VERIFIED |
| Comment Moderation | (NOT WIRED) | /api/.../moderate | CommentMeta | — | — | PARTIAL |
| Shorts | shorts-feed-view | /api/videos?sort=popular | Video | — | — | VERIFIED |
| Channels | channel-view | /api/channels | Channel, ChannelRole | — | — | VERIFIED |
| Playlists | playlist-view, save-to-playlist | /api/playlists | Playlist, PlaylistItem | smart-playlist | — | VERIFIED |
| Clips | clip-dialog, clip-view | /api/clips | Clip | — | — | VERIFIED |
| AI Features | ai-recap, ai-watch-panel | /api/ai/* | — | 5 providers | — | PARTIAL (local) |
| Recommendations | settings-view | /api/preferences | UserPreference | — | — | VERIFIED |
| Privacy | settings-view | /api/preferences | UserPreference | — | — | VERIFIED |
| P2P | mashahd-player | p2p-tracker:3003 | Swarm, PlaybackSession | — | — | VERIFIED |
| Watch Party | watch-party | watch-party:3004 | — | — | — | VERIFIED |
| Account Security | settings-view | /api/preferences, /api/auth/session | ActiveSession, Session | — | — | VERIFIED |
| Data Export | settings-view | /api/data-export | (all user tables) | — | — | VERIFIED |

---

# 46. API-TO-DATABASE MATRIX

(Simplified — see /api/catalog for the full 97-endpoint list)

| API | DB tables | Reads | Writes | Auth |
|---|---|---|---|---|
| POST /api/videos | Video, Channel | Channel (ownership) | Video, Channel (upsert) | browserId |
| GET /api/videos | Video, Channel | Video, Channel | — | none |
| POST /api/live-streams | LiveStream | LiveStream (concurrent check) | LiveStream | browserId |
| PATCH /api/live-streams/[id] | LiveStream | LiveStream (key verify) | LiveStream | streamKey |
| POST /api/videos/[id]/like | Video, UserState | Video, UserState | Video (increment), UserState | browserId |
| POST /api/.../comments/[cid]/like | Comment, UserState | Comment, UserState | Comment (increment), UserState | browserId |
| POST /api/.../comments/[cid]/moderate | Comment, CommentMeta, Channel | Comment, Channel (ownership) | Comment (delete) or CommentMeta (pin) | browserId + ownership |
| GET /api/feed/for-you | Video, UserPreference, ContinueWatching | all | — | browserId |
| POST /api/preferences | UserPreference | UserPreference | UserPreference (upsert) | browserId |
| POST /api/user-state | UserState | — | UserState (create) | none (issues bid) |

---

# 47. AI-TO-SYSTEM MATRIX

| AI Function | Model | Prompt | Tools | Data access | Output | Side effects | Audit |
|---|---|---|---|---|---|---|---|
| Chapters | Groq (fallback chain) | video metadata → chapter list | none | Video title/desc | JSON chapters | none | none |
| Oracle | Groq (fallback chain) | video + user question → answer | none | Video + transcript | text answer | none | none |
| Starters | Groq (fallback chain) | video metadata → comment starters | none | Video title/desc | JSON starters | none | none |
| Trending digest | Groq (fallback chain) | top videos → editorial wrap-up | none | Video list | text digest | none | none |
| Comment translation | Groq (fallback chain) | comment text → translated | none | Comment text | translated text | none | none |

**AI authority**: ALL AI functions are READ-ONLY. No AI can write to the DB, upload files, or modify state.

---

# 48. FINAL IMPLEMENTATION SEQUENCE

## IMPLEMENTATION ORDER (dependency-aware)

1. **Wire comment moderation UI** (backend ready, needs frontend)
2. **Fix tests** (remove removed-module references)
3. **Add AI keys to local .env** (so dev has AI)
4. **Add rate limiting to remaining 22 routes**
5. **Remove dead code** (server-lib storage providers, /api/webhooks/brevo)
6. **Add structured logging**
7. **Add unit tests for critical routes**
8. **Add automated browser test** (golden path)
9. **Add admin console** (if user base grows)
10. **Add AI prompt injection defense**

---

# 49. DEFINITION OF DONE

| Component | Done when |
|---|---|
| Feature | All user journeys work, edge cases handled, tests pass |
| API | Endpoint returns correct response for happy + error paths, rate-limited, auth-checked |
| Database migration | `bun run db:push` succeeds, ensureAllTables creates the table, data queries work |
| AI capability | Provider returns valid output, fallback works, no hallucination of API access |
| Integration | Webhook verified, env vars set, production endpoint returns 200 |
| UI component | Renders in all viewports, a11y labels present, touch targets ≥44px |
| Security feature | Auth check passes, unauthorized gets 403, rate limit triggers 429 |
| Production deployment | mashahd.vercel.app returns 200, cost-dashboard HEALTHY, no browser errors |

---

# 50. FINAL OPEN QUESTIONS / UNKNOWN

1. **Are AI keys set on the Vercel project?** — prod cost-dashboard shows all 5 as HEALTHY, but local .env doesn't have them. UNVERIFIED whether they're set via Vercel env vars or the prod cost-dashboard is wrong.
2. **Do the tests actually pass?** — the audit didn't run them (they reference removed modules). UNVERIFIED.
3. **Is the p2p-tracker actually reducing bandwidth?** — no metrics to verify P2P ratio in production. UNVERIFIED.
4. **What's the actual Turso DB size?** — cost-dashboard shows dbStats (counts) but not storage size. UNKNOWN.
5. **Are there any orphaned LiveStream rows?** — streams that were never ended (broadcaster's tab closed). UNKNOWN — no GC job runs.

---

## BLUEPRINT COMPLETION SUMMARY

### What is already implemented (VERIFIED)
- 97 API routes, 42 Prisma models, 52 UI components
- 5-service production stack (GitHub + Vercel + Inngest + Neon + Turso) — all HEALTHY
- Video upload (dev), live streaming (broadcaster + viewer), multi-resolution, comment likes, P2P, watch party
- Signed browserId auth, rate limiting (75/97), protected files (101), anti-strip .env
- Production deployment at mashahd.vercel.app (8/8 endpoints 200)
- Zero-cost: $0/month, no billing details

### What is partially implemented
- Comment moderation (backend exists, UI NOT WIRED)
- AI providers (prod HEALTHY, local NOT_CONFIGURED)
- Tests (2 files, reference removed modules)

### What is broken
- Video upload on Vercel production (read-only filesystem — documented trade-off)
- Tests reference removed Brevo/Filebase/SMS modules

### What is missing
- Admin console
- Email/push notifications (no provider after Brevo removal)
- Community text posts, Stories, per-creator memberships
- Structured logging, metrics, traces
- Automated test suite (unit, integration, e2e, security)

### What is risky
- 22 API routes lack rate limiting
- No AI prompt injection defense
- No admin tooling (can't ban users, delete content)
- No DR runbook (no incident response)

### What must be done first
1. Wire comment moderation UI (backend ready)
2. Fix tests (remove removed-module references)
3. Add AI keys to local .env
4. Add rate limiting to remaining 22 routes
5. Remove dead code (server-lib storage providers, /api/webhooks/brevo)

### What should NOT be changed
- The 5-service stack (don't re-add Filebase/Cloudflare/Brevo per Pass 53)
- The Turso + Neon split (transactional + analytics)
- The signed browserId auth (proven secure)
- The mini-services architecture (p2p-tracker + watch-party)
- The 42-model Prisma schema (covers all spec domains)
- The protected files system (101 files + anti-strip)
- The git hooks (pre-commit blocks deletions, pre-push blocks rollback)

---

*This blueprint is the single authoritative technical + product source of truth for Mashahd. All future development should reference this document before making architectural decisions.*
