# Mashahd — Production Classification

Per v6 spec §219.

| Component | Classification | Notes |
|-----------|---------------|-------|
| GitHub | **PRODUCTION** | Source code, CI/CD, releases |
| Vercel | **PRODUCTION** | Web/control plane |
| Turso | **PRODUCTION** | Authoritative metadata DB |
| Cloudflare R2 | **PRODUCTION** (when enabled) | Primary published media store |
| Filebase | **OPTIONAL ARCHIVE** | Cold/backup storage, not in playback path |
| Self-hosted FFmpeg | **PRODUCTION** | Media transcoding (self-hosted only) |
| WebRTC P2P | **PRODUCTION** | Browser-to-browser media |
| Local browser cache | **PRODUCTION** | Temporary distributed edge capacity |
| P2P tracker | **PRODUCTION** (after hardening) | Swarm discovery, fail-closed on errors |
| Trusted seed | **PRODUCTION OPTIONAL** | Self-hosted node seeds hot content |
| WebTransport | **PRODUCTION OPTIONAL** | Browser↔edge transport (when self-hosted) |
| MoQ | **EXPERIMENTAL** | Disabled by default (MOQ_ENABLED=false) |
| Erasure coding | **EXPERIMENTAL** | Abstraction ready, not enabled |
| ML scheduler | **FUTURE** | Deterministic algorithms for now |
| External AI (Groq/OpenRouter/NVIDIA/Gemini/HF) | **OPTIONAL / NON-CRITICAL** | Playback unaffected if all fail |
| TURN | **DISABLED BY DEFAULT** | Not required (TURN_ENABLED=false) |
| Neon Postgres | **PRODUCTION** | Analytics warehouse (optional but configured) |
| Resend | **PRODUCTION** (when domain verified) | Transactional email |
| Inngest | **PRODUCTION** | Background job queue |
| Cloudflare Workers | **PRODUCTION OPTIONAL** | Edge caching |
| Cloudflare Pages | **OPTIONAL** | Static hosting alternative |
