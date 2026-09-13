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
         ├──→ LOCAL STORAGE — media files (originals + HLS)
         └──→ FFMPEG WORKERS — transcode + package
```

## Components

| Component | Cost | Payment Card? | Required? |
|-----------|------|:---:|:---:|
| Cloudflare Free | $0 | No | Optional |
| Turso Free | $0 | No | Yes (DB) |
| Local hardware | $0 (owned) | N/A | Yes (media compute) |
| GitHub Free | $0 | No | Yes (code) |
| Vercel Free | $0 | No | Optional (portability) |

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
