# Mashahd — Phase 0 Inspection Report + Architecture/Change Map

**Prepared by:** Principal Architect / Principal Full-Stack Engineer / Principal Distributed-Systems Engineer / Principal Media Systems Engineer / Principal Algorithm Engineer / Security Architect / DevOps / QA Lead / Production Readiness Lead
**Date:** September 12, 2026
**Phase:** 0 — INSPECTION ONLY — NO CODE CHANGES

---

## 1. BASELINE MEASUREMENTS

| Check | Result | Notes |
|-------|--------|-------|
| **Lint** | ✅ PASS (0 errors) | `eslint .` clean |
| **Typecheck** | ⚠️ 4 ERRORS (suppressed) | `next.config.ts` has `ignoreBuildErrors: true` — errors exist but don't block build. Errors in: watch-party.tsx (displayName), decision-record.ts (undefined), local-media-cache.ts (IDBRequest iterator), rate-limiter.ts (Row type cast) |
| **Build** | ❌ FAIL | `next build` fails: "@prisma/client did not initialize yet" during page data collection. Prisma client must be generated + the build must not try to import routes that query the DB at module load. |
| **Tests** | ⚠️ NO TESTS EXIST | `/tests/` directory exists but contains no test files. Zero automated test coverage. |
| **Git HEAD** | `40ea9dc` | Clean working tree, in sync with origin/main |
| **Services running** | 3 (Next.js:3000, p2p-tracker:3003, watch-party:3004) | All healthy |
| **Turso tables** | 20 | All present (verified via push-turso.ts) |
| **Protected files** | 56 | All present on disk (verified vs .mashahd-protected manifest) |

---

## 2. FEATURE CLASSIFICATION (A–F)

### A. Already Fully Implemented + Working

| Feature | Location | Status |
|---------|----------|--------|
| Home browse (grid + categories + moods) | home-view.tsx, category-chips.tsx, mood-filter.tsx | ✅ Works |
| Video playback (native MP4) | mashahd-player.tsx | ✅ Works (after MP4-vs-HLS detection fix) |
| Video playback (HLS via hls.js) | mashahd-player.tsx | ✅ Works locally (needs HLS videos in DB) |
| Auth (register/login/session/username-check) | api/auth/* | ✅ Works (Turso-backed) |
| Rate limiting (Turso-backed) | rate-limiter.ts | ✅ Works (async, atomic) |
| Comments (threaded + timestamp pin) | api/videos/[id]/comments | ✅ Works |
| Playlists (full CRUD) | api/playlists/* | ✅ Works |
| Clips (full CRUD) | api/clips/* | ✅ Works |
| Creator Support (cosmetic) | support-creator.tsx | ✅ Works (localStorage) |
| Command palette (⌘K) | command-palette.tsx | ✅ Works |
| Onboarding tour | onboarding-tour.tsx | ✅ Works |
| Keyboard shortcuts | keyboard-shortcuts.tsx | ✅ Works |
| Theme toggle (dark/light) | header.tsx | ✅ Works |
| Splash screen | splash.tsx | ✅ Works |
| Mini player (PiP) | mini-player.tsx | ✅ Works |
| Bullet comments (danmaku) | bullet-comments.tsx | ✅ Works (needs video playback) |
| Channel view (single-scroll) | channel-view.tsx | ✅ Works |
| Profile view | profile-view.tsx | ✅ Works |
| Settings (6 tabs) | settings-view.tsx | ✅ Works |
| Super-app bridge | mashahd-bridge.ts | ✅ Works |
| Pre-commit file protection | scripts/pre-commit-protect.sh | ✅ Works (56 files protected) |
| Backup script | scripts/backup-all.sh | ✅ Works |
| Turso schema push | scripts/push-turso.ts | ✅ Works (20 tables) |

### B. Implemented but Not Wired / Not Reaching Production

| Feature | Location | Issue |
|---------|----------|-------|
| AI features (7 routes) | api/ai/* | Code works locally; production fails because `ZAI_API_KEY` is not set on Vercel. Falls back silently. |
| Video upload + transcode | api/media/videos/[id]/upload | Works locally (FFmpeg); fails on Vercel (no FFmpeg, read-only FS). |
| Watch Party (real-time) | watch-party mini-service + use-watch-party hook | Works locally (ws://localhost:3004); fails on production (no WebSocket server on Vercel). |
| Go Live | go-live.tsx | UI exists; no real streaming backend (simulated viewer counts). |
| P2P acceleration (WebRTC) | mashahd-player.tsx + p2p-tracker | Works locally; P2P tracker not exposed on production. hls.js P2P engine integration uses undocumented `(engine as any).core` API. |
| Transcript panel | transcript-panel.tsx + api/ai/transcript | UI works; LLM returns fallback on production (no ZAI_API_KEY). |
| End screen | end-screen.tsx | UI works; never triggers on production because no videos end (all 10s clips + no playback). |

### C. Partially Implemented

| Feature | Location | Gap |
|---------|----------|-----|
| Demand-driven transcoding | demand-transcoder.ts | `recordUniqueViewer` doesn't track actual uniques — just increments a counter (admitted in comment). Thresholds will fire too aggressively. |
| Peer scoring | peer-scorer.ts | quarantinedPeers Map is in-memory only (lost on restart). SUPER_PEER threshold is 100MB (too low). TRUSTED_SEED/EDGE_CACHE/ORIGIN roles defined but never assigned. |
| Heat prediction | heat-predictor.ts | Histories Map is in-memory only — lost on server restart. No persistence to Turso. |
| Delivery scheduler | delivery-scheduler.ts | `deadline` computed but never passed to `scoreSource`. Buffer safety not deadline-aware. |
| Scarcity engine | scarcity-engine.ts | "0 peers = infinite scarcity" comment is wrong (returns 1.0 capped). `getHeatAllocation` has no default fallthrough. |
| Placement engine | placement-engine.ts | Dead code at line 74 — RECOVERY state unreachable (originState reassigned before conditional). |
| Economy state | economy-state.ts | Same dead-code bug at line 87 — RECOVERY unreachable. |
| Decision records | decision-record.ts | Records are built but never stored anywhere (no persistence, no logging). |
| Local media cache | local-media-cache.ts | `persistEntry`/`deleteEntry` don't await transaction completion (fire-and-forget). No `navigator.storage.persist()` request. |
| Media transport | media-transport.ts | Only HttpTransport implemented — P2P/WebTransport/MoQ are stub interfaces (no real classes). |
| Watch Party room state | watch-party/index.ts | No authentication (any client can claim any party code). In-memory only (multi-instance won't share). No drift correction. No state recovery after reconnect (clients can't reconstruct missed state). |

### D. Merely UI Placeholders

| Feature | Location | Reality |
|---------|----------|---------|
| Go Live streaming | go-live.tsx | Simulated viewer counts, no real RTMP/SRT ingest, no encoder, no LL-HLS output. |
| Live chat in Go Live | go-live.tsx | Simulated messages, no real WebSocket integration. |
| Create Channel (ID verification) | create-channel.tsx | 5-step flow with ID upload + face capture, but verification is simulated (2.5s spinner, always succeeds). No real ID/face matching. |
| Download button | watch-view.tsx | Button exists, no download functionality. |
| "More" button | watch-view.tsx | Button exists, no menu/actions. |

### E. Production Unsafe

| Issue | Location | Severity |
|-------|----------|----------|
| **Hardcoded Turso token (rw access) in source** | scripts/push-turso.ts line 4 | 🔴 CRITICAL — token committed to git, anyone with repo access has full DB read/write |
| **No origin validation in p2p-tracker** | mini-services/p2p-tracker/index.ts | 🔴 HIGH — comment claims validation but `req` is unused in connection handler; any origin can connect |
| **No swarm authorization** | mini-services/p2p-tracker/index.ts | 🟡 MEDIUM — swarmId accepted as any string; no validation against DB |
| **browserId spoofing** | api/playlists/*, api/user-state, api/videos/[id]/like | 🟡 MEDIUM — all mutations rely on client-supplied browserId with no auth |
| **No auth on /api/seed** | api/seed/route.ts | 🟡 MEDIUM — anyone can wipe + reseed the DB |
| **No rate limit on comments** | api/videos/[id]/comments | 🟡 MEDIUM — spam risk |
| **No rate limit on AI Oracle** | api/ai/oracle | 🟡 MEDIUM — LLM cost abuse |
| **No rate limit on video views** | api/videos/[id]/views | 🟢 LOW — view inflation |
| **No rate limit on telemetry** | api/media/telemetry | 🟢 LOW — DB write abuse |
| **Session token in query param** | api/auth/session (GET ?token=) | 🟡 MEDIUM — logged in URLs/proxies |
| **CORS falls back to \*** | api/media/manifest route | 🟡 MEDIUM — when ALLOWED_ORIGINS unset |
| **eval() in ffprobe** | media-worker.ts line 65 | 🟡 MEDIUM — `eval(\`(${v.r_frame_rate})\`)` on ffprobe output (theoretical code injection if ffprobe returns malicious data) |
| **.env backup unencrypted** | scripts/backup-all.sh | 🟡 MEDIUM — secrets at rest in plaintext |
| **Player telemetry stale closure** | mashahd-player.tsx line 211-223 | 🟢 LOW — telemetry reports zeros forever (refs needed) |
| **Build broken** | next.config.ts + prisma | 🔴 HIGH — `next build` fails; production deploy via Vercel auto-build also affected |

### F. Missing

| Feature | Spec Phase | Status |
|---------|-----------|--------|
| Magic-byte validation on upload | Phase 3 | ❌ Not implemented (only MIME type check) |
| MIME validation via ffprobe | Phase 3 | ❌ Not implemented (ffprobe used for probe, not validation) |
| Media job lease/claim mechanism | Phase 3 | ❌ Not implemented (no worker identity, no stale-job recovery) |
| Media job retry with backoff | Phase 3 | ❌ retryCount field exists but no retry logic |
| Atomic publish (write temp → validate → rename) | Phase 3 | ❌ Not implemented (writes directly to final path) |
| Stale-job recovery | Phase 3 | ❌ Not implemented |
| Transcode priority score | Phase 4 | ❌ demand-transcoder has thresholds but no real priority scoring formula |
| WebTransport transport | Phase 15 | ❌ Interface only (media-transport.ts), no implementation |
| MoQ transport | Phase 15 | ❌ Interface only, MOQ_ENABLED=false |
| Adaptive hedged requests | Phase 10 | ❌ delivery-scheduler has hedge concept but no actual hedging (no duplicate request + cancel) |
| Predictive prefetch | Phase 11 | ❌ scarcity-engine has cooperative prefetch assignment but no actual prefetch execution |
| Request coalescing | Phase 9 | ❌ demand-transcoder has single-flight for transcode, but no segment-level coalescing |
| Content temperature (HOT/WARM/COOL/COLD) | Phase 13 | ❌ heat-predictor classifies but classification isn't used to drive cache/replication decisions |
| Hot content promotion | Phase 13 | ❌ Not wired (no cache promotion, no rendition creation, no swarm seeding based on heat) |
| Watch Party state recovery | Phase 16 | ❌ No state_revision, no generation, no reconnect state reconstruction |
| Watch Party drift correction | Phase 16 | ❌ Not implemented |
| Go Live real backend | Phase 17 | ❌ No RTMP/SRT ingest, no encoder, no LL-HLS |
| Media node abstraction | Phase 19 | ❌ No MediaNode model or role assignment |
| Resource governance | Phase 28 | ❌ No CPU/memory/disk limits, no queue backpressure |
| Observability /metrics | Phase 27 | ❌ Only /api/media/health exists; no /metrics, no /ready |
| Cloudflare edge config | Phase 21 | ❌ Not configured |
| Migration system | — | ❌ Only additive IF NOT EXISTS (no ALTER TABLE for existing data) |

---

## 3. ARCHITECTURE/CHANGE MAP

For every proposed change:

```
FILE
CURRENT BEHAVIOR
PROBLEM
PROPOSED CHANGE
DEPENDENCIES
RISK
ROLLBACK
WHY ZERO-COST
WHY HIGH-PERFORMANCE
```

---

### CHANGE 1: Fix production build (BLOCKER)

```
FILE: next.config.ts + package.json
CURRENT BEHAVIOR: next.config.ts has `typescript.ignoreBuildErrors: true`. `next build` fails with
  "@prisma/client did not initialize yet" during page data collection because API routes import
  @prisma/client at module load, but the client isn't generated in the build environment.
PROBLEM: Production build is broken. Vercel auto-deploy succeeds only because Vercel runs
  `prisma generate` in its build step; local `next build` fails.
PROPOSED CHANGE:
  1. Add `postinstall` script to package.json: `prisma generate` (ensures client is generated
     after every `bun install`).
  2. In next.config.ts, add `experimental: { serverActions: { bodySizeLimit: '2gb' } }` if needed.
  3. Do NOT remove `ignoreBuildErrors` yet (4 type errors exist — fix them first, then remove).
DEPENDENCIES: None
RISK: LOW — postinstall is standard Prisma practice.
ROLLBACK: Remove postinstall script.
WHY ZERO-COST: No new dependencies.
WHY HIGH-PERFORMANCE: Enables local production builds for self-hosted deployment.
```

---

### CHANGE 2: Fix 4 TypeScript errors

```
FILE: src/components/youtube/watch-party.tsx, src/lib/decision-record.ts,
      src/lib/local-media-cache.ts, src/lib/rate-limiter.ts
CURRENT BEHAVIOR: 4 type errors suppressed by ignoreBuildErrors.
PROBLEM: Type safety is bypassed; bugs can ship silently.
PROPOSED CHANGE:
  1. watch-party.tsx: use `displayName` from useAvatar hook (rename `name` → `displayName` or
     add alias).
  2. decision-record.ts: guard `selected.effectiveValue` with `?? ""`.
  3. local-media-cache.ts: cast IDBRequest result to `any[]` before iterating.
  4. rate-limiter.ts: cast `existing.rows[0]` to `unknown` first, then to target type.
DEPENDENCIES: None
RISK: LOW
ROLLBACK: Revert individual fixes.
WHY ZERO-COST: No new dependencies.
WHY HIGH-PERFORMANCE: Type safety prevents runtime bugs.
```

---

### CHANGE 3: Rotate hardcoded Turso token

```
FILE: scripts/push-turso.ts (line 4)
CURRENT BEHAVIOR: TURSO_TOKEN is hardcoded in plaintext source code, committed to git.
PROBLEM: 🔴 CRITICAL SECURITY — anyone with repo access has full read/write access to Turso DB.
PROPOSED CHANGE:
  1. Read TURSO_URL + TURSO_AUTH_TOKEN from process.env (not hardcoded).
  2. Add a .env check at the top of the script: if missing, print instructions.
  3. Rotate the exposed token in the Turso dashboard (human action).
  4. Update .env.example to document the required vars.
DEPENDENCIES: None
RISK: LOW — script already uses env vars elsewhere.
ROLLBACK: Revert to hardcoded (NOT recommended).
WHY ZERO-COST: No new dependencies.
WHY HIGH-PERFORMANCE: N/A (security fix).
```

---

### CHANGE 4: Fix dead-code bugs in placement-engine + economy-state

```
FILE: src/lib/placement-engine.ts (line 74), src/lib/economy-state.ts (line 87)
CURRENT BEHAVIOR: RECOVERY state is unreachable because `originState` is reassigned to "NORMAL"
  before the conditional check.
PROBLEM: The origin pressure mode can never transition to RECOVERY — the self-healing path is dead.
PROPOSED CHANGE: Move the `originState` assignment AFTER the conditional checks, or restructure
  the logic so the state machine reads the current state before reassigning.
DEPENDENCIES: None
RISK: LOW — logic fix only.
ROLLBACK: Revert.
WHY ZERO-COST: No new dependencies.
WHY HIGH-PERFORMANCE: Enables the self-healing economy state machine.
```

---

### CHANGE 5: Fix player telemetry stale closure

```
FILE: src/components/youtube/mashahd-player.tsx (lines 211-223)
CURRENT BEHAVIOR: The telemetry interval captures hudStats/rebufferCount/startupTime in its
  closure — these are always the initial values (zeros) because the interval never sees
  updated state.
PROBLEM: Telemetry reports zeros forever — P2P stats, rebuffer counts, and startup times are
  never actually sent to the server.
PROPOSED CHANGE: Use refs (hudStatsRef, rebufferCountRef, startupTimeRef) that are updated
  alongside the state, and read from refs in the interval callback.
DEPENDENCIES: None
RISK: LOW
ROLLBACK: Revert to state-based (broken) approach.
WHY ZERO-COST: No new dependencies.
WHY HIGH-PERFORMANCE: Enables real telemetry-driven optimization.
```

---

### CHANGE 6: Fix demand-transcoder unique viewer tracking

```
FILE: src/lib/demand-transcoder.ts
CURRENT BEHAVIOR: `recordUniqueViewer` just increments a counter — uniqueness is never enforced.
PROBLEM: Demand thresholds fire too aggressively (every view counts as a unique viewer).
PROPOSED CHANGE: Use a Set<viewerId> (bounded LRU, max 1000 entries) to track actual uniques
  per rendition. Expire entries after 30 minutes.
DEPENDENCIES: None
RISK: LOW
ROLLBACK: Revert to counter.
WHY ZERO-COST: No new dependencies.
WHY HIGH-PERFORMANCE: Accurate demand signals prevent unnecessary transcoding.
```

---

### CHANGE 7: Add origin validation to p2p-tracker

```
FILE: mini-services/p2p-tracker/index.ts
CURRENT BEHAVIOR: Comment claims "origin validation" but `req` is unused in the connection
  handler. Any origin can connect.
PROBLEM: Security gap — cross-origin WebSocket connections aren't validated.
PROPOSED CHANGE: In the `wss.on("connection")` handler, check `req.headers.origin` against
  an ALLOWED_ORIGINS env var (comma-separated). Reject if not present.
DEPENDENCIES: ALLOWED_ORIGINS env var (already exists in .env.example)
RISK: LOW — may reject legitimate connections if ALLOWED_ORIGINS is misconfigured.
ROLLBACK: Remove the check.
WHY ZERO-COST: No new dependencies.
WHY HIGH-PERFORMANCE: N/A (security fix).
```

---

### CHANGE 8: Add swarm authorization to p2p-tracker

```
FILE: mini-services/p2p-tracker/index.ts
CURRENT BEHAVIOR: swarmId is accepted as any string — no validation against the DB.
PROBLEM: Swarm poisoning — a peer can claim a different swarm than their video maps to.
PROPOSED CHANGE: On `join`, verify the swarmId exists in the Swarm table (via Turso query).
  Reject if not found.
DEPENDENCIES: @libsql/client (already installed), TURSO_URL + TURSO_AUTH_TOKEN env vars.
RISK: MEDIUM — adds a DB query to the join path (latency). Mitigate with a 60s in-memory
  cache of valid swarmIds.
ROLLBACK: Remove the check.
WHY ZERO-COST: Uses existing Turso free tier.
WHY HIGH-PERFORMANCE: Prevents P2P data corruption from poisoned swarms.
```

---

### CHANGE 9: Add media job lease/claim + stale recovery

```
FILE: prisma/schema.prisma (MediaProcessingJob model), src/lib/media-worker.ts
CURRENT BEHAVIOR: Jobs transition UPLOADING → QUEUED → PROCESSING → READY/FAILED but there's
  no lease/claim mechanism, no worker identity, no stale-job recovery.
PROBLEM: If a worker crashes mid-transcode, the job stays in PROCESSING forever.
PROPOSED CHANGE:
  1. Add fields to MediaProcessingJob: `claimedBy String?`, `claimedAt DateTime?`,
     `priority Int @default(0)`, `errorClass String?` (transient/permanent).
  2. Add a `claimJob(workerId)` function: atomically claims the highest-priority QUEUED job
     (UPDATE ... WHERE status='QUEUED' RETURNING *).
  3. Add a `recoverStaleJobs()` function: finds jobs in PROCESSING where claimedAt < now-10min,
     resets them to QUEUED + increments retryCount.
  4. Run recovery on a 60s interval in the media worker.
DEPENDENCIES: None (uses existing Turso)
RISK: MEDIUM — changes the job state machine. Must preserve existing upload route behavior.
ROLLBACK: Remove new fields + functions.
WHY ZERO-COST: Uses existing Turso free tier.
WHY HIGH-PERFORMANCE: Prevents stuck jobs from blocking the queue.
```

---

### CHANGE 10: Add magic-byte + ffprobe validation on upload

```
FILE: src/app/api/media/videos/[id]/upload/route.ts
CURRENT BEHAVIOR: Only checks `file.type.startsWith("video/")` (MIME type from the browser,
  which is spoofable).
PROBLEM: Malicious files can bypass the MIME check.
PROPOSED CHANGE:
  1. Read the first 12 bytes of the file → check magic bytes (ftyp for MP4, 0x1A for Matroska).
  2. After ffprobe, validate the codec/container against an allowlist (h264/aac/mp4/webm).
  3. Enforce duration limits (max 2h), resolution limits (max 4K), file-size limits (max 2GB).
  4. Sanitize the original filename (strip path separators, null bytes).
DEPENDENCIES: None
RISK: LOW
ROLLBACK: Remove validation.
WHY ZERO-COST: No new dependencies.
WHY HIGH-PERFORMANCE: Prevents wasted transcode cycles on invalid files.
```

---

### CHANGE 11: Add atomic publish to media pipeline

```
FILE: src/lib/media-worker.ts, src/app/api/media/videos/[id]/upload/route.ts
CURRENT BEHAVIOR: Transcoded segments are written directly to the final storage path. If the
  process crashes mid-write, partially written segments are visible.
PROBLEM: Viewers may fetch partially written segments → playback corruption.
PROPOSED CHANGE:
  1. Write to a temp dir: `storage/tmp/{videoId}-{jobId}/`.
  2. After validation, `rename` (atomic on same filesystem) to the final path.
  3. Only after rename succeeds, update the DB status to READY.
DEPENDENCIES: None
RISK: LOW — rename is atomic on POSIX.
ROLLBACK: Revert to direct writes.
WHY ZERO-COST: No new dependencies.
WHY HIGH-PERFORMANCE: Prevents viewers from seeing partial media.
```

---

### CHANGE 12: Add request coalescing for segment fetches

```
FILE: NEW FILE — src/lib/request-coalescer.ts
CURRENT BEHAVIOR: No segment-level request coalescing. 300 viewers requesting the same segment
  = 300 origin fetches.
PROBLEM: Origin is hammered on concurrent requests for the same segment.
PROPOSED CHANGE:
  1. Create an in-process coalescer: `coalesce(key, fetcher, ttlMs)`.
  2. When a request comes in for a key that's already in-flight, attach to the existing promise.
  3. Bounded Map (max 1000 entries, LRU eviction).
  4. Timeout + cancellation + failure propagation.
  5. Wire into the manifest route for segment fetches.
DEPENDENCIES: None
RISK: LOW — in-process only, no cross-instance sharing (acceptable for single-origin).
ROLLBACK: Remove the wrapper.
WHY ZERO-COST: No new dependencies.
WHY HIGH-PERFORMANCE: Reduces origin load by N× for N concurrent requests.
```

---

### CHANGE 13: Add observability endpoints (/ready, /metrics)

```
FILE: src/app/api/media/health/route.ts (extend), NEW: src/app/api/metrics/route.ts
CURRENT BEHAVIOR: Only /api/media/health exists (liveness + readiness combined).
PROBLEM: No /metrics endpoint for Prometheus-style scraping. No FFmpeg queue depth, no P2P
  hit ratio, no cache hit ratio, no rebuffer rate metrics.
PROPOSED CHANGE:
  1. Split health into /health (liveness — always 200) and /ready (readiness — DB check).
  2. Add /api/metrics: returns JSON with:
     - api_latency_p50/p95/p99
     - ffmpeg_queue_depth
     - ffmpeg_job_duration_avg
     - transcode_failures_total
     - disk_usage_bytes
     - p2p_hit_ratio
     - cache_hit_ratio
     - hls_startup_time_avg
     - rebuffer_rate
     - active_watch_parties
     - active_p2p_peers
  3. Collect metrics in an in-memory ring buffer (last 5 minutes, 60 buckets of 5s).
DEPENDENCIES: None
RISK: LOW
ROLLBACK: Remove /metrics route.
WHY ZERO-COST: No external monitoring service.
WHY HIGH-PERFORMANCE: Enables data-driven optimization.
```

---

### CHANGE 14: Add resource governance (concurrent FFmpeg limits)

```
FILE: NEW FILE — src/lib/resource-governor.ts, src/lib/media-worker.ts
CURRENT BEHAVIOR: No concurrent FFmpeg job limit. Multiple uploads can spawn multiple ffmpeg
  processes, starving the CPU.
PROBLEM: Media workloads can starve the control plane (Next.js API).
PROPOSED CHANGE:
  1. Create a resource governor: maxConcurrentJobs (default 2), maxCpuPercent (default 80%),
     maxDiskUsagePercent (default 90%).
  2. Before starting a transcode, check if resources are available. If not, leave the job
     in QUEUED (the worker will pick it up later).
  3. Expose current resource usage via /api/metrics.
DEPENDENCIES: None (uses os.cpus(), os.loadavg(), fs.stat)
RISK: LOW
ROLLBACK: Remove governor.
WHY ZERO-COST: No new dependencies.
WHY HIGH-PERFORMANCE: Prevents control-plane starvation.
```

---

### CHANGE 15: Add Watch Party state recovery + drift correction

```
FILE: mini-services/watch-party/index.ts
CURRENT BEHAVIOR: No state_revision, no generation, no reconnect state reconstruction.
  Clients can't recover state after a missed WebSocket message.
PROBLEM: Watch Party desyncs on reconnect.
PROPOSED CHANGE:
  1. Add `stateRevision` (monotonic counter) to each room. Every state change increments it.
  2. Add `generation` (increments on host change).
  3. On reconnect, client sends `lastSeenRevision`. Server sends back the full state +
     all messages with revision > lastSeenRevision.
  4. Add drift correction: every 30s, host sends a `sync` message with the current
     `server_time` + `position`. Clients adjust if drift > 2s.
DEPENDENCIES: None
RISK: MEDIUM — changes the Watch Party protocol.
ROLLBACK: Revert to stateless sync.
WHY ZERO-COST: No new dependencies.
WHY HIGH-PERFORMANCE: Prevents Watch Party desync.
```

---

### CHANGE 16: Add Cloudflare edge configuration (optional)

```
FILE: NEW FILE — cloudflare/wrangler.toml, cloudflare/worker.js
CURRENT BEHAVIOR: No Cloudflare edge configuration.
PROBLEM: No edge caching, no edge TLS termination, no edge security.
PROPOSED CHANGE:
  1. Add a minimal Cloudflare Worker (free tier: 100K req/day, 10ms CPU/req):
     - Cache HLS segments at the edge (immutable, 1 year).
     - Cache master manifests for 10 minutes.
     - Add security headers (CSP, HSTS, X-Frame-Options).
     - Route /api/* to the origin (Caddy).
  2. Document the setup in SELF_HOSTED_DEPLOYMENT.md.
  3. Make it OPTIONAL — the app works without Cloudflare (Caddy serves everything directly).
DEPENDENCIES: Cloudflare account (free tier, no payment card required for free tier)
RISK: LOW — optional layer.
ROLLBACK: Remove Worker + DNS config.
WHY ZERO-COST: Cloudflare free tier, no payment card required.
WHY HIGH-PERFORMANCE: Edge caching reduces origin load by N× for cached segments.
```

---

### CHANGE 17: Add self-hosted deployment documentation

```
FILE: NEW FILES — SELF_HOSTED_DEPLOYMENT.md, ZERO_COST_ARCHITECTURE.md, ZERO_COST_LIMITS.md,
      MEDIA_NODE_OPERATIONS.md, PRODUCTION_READINESS_REVIEW.md
CURRENT BEHAVIOR: DEPLOYMENT.md exists but is minimal (75 lines). No self-hosted deployment
  guide. No zero-cost architecture doc.
PROBLEM: No documented path to deploy without Vercel.
PROPOSED CHANGE: Create comprehensive docs covering:
  1. Self-hosted deployment on a single VPS (Caddy + Next.js + p2p-tracker + watch-party).
  2. Zero-cost architecture diagram (Cloudflare → Caddy → Next.js + Turso + local storage).
  3. Zero-cost limits table (Cloudflare free tier limits, Turso free tier limits, etc.).
  4. Media node operations guide (how to add a second owned machine).
  5. Production readiness review (updated with self-hosted path).
DEPENDENCIES: None
RISK: NONE
ROLLBACK: Delete docs.
WHY ZERO-COST: Documentation is free.
WHY HIGH-PERFORMANCE: Enables self-hosted deployment.
```

---

## 4. WHAT ALREADY EXISTED (Inventory)

### Models (20 in Prisma + 1 RateLimit in Turso)
Channel, Video, Comment, UserState, Playlist, PlaylistItem, Clip, User, Session, VideoSource, VideoRendition, VideoManifest, MediaProcessingJob, Swarm, PlaybackSession, PlaybackTelemetry, + (Turso-only: Like, Subscription, VideoView, WatchHistory, RateLimit)

### API Routes (34)
- AI (8): chapters, oracle, starters, summarize, tone, transcript, translate, trending-digest
- Auth (5): check-username, login, logout, register, session
- Videos (5): list, [id], [id]/comments, [id]/like, [id]/views
- Channels (2): [id], [id]/subscribe
- Media (6): health, telemetry, videos, [id]/playback, [id]/status, [id]/upload, [id]/manifest
- Playlists (3): list, [id], [id]/items
- Clips (2): list+create, [id]
- Misc (3): root, seed, user-state

### Lib Modules (25)
- Database: db.ts, turso-db.ts
- Media: media-worker.ts, storage.ts, media-transport.ts, local-media-cache.ts
- P2P mesh: swarm.ts, p2p-policy.ts, delivery-scheduler.ts, scarcity-engine.ts, placement-engine.ts, heat-predictor.ts, peer-scorer.ts, economy-state.ts, decision-record.ts, demand-transcoder.ts
- Security: rate-limiter.ts, request-priority.ts, feature-flags.ts
- State: user-state.ts, mashahd-bridge.ts
- Utils: format.ts, types.ts, utils.ts, seed-data.ts

### Components (43 youtube + 48 ui + 1 brand + 1 providers = 93)
- Views: home, watch, channel, category, search, trending, subscriptions, history, liked, library, favorites, watchLater, playlist, profile, settings
- Player: mashahd-player (HLS + MP4 + P2P + HUD)
- AI: ai-recap, smart-chapters, ai-watch-panel, transcript-panel, trending-digest
- Engagement: bullet-comments, clip-dialog, watch-party, support-creator, save-to-playlist, end-screen
- Navigation: header, dock, sidebar, super-app-rail, command-palette
- Chrome: splash, keyboard-shortcuts, mini-player, onboarding-tour, mood-filter, category-chips, circle-pulse
- Auth: auth-screen, avatar-picker, user-avatar, create-channel, go-live

### Mini-services (2)
- p2p-tracker (port 3003): WebSocket signaling + swarm discovery
- watch-party (port 3004): Real-time co-watch sync

### Scripts (5)
- backup-all.sh, fetch-thumbnails.ts, parse-thumbnails.ts, pre-commit-protect.sh, push-turso.ts

---

## 5. WHAT WAS NOT CHANGED (This Phase)

**No code changes were made during Phase 0.** This was inspection only. The above is the architecture/change map. Implementation begins in the next phase, following the priority order below.

---

## 6. IMPLEMENTATION PRIORITY ORDER

| Priority | Change | Effort | Impact |
|----------|--------|--------|--------|
| P0 | Change 1: Fix production build | 30min | BLOCKER — nothing deploys without this |
| P0 | Change 3: Rotate hardcoded Turso token | 15min | CRITICAL SECURITY |
| P0 | Change 2: Fix 4 TypeScript errors | 1h | Enables removing ignoreBuildErrors |
| P1 | Change 5: Fix player telemetry stale closure | 30min | Telemetry is currently useless |
| P1 | Change 4: Fix dead-code bugs (placement + economy) | 30min | Self-healing is broken |
| P1 | Change 6: Fix demand-transcoder unique tracking | 30min | Demand signals are wrong |
| P1 | Change 7: Add origin validation to p2p-tracker | 30min | Security gap |
| P1 | Change 10: Add magic-byte + ffprobe validation | 1h | Upload security |
| P1 | Change 11: Add atomic publish | 1h | Prevents partial media |
| P2 | Change 9: Add media job lease/claim + recovery | 2h | Prevents stuck jobs |
| P2 | Change 8: Add swarm authorization | 1h | P2P security |
| P2 | Change 12: Add request coalescing | 2h | Reduces origin load |
| P2 | Change 14: Add resource governor | 2h | Prevents CPU starvation |
| P2 | Change 15: Add Watch Party state recovery | 2h | Prevents desync |
| P2 | Change 13: Add observability endpoints | 2h | Enables optimization |
| P3 | Change 16: Add Cloudflare edge (optional) | 3h | Edge caching |
| P3 | Change 17: Add self-hosted deployment docs | 3h | Enables self-hosting |

**Total estimated effort:** ~25 hours for all changes.

---

## 7. ZERO-COST GUARDRAIL VERIFICATION

| Provider | Free Tier | Payment Card Required? | Status |
|----------|-----------|----------------------|--------|
| Cloudflare | 100K req/day Workers, free DNS/TLS, free Pages | ❌ No | ✅ Optional, not required |
| Turso | 500 DBs, 9 GB total, 1B row reads/month | ❌ No | ✅ Already using |
| Vercel | 100 GB bandwidth, 100 GB-hrs serverless | ❌ No (but limits media features) | ⚠️ Keep for portability, don't depend on for media |
| GitHub | Unlimited public repos | ❌ No | ✅ Already using |
| Local hardware | Unlimited | N/A (owned) | ✅ Primary media compute |

**No payment-card-dependent provider is required.** The platform can operate on: Cloudflare free + Turso free + local hardware + GitHub free.

---

## 8. REMAINING RISKS

1. **ZAI_API_KEY**: The z-ai SDK requires an API key. If the free tier is exhausted, all 7 AI features fall back to deterministic text. This is acceptable (graceful degradation) but must be documented.

2. **Single origin SPOF**: If the local hardware goes down, the platform is down. The architecture supports adding a second owned machine later (via the MediaNode abstraction in Change 19), but this isn't implemented yet.

3. **No automated tests**: Zero test coverage. Every change is verified manually. This is a risk for regression.

4. **No migration system**: Schema changes require manual `push-turso.ts` runs. Existing data may be lost on schema changes that aren't additive.

5. **browserId spoofing**: Most mutations rely on client-supplied browserId. This is acceptable for a demo but not for production with real users.

---

*End of Phase 0 inspection report. Implementation may now begin, following the priority order in Section 6.*
