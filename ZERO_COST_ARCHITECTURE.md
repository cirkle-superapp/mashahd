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

---

## Open-Data Layer (Pass 99) — FREE FOREVER, fully offline

The platform ships with 8 curated open-source datasets under `data/open-data/`.
Every dataset is **downloaded once at build time and served from disk** — there
are **zero network calls at runtime**, **zero API keys**, and **zero billing
exposure** on the data layer.

| Dataset | Records | License | Source |
|---------|---------|---------|--------|
| countries | 250 | MIT | mledoze/countries (github.com/mledoze/countries) |
| regions | 6 | MIT (derived) | derived from countries.json |
| languages | 153 | MIT (derived) | derived from countries.json language fields |
| currencies | 162 | MIT (derived) | derived from countries.json currency fields |
| emoji | 1,870 | MIT | github/gemoji (github.com/github/gemoji) |
| country-coordinates | 250 | MIT (derived) | derived from countries.json latlng fields |
| timezone-to-country | 312 | Public domain | IANA Time Zone Database (data.iana.org/time-zones) |
| video-taxonomy | 19 categories | CC0 (public domain) | curated from iTunes/YouTube conventions |
| **TOTAL** | **3,133** | | |

### Endpoints
- `GET /api/open-data` — manifest (proves zero-cost/billing-free to auditors)
- `GET /api/open-data/countries` — 250 countries with computed flag emojis
- `GET /api/open-data/geo?tz=Africa/Cairo` — timezone → country resolution
- `GET /api/open-data/taxonomy` — video categories, ratings, moods
- `GET /api/open-data/languages` — 153 languages with speaker countries

### Competitive Edge ("outsmart competitors")
| Competitor weakness | Mashahd advantage |
|---|---|
| Hardcoded 5-country selector | 250 countries, grouped by 6 regions, auto-detected via timezone |
| Paid GeoIP API ($0.001/lookup) | Free IANA tzdb timezone→country (zero cost, zero PII) |
| English-only | 153 languages with native names + speaker country index |
| No currency metadata | 162 ISO-4217 currencies with symbols |
| Generic category list | 19 curated categories + 5 content ratings + 6 mood presets |

### Billing Risk Assessment
**NONE.** Every dataset is committed to the repo and read from disk. There is
no API key to revoke, no rate limit to hit, no subscription to lapse, and no
network dependency that could fail. The data layer is as durable as the repo
itself.
