# Mashahd — Provider Responsibility Matrix

Per v6 spec §209. This table defines the role of each provider/layer in the
Mashahd architecture. It must be maintained and kept in sync with the actual
implementation.

| Provider/Layer | Primary responsibility | Must carry video? | Critical? | Free tier? | Payment card? |
|---|---|---:|---:|---|---|
| **GitHub** | Source code, CI/CD, version control, releases | No | Yes | Unlimited public repos | No |
| **Vercel** | Next.js web app, React frontend, control-plane APIs | No (ideally) | Yes | 100GB bandwidth, 100GB-hrs serverless | No |
| **Turso** | Authoritative metadata/control DB (users, videos, jobs, swarms) | No | Yes | 500 DBs, 9GB, 1B reads/month | No |
| **Filebase** | **Primary published media store** (CMAF, manifests, thumbnails, IPFS pinning) | **Yes** | **Yes** | 5GB storage, 5GB egress/month | **No** |
| **Self-hosted node** | FFmpeg transcoding, P2P tracker, trusted seed, optional edge | Optional | Yes | Unlimited (owned hardware) | N/A |
| **Neon Postgres** | Analytics warehouse (telemetry, heat history, AI usage) | No | No | 0.5GB, unlimited reads | No |
| **Resend** | Transactional email (welcome, notifications) | No | No | 3K emails/month | No |
| **Inngest** | Background job queue (transcode, GC, reconciliation) | No | No | 25K invocations/month | No |
| **Cloudflare R2** | **OPTIONAL** media store (alternative to Filebase, needs payment card) | Optional | No | 10GB storage, zero egress | **Yes** |
| **Cloudflare Workers** | Edge caching, TLS, DNS | No | No | 100K req/day | No |
| **WebRTC** | Browser-to-browser media distribution (P2P) | Yes | No | N/A (browser-native) | N/A |
| **WebTransport** | Browser↔self-hosted-edge transport (optional) | Optional | No | N/A (self-hosted) | N/A |
| **MoQ** | Future media transport (experimental) | No initially | No | N/A | N/A |
| **Groq** | Ultra-fast LLM inference (AI features) | No | No | 30 req/min, 14,400 req/day | No |
| **OpenRouter** | Multi-model LLM access (Claude, GPT, Llama, etc.) | No | No | Free tier models available | No |
| **NVIDIA** | NIM API LLM inference | No | No | 1000 credits/month | No |
| **Gemini** | Google quality LLM | No | No | 15 req/min, 1500 req/day | No |
| **Hugging Face** | Free ML model inference (last resort) | No | No | Unlimited (rate-limited) | No |
| **Cloudflare Workers** | Edge caching, TLS, DNS, security headers | No | No | 100K req/day, 10ms CPU/req | No |
| **Cloudflare Pages** | Static frontend hosting (optional) | No | No | Unlimited sites | No |

## Cost Summary

| Category | Monthly cost | Notes |
|----------|:---:|---|
| Source control | $0 | GitHub free |
| Web hosting | $0 | Vercel free |
| Database | $0 | Turso free |
| Media storage | $0 | R2 free (10GB) + Filebase free (5GB) |
| Media compute | $0 | Self-hosted (owned hardware) |
| P2P | $0 | Browser-native WebRTC |
| AI | $0 | 5 providers, all free tiers |
| Edge | $0 | Cloudflare free |
| **Total** | **$0** | **Zero mandatory recurring cost** |

## Failure Impact Matrix

| Provider fails | Impact on playback | Impact on other features |
|---|---|---|
| GitHub | None (code already deployed) | No new deployments |
| Vercel | None (if media URLs remain valid) | No API access, no new uploads |
| Turso | None (existing media URLs work) | No new sessions, no P2P joins (fail-closed) |
| R2 | Playback fails for uncached media | No new media publishing |
| Self-hosted node | P2P unavailable (HTTP fallback) | No new transcoding, no Watch Party |
| Filebase | None (not in playback path) | No archive updates |
| All AI providers | None (playback unaffected) | AI features use deterministic fallbacks |
| Cloudflare | None (Vercel serves directly) | No edge caching |
