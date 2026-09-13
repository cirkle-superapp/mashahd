# Mashahd — Self-Hosted Deployment Guide

This guide deploys Mashahd on a single VPS (or owned machine) with zero
mandatory recurring cost. Vercel is optional (for portability), not required.

## Prerequisites

- A VPS or owned machine with:
  - Linux (Ubuntu 22.04+ recommended)
  - 2+ CPU cores, 4GB+ RAM, 50GB+ disk
  - Node.js 20+ (or Bun 1.1+)
  - FFmpeg 7+ (`apt install ffmpeg`)
  - Caddy 2+ (`apt install caddy`)
- A Turso account (free tier, no payment card)
- A GitHub account (free, for code hosting)

## Step 1: Clone + Install

```bash
git clone https://github.com/cirkle-superapp/mashahd.git
cd mashahd
bun install   # or npm install
```

## Step 2: Configure Environment

```bash
cp .env.example .env
# Edit .env:
#   DATABASE_URL=file:./db/custom.db
#   TURSO_URL=libsql://your-db.turso.io
#   TURSO_AUTH_TOKEN=your-token
#   MEDIA_STORAGE_PATH=/var/lib/mashahd/storage
#   FFMPEG_PATH=ffmpeg
#   FFPROBE_PATH=ffprobe
#   ALLOWED_ORIGINS=https://your-domain.com
```

## Step 3: Push Schema to Turso

```bash
bun run db:push          # local SQLite
set -a && source .env && set +a
bun run scripts/push-turso.ts   # Turso
```

## Step 4: Build

```bash
bun run build
```

This produces `.next/standalone/` — a self-contained Next.js server.

## Step 5: Configure Caddy

`/etc/caddy/Caddyfile`:

```
your-domain.com {
    reverse_proxy localhost:3000

    # WebSocket upgrade for p2p-tracker
    handle /api/p2p* {
        reverse_proxy localhost:3003
    }

    # WebSocket upgrade for watch-party
    handle /api/party* {
        reverse_proxy localhost:3004
    }

    # Static media caching
    handle /api/media/videos/*/manifest/* {
        header Cache-Control "public, max-age=31536000, immutable"
        reverse_proxy localhost:3000
    }
}
```

## Step 6: Start Services

Create a systemd service (or use PM2/screen):

```bash
# Start the Next.js app
NODE_ENV=production bun .next/standalone/server.js &

# Start the p2p-tracker
cd mini-services/p2p-tracker && bun run dev &

# Start the watch-party service
cd mini-services/watch-party && bun run dev &
```

## Step 7: Optional Cloudflare Edge

1. Add your domain to Cloudflare (free)
2. Set DNS A record to your VPS IP
3. Enable Cloudflare proxy (orange cloud)
4. (Optional) Create a Worker for edge caching of HLS segments

## Verification

```bash
# Health check
curl https://your-domain.com/api/media/health

# Readiness check
curl https://your-domain.com/api/ready

# Metrics
curl https://your-domain.com/api/metrics
```

## Adding a Second Media Node (Future)

The architecture supports adding a second owned machine:
1. Install FFmpeg + the media-worker on the new machine
2. Point it at the same Turso database
3. The job-manager's lease/claim mechanism handles multi-worker coordination
4. Caddy routes /api/media/* to a load balancer (HAProxy, or Caddy's built-in LB)
