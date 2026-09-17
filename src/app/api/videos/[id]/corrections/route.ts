import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";
import { createNotification } from "@/lib/notify";

/**
 * Creator Corrections API (spec §66).
 *
 * Per spec §66: "Creators should be able to mark and publish corrections to
 * their videos. Where appropriate notify viewers who watched the affected
 * content."
 *
 * GET   /api/videos/[id]/corrections
 *   - Returns all corrections for the video, ordered by timestamp.
 *
 * POST  /api/videos/[id]/corrections
 *   - Body: { timestamp, originalText, correctedText, note? }
 *   - Creates a correction. Rate limited: 10/min per IP.
 *
 * PATCH /api/videos/[id]/corrections
 *   - Body: { correctionId, action: "notifyViewers" }
 *   - Sets viewersNotified = true and creates notifications for all users
 *     who watched the video.
 */

// ── Validation constants ──

const MAX_TEXT_LEN = 2000;
const MAX_NOTE_LEN = 500;
const MAX_VIEWER_NOTIFS = 500; // safety cap (matches notify.ts cap)

// ── Row shapes (cast from DB rows; we don't import generated Prisma types
//    so the file stays compatible with the lightweight Turso wrapper) ──

interface CorrectionRow {
  id: string;
  videoId: string;
  timestamp: number;
  originalText: string;
  correctedText: string;
  note: string;
  viewersNotified: boolean | number;
  createdAt: Date | string;
}

interface CorrectionOut {
  id: string;
  timestamp: number;
  originalText: string;
  correctedText: string;
  note: string;
  viewersNotified: boolean;
  createdAt: string;
}

interface VideoRowForNotify {
  id: string;
  title: string;
  thumbnailUrl: string;
  channel?: { name: string } | null;
}

interface ContinueWatchingRow {
  userId: string;
}

interface UserStateRow {
  browserId: string;
}

function toISO(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

function toBool(value: boolean | number): boolean {
  return typeof value === "boolean" ? value : value !== 0;
}

/** Format a seconds-offset as m:ss (or h:mm:ss for long videos). */
function formatTimestamp(seconds: number): string {
  const s = Math.max(0, Math.floor(seconds));
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = s % 60;
  if (h > 0) {
    return `${h}:${m.toString().padStart(2, "0")}:${sec
      .toString()
      .padStart(2, "0")}`;
  }
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

// ── GET ──

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const video = await db.video.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const corrections = (await db.videoCorrection.findMany({
    where: { videoId: id },
    orderBy: { timestamp: "asc" },
    take: 200,
  })) as CorrectionRow[];

  const out: CorrectionOut[] = corrections.map((c) => ({
    id: c.id,
    timestamp: c.timestamp,
    originalText: c.originalText,
    correctedText: c.correctedText,
    note: c.note,
    viewersNotified: toBool(c.viewersNotified),
    createdAt: toISO(c.createdAt),
  }));

  return NextResponse.json({ corrections: out });
}

// ── POST ──

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const ip = getClientIP(req);
  const rl = await rateLimit(`corr-create:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "Too many correction requests" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const body = await req.json().catch(() => ({}));

  // Validate timestamp (must be a finite non-negative number of seconds).
  const rawTs = body.timestamp;
  if (typeof rawTs !== "number" || !Number.isFinite(rawTs) || rawTs < 0) {
    return NextResponse.json(
      { error: "timestamp must be a non-negative number (seconds)" },
      { status: 400 }
    );
  }
  const timestamp = Math.floor(rawTs);

  // Validate text fields.
  const originalText: string =
    typeof body.originalText === "string" ? body.originalText.trim() : "";
  const correctedText: string =
    typeof body.correctedText === "string" ? body.correctedText.trim() : "";
  if (!originalText) {
    return NextResponse.json(
      { error: "originalText required" },
      { status: 400 }
    );
  }
  if (!correctedText) {
    return NextResponse.json(
      { error: "correctedText required" },
      { status: 400 }
    );
  }
  if (originalText.length > MAX_TEXT_LEN || correctedText.length > MAX_TEXT_LEN) {
    return NextResponse.json(
      { error: `text fields must be ≤ ${MAX_TEXT_LEN} chars` },
      { status: 400 }
    );
  }
  const note: string =
    typeof body.note === "string" ? body.note.slice(0, MAX_NOTE_LEN) : "";

  const video = await db.video.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const correction = (await db.videoCorrection.create({
    data: {
      videoId: id,
      timestamp,
      originalText: originalText.slice(0, MAX_TEXT_LEN),
      correctedText: correctedText.slice(0, MAX_TEXT_LEN),
      note,
    },
  })) as CorrectionRow;

  const out: CorrectionOut = {
    id: correction.id,
    timestamp: correction.timestamp,
    originalText: correction.originalText,
    correctedText: correction.correctedText,
    note: correction.note,
    viewersNotified: toBool(correction.viewersNotified),
    createdAt: toISO(correction.createdAt),
  };

  return NextResponse.json({ correction: out }, { status: 201 });
}

// ── PATCH ──

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const ip = getClientIP(req);
  const rl = await rateLimit(`corr-patch:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "Too many requests" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const body = await req.json().catch(() => ({}));
  const correctionId: string =
    typeof body.correctionId === "string" ? body.correctionId.slice(0, 60) : "";
  const action: unknown = body.action;

  if (!correctionId) {
    return NextResponse.json(
      { error: "correctionId required" },
      { status: 400 }
    );
  }
  if (action !== "notifyViewers") {
    return NextResponse.json(
      { error: "invalid action; expected 'notifyViewers'" },
      { status: 400 }
    );
  }

  // Find the correction — verify it belongs to this video (reject cross-video
  // patches via URL/path traversal).
  const correction = (await db.videoCorrection.findFirst({
    where: { id: correctionId, videoId: id },
  })) as CorrectionRow | null;
  if (!correction) {
    return NextResponse.json(
      { error: "correction not found" },
      { status: 404 }
    );
  }

  // Mark as notified.
  await db.videoCorrection.update({
    where: { id: correctionId },
    data: { viewersNotified: true },
  });

  // Find all viewers who watched the video. Two sources:
  //  1. ContinueWatching — a proper relational table (userId field).
  //  2. UserState.watchedVideoIds — pipe-separated string (project rule for
  //     SQLite lists). Used as a fallback so anonymous browsers without a
  //     continue-watching row still get notified.
  const [continueRows, userStateRows] = await Promise.all([
    (db.continueWatching.findMany({
      where: { videoId: id },
      select: { userId: true },
    }) as Promise<ContinueWatchingRow[]>).catch(() => [] as ContinueWatchingRow[]),
    (db.userState.findMany({
      where: { watchedVideoIds: { contains: id } },
      select: { browserId: true },
    }) as Promise<UserStateRow[]>).catch(() => [] as UserStateRow[]),
  ]);

  const recipientIds = new Set<string>();
  for (const r of continueRows) {
    if (r.userId) recipientIds.add(r.userId);
  }
  for (const r of userStateRows) {
    if (r.browserId) recipientIds.add(r.browserId);
  }

  // Safety cap (matches notify.ts cap for new-video subscriber fan-out).
  const recipients = Array.from(recipientIds).slice(0, MAX_VIEWER_NOTIFS);

  // Build notification payload.
  const videoRow = (await db.video.findUnique({
    where: { id },
    select: {
      id: true,
      title: true,
      thumbnailUrl: true,
      channel: { select: { name: true } },
    },
  })) as VideoRowForNotify | null;

  const channelName = videoRow?.channel?.name ?? "The creator";
  const videoTitle = videoRow?.title ?? "this video";
  const tsLabel = formatTimestamp(correction.timestamp);
  const correctionSummary = correction.correctedText.slice(0, 120);

  const payload = {
    title: `${channelName} posted a correction to "${videoTitle}"`,
    body: `At ${tsLabel}: ${correctionSummary}`,
    linkUrl: `/?v=watch&id=${id}&t=${correction.timestamp}`,
    thumbnailUrl: videoRow?.thumbnailUrl,
    actorName: channelName,
  };

  let notified = 0;
  for (const recipientId of recipients) {
    // createNotification is fire-and-forget (logs on error, never throws).
    await createNotification(recipientId, "system", payload);
    notified++;
  }

  return NextResponse.json({
    ok: true,
    viewersNotified: true,
    notifiedCount: notified,
    candidateCount: recipientIds.size,
    capped: recipientIds.size > MAX_VIEWER_NOTIFS,
  });
}
