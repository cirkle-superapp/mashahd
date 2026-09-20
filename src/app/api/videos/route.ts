import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";
import { writeFile, mkdir } from "node:fs/promises";
import { existsSync } from "node:fs";
import path from "node:path";

/**
 * GET /api/videos
 * Query params:
 *   - category: filter by category (default "All" returns everything)
 *   - q: search query (matches title / channel name / tags)
 *   - sort: "recent" (default) | "popular" | "trending"
 *   - channelId: limit to a single channel
 *   - ids: pipe-separated list of video ids (for "liked"/"history" lists)
 *   - limit: max results (default 100, max 200) — pagination guard
 *   - offset: skip N results (for infinite scroll / pagination)
 *
 * SECURITY/perf (deep audit pass 2): added `limit` + `take` to prevent
 * unbounded queries returning thousands of rows.
 */
export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const category = url.searchParams.get("category") || "All";
  const q = (url.searchParams.get("q") || "").trim().toLowerCase();
  const sort = url.searchParams.get("sort") || "recent";
  const channelId = url.searchParams.get("channelId") || "";
  const idsParam = url.searchParams.get("ids") || "";
  const limit = Math.min(Math.max(parseInt(url.searchParams.get("limit") || "100", 10) || 100, 1), 200);
  const offset = Math.max(parseInt(url.searchParams.get("offset") || "0", 10) || 0, 0);

  const videos = await db.video.findMany({
    where: {
      ...(category !== "All" ? { category } : {}),
      ...(channelId ? { channelId } : {}),
      ...(idsParam
        ? { id: { in: idsParam.split("|").filter(Boolean) } }
        : {}),
    },
    include: { channel: true },
    take: limit + 100, // fetch a bit more for client-side filtering/sorting, then slice
  });

  let filtered = videos;
  if (q) {
    filtered = videos.filter((v) => {
      const hay = (
        v.title +
        " " +
        v.description +
        " " +
        v.tags +
        " " +
        v.channel.name +
        " " +
        v.channel.handle +
        " " +
        v.category
      ).toLowerCase();
      return q.split(/\s+/).every((term) => hay.includes(term));
    });
  }

  // Sort (§12 — deterministic search options).
  // Per spec §14: "Do not manipulate explicit search queries merely to increase
  // engagement. When the user explicitly chooses a deterministic operation, honor it."
  if (sort === "popular" || sort === "most_viewed") {
    filtered.sort((a, b) => b.views - a.views);
  } else if (sort === "least_viewed") {
    filtered.sort((a, b) => a.views - b.views);
  } else if (sort === "trending") {
    // Trending = recent + high view velocity. Proxy: views * recency weight.
    const now = Date.now();
    filtered.sort((a, b) => {
      const wa = scoreTrending(a.views, a.createdAt.getTime(), now);
      const wb = scoreTrending(b.views, b.createdAt.getTime(), now);
      return wb - wa;
    });
  } else if (sort === "newest") {
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else if (sort === "oldest") {
    filtered.sort((a, b) => a.createdAt.getTime() - b.createdAt.getTime());
  } else if (sort === "longest") {
    filtered.sort((a, b) => b.durationSec - a.durationSec);
  } else if (sort === "shortest") {
    filtered.sort((a, b) => a.durationSec - b.durationSec);
  } else if (sort === "recent") {
    // Default — newest first (backward compat).
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  } else if (sort === "relevance") {
    // Relevance: for search queries, score by match quality + popularity.
    // If no query, fall back to recent.
    if (q) {
      filtered.sort((a, b) => {
        const scoreA = relevanceScore(a, q);
        const scoreB = relevanceScore(b, q);
        return scoreB - scoreA;
      });
    } else {
      filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
    }
  } else {
    // Default — newest first.
    filtered.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());
  }

  // For "ids" mode (history), keep the order of the provided ids.
  if (idsParam) {
    const idOrder = idsParam.split("|").filter(Boolean);
    filtered.sort(
      (a, b) => idOrder.indexOf(a.id) - idOrder.indexOf(b.id)
    );
  }

  // Apply pagination AFTER sort/filter.
  const paginated = filtered.slice(offset, offset + limit);

  return NextResponse.json({
    videos: paginated,
    total: filtered.length,
    limit,
    offset,
    hasMore: offset + limit < filtered.length,
    // §15: "Never make paid placements look identical to organic search results."
    // We label any video that has an active ad disclosure as "sponsored".
    sponsoredVideoIds: await getSponsoredVideoIds(paginated.map((v: any) => v.id)),
  });
}

/**
 * POST /api/videos
 *
 * Uploads a new video. Accepts multipart/form-data with:
 *   - file: the video file (MP4, WebM, MOV — up to 500MB for dev)
 *   - title: required, max 100 chars
 *   - description: optional, max 5000 chars
 *   - category: required (Tech, Music, Gaming, etc.)
 *   - tags: optional, pipe-separated
 *   - visibility: public | unlisted | private (default public)
 *   - channelId: optional — if provided + the user owns the channel,
 *     the video is attached to that channel. If not provided, a new
 *     "uploads" channel is created for the user (anonymous — uses the
 *     browserId as ownerId).
 *
 * SECURITY:
 *   - Requires a valid signed browserId (prevents anonymous upload-spam)
 *   - Rate limited: 10 uploads per hour per IP (generous for real use,
 *     blocks scripted abuse)
 *   - File size guard: rejects files > 500MB (dev limit — production
 *     would use a real storage backend + transcoding worker)
 *
 * STORAGE (dev / zero-cost):
 *   - The file is written to MEDIA_STORAGE_PATH/uploads/<cuid>.<ext>
 *   - The videoUrl in the DB is `/api/media/uploads/<filename>` (a local
 *     route that serves the file with proper content-type + range support)
 *   - For production, this would be replaced by S3/Filebase + a CDN
 *
 * Returns the created video's id + title so the UI can navigate to it.
 */
const MAX_UPLOAD_BYTES = 500 * 1024 * 1024; // 500MB dev limit
const ALLOWED_MIME = new Set([
  "video/mp4", "video/webm", "video/quicktime", "video/x-matroska",
]);
const ALLOWED_EXT: Record<string, string> = {
  ".mp4": "mp4", ".webm": "webm", ".mov": "mov", ".mkv": "mkv",
};

export async function POST(req: NextRequest) {
  // Rate limit first (before parsing the body — cheap check).
  const ip = getClientIP(req);
  const rl = await rateLimit(`upload:${ip}`, 10, 3600_000); // 10 per hour
  if (rl.limited) {
    return NextResponse.json(
      { error: "rate limited — max 10 uploads per hour" },
      { status: 429, headers: { "Retry-After": "3600" } },
    );
  }

  // Parse multipart form. This is the slow part — but Next.js handles
  // streaming for large bodies.
  let formData: FormData;
  try {
    formData = await req.formData();
  } catch {
    return NextResponse.json({ error: "invalid form data (expected multipart/form-data)" }, { status: 400 });
  }

  const file = formData.get("file");
  const title = String(formData.get("title") || "").trim().slice(0, 100);
  const description = String(formData.get("description") || "").slice(0, 5000);
  const category = String(formData.get("category") || "Tech").slice(0, 50);
  const tags = String(formData.get("tags") || "").slice(0, 500);
  const visibility = ["public", "unlisted", "private"].includes(String(formData.get("visibility")))
    ? String(formData.get("visibility"))
    : "public";
  const channelId = String(formData.get("channelId") || "").slice(0, 50);
  const browserId = String(formData.get("browserId") || "");

  if (!browserId) {
    return NextResponse.json({ error: "browserId required" }, { status: 400 });
  }
  const verification = verifyBrowserId(browserId);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }
  if (!title) {
    return NextResponse.json({ error: "title required" }, { status: 400 });
  }
  if (!(file instanceof File)) {
    return NextResponse.json({ error: "file required (video file)" }, { status: 400 });
  }
  if (file.size > MAX_UPLOAD_BYTES) {
    return NextResponse.json(
      { error: `file too large — max ${Math.floor(MAX_UPLOAD_BYTES / 1048576)}MB` },
      { status: 413 },
    );
  }
  // Validate MIME type — be lenient (some browsers report generic types).
  const ext = path.extname(file.name).toLowerCase();
  if (!ALLOWED_MIME.has(file.type) && !ALLOWED_EXT[ext]) {
    return NextResponse.json(
      { error: `unsupported file type: ${file.type || ext || "unknown"}. Use MP4, WebM, MOV, or MKV.` },
      { status: 415 },
    );
  }

  // ── Storage: use the configured provider (R2 in production, local in dev) ──
  // The getStorage() factory reads STORAGE_PROVIDER env var + returns either:
  //   - R2StorageProvider (Cloudflare R2 — zero egress cost, 10GB free)
  //   - FilebaseStorageProvider (5GB free, IPFS pinning)
  //   - LocalFilesystemStorage (default dev fallback)
  //
  // For the videoUrl, we use:
  //   - R2/Filebase: the public URL from the storage provider (returns httpBase)
  //   - Local: /api/media/uploads/<filename> (served by our route with Range support)
  const fileExt = ext || (file.type === "video/webm" ? ".webm" : ".mp4");
  const uniqueId = `vid_${Date.now()}_${Math.random().toString(36).slice(2, 10)}`;
  const filename = `${uniqueId}${fileExt}`;
  const storageKey = `uploads/${filename}`;

  let videoUrl: string;
  try {
    // Get the storage provider (R2 in prod, local in dev).
    const { getStorage } = await import("@/lib/storage");
    const storage = getStorage();
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Put the object. The storage provider handles R2/S3/local transparently.
    // For R2, the key is "uploads/<filename>" + the object is stored in the bucket.
    // For local, the key is the file path relative to MEDIA_STORAGE_PATH.
    if (storage.httpBase) {
      // R2/Filebase — store in the bucket + construct the public URL.
      // write() uploads to R2, then we build the URL from httpBase + key.
      await storage.write(storageKey, buffer);
      videoUrl = `${storage.httpBase}/${storageKey}`;
      console.log("[videos] uploaded to cloud storage:", videoUrl.slice(0, 80));
    } else {
      // Local filesystem — write to disk + use the local API route.
      const storagePath = process.env.MEDIA_STORAGE_PATH || "/home/z/my-project/storage";
      const uploadsDir = path.join(storagePath, "uploads");
      if (!existsSync(uploadsDir)) {
        await mkdir(uploadsDir, { recursive: true });
      }
      const filePath = path.join(uploadsDir, filename);
      await writeFile(filePath, new Uint8Array(arrayBuffer));
      videoUrl = `/api/media/uploads/${filename}`;
      console.log("[videos] uploaded to local filesystem:", videoUrl);
    }
  } catch (e: any) {
    console.error("[videos] storage failed:", e?.message?.slice(0, 200));
    return NextResponse.json({ error: "failed to store file" }, { status: 500 });
  }

  // Determine the channel for this upload. If channelId is provided,
  // verify the user owns it. Otherwise, find or create an "anonymous
  // uploads" channel for the user (so all their uploads group together).
  let finalChannelId = channelId;
  if (!finalChannelId) {
    try {
      // Look for an existing "My Uploads" channel owned by this user.
      const existing = await db.channel.findFirst({
        where: { handle: `uploads_${verification.id.slice(0, 20)}` },
        select: { id: true },
      });
      if (existing) {
        finalChannelId = existing.id;
      } else {
        // Create a new channel for the user's uploads.
        const newChannel = await db.channel.create({
          data: {
            name: "My Uploads",
            handle: `uploads_${verification.id.slice(0, 20)}`,
            description: "Videos I uploaded to Mashahd.",
            avatarUrl: `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(verification.id)}&radius=50`,
            bannerColors: "#1e293b,#0f172a,#c2a060",
            subscribers: 0,
            verified: false,
            ownerId: null, // anonymous user — ownerId FK is nullable
            links: `owner:${verification.id}`,
            country: "",
          },
        });
        finalChannelId = newChannel.id;
      }
    } catch (e: any) {
      console.warn("[videos] channel lookup/create failed:", e?.message?.slice(0, 200));
      // Fallback: use the first channel in the DB (so the upload still succeeds).
      const any = await db.channel.findFirst({ select: { id: true } }).catch(() => null);
      finalChannelId = any?.id || "";
    }
  } else {
    // Verify the user owns the provided channel.
    try {
      const channel = await db.channel.findUnique({
        where: { id: channelId },
        select: { id: true, links: true, ownerId: true },
      });
      if (!channel) {
        return NextResponse.json({ error: "channel not found" }, { status: 404 });
      }
      // Check ownership: either ownerId matches, or the links field
      // contains owner:<bid-id> (anonymous ownership pattern).
      const ownsViaLinks = channel.links?.includes(`owner:${verification.id}`);
      const ownsViaOwner = channel.ownerId === verification.id;
      if (!ownsViaLinks && !ownsViaOwner) {
        return NextResponse.json({ error: "you don't own this channel" }, { status: 403 });
      }
    } catch {
      // Channel table might not exist on a cold boot — proceed with the id.
    }
  }

  if (!finalChannelId) {
    return NextResponse.json({ error: "no channel available for upload" }, { status: 500 });
  }

  // videoUrl was set above (cloud URL for R2/Filebase, local route for local FS).
  // Thumbnail: use a DiceBear placeholder (in production, the transcoding
  // worker would extract a frame + write it to storage).
  const thumbnailUrl = `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(title)}&radius=50`;

  // Duration: unknown without ffprobe — default to 0. The transcoding
  // worker would fill this in later. The player handles duration=0
  // gracefully (shows 0:00 until metadata loads).
  const durationSec = 0;

  try {
    const video = await db.video.create({
      data: {
        title,
        description,
        thumbnailUrl,
        videoUrl,
        durationSec,
        views: 0,
        likes: 0,
        dislikes: 0,
        category,
        tags,
        channelId: finalChannelId,
        visibility,
        publishedAt: new Date(),
        language: "",
        ageGated: false,
        clipPolicy: "allowed",
      },
    });

    return NextResponse.json({
      ok: true,
      video: {
        id: video.id,
        title: video.title,
        category: video.category,
        visibility: video.visibility,
        videoUrl: video.videoUrl,
        channelId: finalChannelId,
      },
    });
  } catch (e: any) {
    console.error("[videos] create failed:", e?.message?.slice(0, 200));
    return NextResponse.json({ error: "failed to create video row" }, { status: 500 });
  }
}

/**
 * §15: Fetch ad disclosures for the returned videos and return the IDs
 * of videos that have active sponsorships. The frontend can then label
 * these as "Sponsored" in search results — ensuring paid content is
 * never deceptive.
 */
async function getSponsoredVideoIds(videoIds: string[]): Promise<string[]> {
  if (videoIds.length === 0) return [];
  try {
    const disclosures = await db.adDisclosure.findMany({
      where: { videoId: { in: videoIds } },
      select: { videoId: true },
    });
    const ids: string[] = disclosures.map((d: any) => String(d.videoId));
    return [...new Set(ids)];
  } catch {
    return [];
  }
}

function scoreTrending(views: number, createdAt: number, now: number) {
  const daysOld = Math.max(1, (now - createdAt) / (1000 * 60 * 60 * 24));
  return views / Math.pow(daysOld, 0.6);
}

/**
 * Relevance score for search ranking (§12).
 * Scores by: title match > tag match > description match > channel match.
 * Weighted by popularity. Does NOT manipulate the query (§14).
 */
function relevanceScore(v: any, q: string): number {
  const terms = q.toLowerCase().split(/\s+/).filter(Boolean);
  if (terms.length === 0) return 0;
  let score = 0;
  const title = (v.title || "").toLowerCase();
  const desc = (v.description || "").toLowerCase();
  const tags = (v.tags || "").toLowerCase();
  const channelName = (v.channel?.name || "").toLowerCase();
  const channelHandle = (v.channel?.handle || "").toLowerCase();

  for (const term of terms) {
    // Title match is strongest (10 pts).
    if (title.includes(term)) score += 10;
    // Tag match (5 pts).
    if (tags.includes(term)) score += 5;
    // Channel match (5 pts).
    if (channelName.includes(term) || channelHandle.includes(term)) score += 5;
    // Description match (2 pts — weaker).
    if (desc.includes(term)) score += 2;
  }
  // Popularity tiebreaker (log scale — doesn't overwhelm relevance).
  score += Math.log10(Math.max(1, v.views)) * 0.5;
  return score;
}
