# Mashahd — Media Pipeline

## Ingestion

```
Upload request
  → Validate metadata
  → Store source video
  → Create media-processing job (UPLOADING → QUEUED)
  → FFmpeg worker (PROCESSING)
  → Generate ABR renditions (PACKAGING)
  → Validate assets (VALIDATING)
  → Publish manifest + mark READY
  → Clean temporary files
```

## Job States

`UPLOADING → UPLOADED → QUEUED → PROCESSING → PACKAGING → VALIDATING → READY`

On failure: `→ FAILED` (with error message), then `→ RETRYING` (exponential backoff).

## FFmpeg Profiles

| Profile | CRF | Preset | Max Concurrent |
|---------|:---:|:------:|:-------------:|
| cpu-safe (default) | 26 | veryfast | 1 |
| balanced | 23 | medium | 2 |
| high-quality | 20 | slow | 1 |

CPU-only operation is mandatory. Hardware acceleration is used only when
the host actually supports it (never assumed).

## HLS/CMAF Structure

```
storage/
  videos/
    {videoId}/
      v1/
        master.m3u8          ← ABR master manifest
        1080p/
          index.m3u8
          init.mp4
          segment-00001.m4s
          segment-00002.m4s
          ...
        720p/
          ...
        480p/
          ...
        360p/
          ...
```

Segment duration: **6 seconds** (CMAF-friendly).

## Cache Headers

- Segments (.m4s, .mp4): `Cache-Control: public, max-age=31536000, immutable`
- Manifests (.m3u8): `Cache-Control: no-cache` (mutable)

## Backpressure

- Max concurrent transcodes (per profile)
- Job queue with retry policy
- Disk-space check before processing
- Critical disk threshold → pause new processing
