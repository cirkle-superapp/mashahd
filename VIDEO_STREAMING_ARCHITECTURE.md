# Mashahd — Video Streaming Architecture

## Overview

Mashahd implements a **zero-cost hybrid CDN + WebRTC P2P video streaming
platform**. The core principle:

```
ORIGIN / CDN = AUTHORITATIVE SOURCE
P2P         = DELIVERY OPTIMIZATION / CACHE ACCELERATOR
```

P2P is NEVER a mandatory dependency. If P2P fails, playback continues via
normal HTTP/HTTPS HLS delivery.

## Architecture

```
                         ┌────────────────────┐
                         │      Web Client    │
                         │ React + hls.js     │
                         └─────────┬──────────┘
                                   │
                    ┌──────────────┴──────────────┐
                    │                             │
             API / Control Plane             P2P Signaling
                    │                             │
                    ▼                             ▼
          ┌──────────────────┐          ┌──────────────────┐
          │ Next.js API      │          │ WebRTC Tracker   │
          │ (App Router)     │          │ (mini-service)   │
          └────────┬─────────┘          └────────┬─────────┘
                   │                             │
          ┌────────┼───────────────┐             │
          ▼        ▼               ▼             ▼
     SQLite   Storage          FFmpeg       WebRTC peers
              (local FS)        worker       (peer ⇄ peer)
                                                  │
                                        HTTP fallback
                                                  ▼
                                        Origin / HTTP CDN
                                        (HLS/CMAF segments)
```

## Media Format

- **HLS + CMAF + fragmented MP4 (fMP4)**
- Segment duration: **6 seconds**
- ABR ladder: 1080p / 720p / 480p / 360p (only renditions ≤ source height)
- Immutable versioned paths: `/video/{videoId}/{manifestVersion}/master.m3u8`

## Components

| Component | Location |
|-----------|----------|
| Storage abstraction | `src/lib/storage.ts` |
| FFmpeg worker | `src/lib/media-worker.ts` |
| Swarm ID | `src/lib/swarm.ts` |
| P2P policy engine | `src/lib/p2p-policy.ts` |
| React player | `src/components/youtube/mashahd-player.tsx` |
| WebSocket tracker | `mini-services/p2p-tracker/index.ts` |
| Media API routes | `src/app/api/media/` |
| Health checks | `GET /api/media/health` |

## API Endpoints

| Method | Route | Purpose |
|--------|-------|---------|
| POST | `/api/media/videos` | Create video + job |
| POST | `/api/media/videos/:id/upload` | Upload source file |
| GET | `/api/media/videos/:id/status` | Processing status |
| GET | `/api/media/videos/:id/manifest/[...path]` | Serve HLS assets |
| GET | `/api/media/videos/:id/playback` | Playback session metadata |
| POST | `/api/media/telemetry` | Batched player telemetry |
| GET | `/api/media/health` | Liveness + readiness probe |
