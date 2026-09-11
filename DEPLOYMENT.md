# Mashahd — Deployment Guide

## Zero-Cost Single-Machine Deployment

The platform operates entirely on a single self-hosted Linux machine.

### Prerequisites

```bash
# Install system dependencies
sudo apt install ffmpeg nodejs bun redis-server

# Verify FFmpeg
ffmpeg -version
ffprobe -version
```

### 1. Clone + install

```bash
git clone <your-repo> mashahd
cd mashahd
bun install
```

### 2. Configure

```bash
cp .env.example .env
# Edit .env — set DATABASE_URL, MEDIA_STORAGE_PATH, etc.
```

### 3. Initialize the database

```bash
bun run db:push
```

### 4. Start the services

```bash
# Terminal 1 — the Next.js app (port 3000)
bun run dev

# Terminal 2 — the P2P tracker (port 3003)
cd mini-services/p2p-tracker
bun run dev
```

### 5. Reverse proxy (Caddy)

The project includes a `Caddyfile` that routes:
- `/` → Next.js (port 3000)
- `?XTransformPort=3003` → P2P tracker (port 3003)
- `?XTransformPort=3001` → any other mini-service

### 6. TLS (Let's Encrypt)

Caddy automatically provisions Let's Encrypt certificates for real domains.
For local dev, HTTP is fine.

## Optional: S3-compatible storage

Set `STORAGE_PROVIDER=s3` and configure `S3_ENDPOINT`, `S3_BUCKET`,
`S3_ACCESS_KEY`, `S3_SECRET_KEY`. Works with AWS S3, Backblaze B2,
MinIO, Cloudflare R2.

## Health checks

- `GET /api/media/health` — liveness + readiness (DB, storage, FFmpeg)

## Backups

- **Database**: `db/custom.db` — back up with `sqlite3 db/custom.db .backup`
- **Media**: `storage/` directory — rsync or restic to a backup volume
