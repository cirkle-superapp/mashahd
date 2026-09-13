# Mashahd — Zero-Cost Architecture

**Version:** 2.0 (post-Phase 0 audit + fixes)
**Objective:** Zero mandatory recurring infrastructure cost. Self-hostable. Cloud-optional.

---

## Architecture Diagram

```
                    INTERNET
                       │
                       ▼
              ┌─────────────────┐
              │  CLOUDFLARE FREE │  (optional edge layer)
              │  DNS + TLS + CDN │
              │  Workers (tiny)  │
              └────────┬────────┘
                       │ (Cloudflare Tunnel or direct)
                       ▼
              ┌─────────────────┐
              │     CADDY        │  (local gateway, port 81)
              │  TLS + routing   │
              └────────┬────────┘
                       │
          ┌────────────┼────────────┐
          ▼            ▼            ▼
   ┌──────────┐ ┌──────────┐ ┌──────────┐
   │ Next.js   │ │ p2p-     │ │ watch-   │
   │ :3000     │ │ tracker  │ │ party    │
   │ (control  │ │ :3003    │ │ :3004    │
   │  plane)   │ │          │ │          │
   └─────┬────┘ └──────────┘ └──────────┘
         │
         ├──→ TURSO (free DB) — control-plane state
         ├──→ FILEBASE (free 5GB, no payment card) — primary media store
         ├──→ LOCAL STORAGE — temp/compute (originals + HLS during processing)
         └──→ FFMPEG WORKERS — transcode + package
```

> **NOTE**: Cloudflare R2 was originally planned as the primary media store,
> but R2 requires a payment card to enable. **Filebase** is used instead —
> it's S3-compatible with IPFS pinning, 5GB free, and requires NO payment card.
> R2 code remains as an optional provider (can be activated if a payment card
> is added later).

## Components

| Component | Cost | Payment Card? | Required? |
|-----------|------|:---:|:---:|
| Cloudflare Free | $0 | No | Optional (edge cache) |
| Turso Free | $0 | No | Yes (metadata DB) |
| **Filebase** | $0 (5GB) | **No** | Yes (primary media store) |
| Neon Postgres | $0 (0.5GB) | No | Optional (analytics) |
| Local hardware | $0 (owned) | N/A | Yes (FFmpeg compute) |
| GitHub Free | $0 | No | Yes (code) |
| Vercel Free | $0 | No | Yes (web/control plane) |
| Resend | $0 (3K emails/mo) | No | Optional (email) |
| Inngest | $0 (25K invocations) | No | Optional (background jobs) |
| Cloudflare R2 | $0 (10GB) | **Yes** | Optional (not required) |
| 5 AI providers | $0 | No | Optional (non-critical) |

## Zero-Cost Limits

| Provider | Free Tier Limit | What Happens at Limit |
|----------|----------------|----------------------|
| Cloudflare Workers | 100K req/day, 10ms CPU/req | Edge functions stop; origin still serves |
| Turso | 500 DBs, 9GB total, 1B reads/month | DB reads fail; app shows error |
| Vercel | 100GB bandwidth, 100GB-hrs serverless | Serverless functions fail; self-hosted still works |
| Local hardware | Unlimited (owned) | N/A |

## What's NOT in Turso

Video bytes, CMAF segments, P2P packet state, and high-frequency peer telemetry are NEVER written to Turso. Only durable control-plane state lives there.

## Provider Independence

No component is irreplaceably dependent on one vendor:
- DB: Turso → any libSQL/SQLite
- Edge: Cloudflare → any CDN (or none — Caddy serves directly)
- Code: GitHub → any Git host
- Media compute: local FFmpeg → any machine with FFmpeg
