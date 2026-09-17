import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * Video Relationships API (spec §41).
 *
 * GET    /api/videos/[id]/relationships?type=<relationType>
 *   - Returns all relationships for the video, optionally filtered by type.
 *   - Includes the related video's data (title, thumbnailUrl, channel name).
 *
 * POST   /api/videos/[id]/relationships
 *   - Body: { relatedVideoId, relationType, note?, createdBy? }
 *   - Upserts (unique on [videoId, relatedVideoId, relationType]).
 *   - Rate limited: 20/min per IP.
 *
 * DELETE /api/videos/[id]/relationships
 *   - Body: { relatedVideoId, relationType }
 *   - Deletes a specific relationship.
 */

// ── Whitelists (kept in sync with prisma/schema.prisma §41) ──

const RELATION_TYPES = [
  "earlier",
  "later",
  "response",
  "correction",
  "source",
  "tutorial",
  "same_topic",
  "same_creator",
  "other",
] as const;
type RelationType = (typeof RELATION_TYPES)[number];

const CREATED_BY_VALUES = ["creator", "system", "community"] as const;
type CreatedBy = (typeof CREATED_BY_VALUES)[number];

const RELATION_TYPE_SET: ReadonlySet<string> = new Set(RELATION_TYPES);
const CREATED_BY_SET: ReadonlySet<string> = new Set(CREATED_BY_VALUES);

function isRelationType(value: unknown): value is RelationType {
  return typeof value === "string" && RELATION_TYPE_SET.has(value);
}

function isCreatedBy(value: unknown): value is CreatedBy {
  return typeof value === "string" && CREATED_BY_SET.has(value);
}

// ── Row shapes (DB rows are cast; we don't import the generated Prisma types
//    to stay compatible with the lightweight Turso wrapper used in production) ──

interface RelationshipRow {
  id: string;
  videoId: string;
  relatedVideoId: string;
  relationType: string;
  note: string;
  createdBy: string;
  createdAt: Date | string;
}

interface RelatedVideoRow {
  id: string;
  title: string;
  thumbnailUrl: string;
  channel?: { name: string } | null;
}

interface RelationshipOut {
  id: string;
  relationType: string;
  note: string;
  createdBy: string;
  createdAt: string;
  video: {
    id: string;
    title: string;
    thumbnailUrl: string;
    channel: { name: string };
  } | null;
}

function toISO(value: Date | string): string {
  return value instanceof Date ? value.toISOString() : String(value);
}

// ── GET ──

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const typeParam = url.searchParams.get("type");

  // Optional filter. If present but invalid, return 400 (don't silently return []).
  let relationTypeFilter: string | undefined;
  if (typeParam) {
    if (!isRelationType(typeParam)) {
      return NextResponse.json(
        { error: "invalid relationType", allowed: RELATION_TYPES },
        { status: 400 }
      );
    }
    relationTypeFilter = typeParam;
  }

  const video = await db.video.findUnique({
    where: { id },
    select: { id: true },
  });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const where: { videoId: string; relationType?: string } = { videoId: id };
  if (relationTypeFilter) where.relationType = relationTypeFilter;

  const relationships = (await db.videoRelationship.findMany({
    where,
    orderBy: { createdAt: "desc" },
    take: 200,
  })) as RelationshipRow[];

  // Bulk-fetch the related videos + their channels to avoid N+1 queries.
  const relatedIds = Array.from(
    new Set(relationships.map((r) => r.relatedVideoId))
  );
  const relatedVideos: RelatedVideoRow[] =
    relatedIds.length > 0
      ? ((await db.video.findMany({
          where: { id: { in: relatedIds } },
          include: { channel: { select: { name: true } } },
        })) as RelatedVideoRow[])
      : [];

  const videoMap = new Map<string, RelatedVideoRow>();
  for (const v of relatedVideos) videoMap.set(v.id, v);

  const out: RelationshipOut[] = relationships.map((r) => {
    const rv = videoMap.get(r.relatedVideoId);
    return {
      id: r.id,
      relationType: r.relationType,
      note: r.note,
      createdBy: r.createdBy,
      createdAt: toISO(r.createdAt),
      video: rv
        ? {
            id: rv.id,
            title: rv.title,
            thumbnailUrl: rv.thumbnailUrl,
            channel: { name: rv.channel?.name ?? "Unknown" },
          }
        : null,
    };
  });

  return NextResponse.json({ relationships: out });
}

// ── POST ──

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const ip = getClientIP(req);
  const rl = await rateLimit(`rel-create:${ip}`, 20, 60_000);
  if (rl.limited) {
    return NextResponse.json(
      { error: "Too many relationship requests" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const body = await req.json().catch(() => ({}));

  const relatedVideoId: string =
    typeof body.relatedVideoId === "string"
      ? body.relatedVideoId.slice(0, 60)
      : "";
  if (!relatedVideoId) {
    return NextResponse.json(
      { error: "relatedVideoId required" },
      { status: 400 }
    );
  }
  if (relatedVideoId === id) {
    return NextResponse.json(
      { error: "cannot relate a video to itself" },
      { status: 400 }
    );
  }
  if (!isRelationType(body.relationType)) {
    return NextResponse.json(
      { error: "invalid relationType", allowed: RELATION_TYPES },
      { status: 400 }
    );
  }

  const note: string =
    typeof body.note === "string" ? body.note.slice(0, 500) : "";
  const createdBy: CreatedBy = isCreatedBy(body.createdBy)
    ? body.createdBy
    : "system";

  // Verify both videos exist (reject dangling relationships).
  const [video, relatedVideo] = await Promise.all([
    db.video.findUnique({ where: { id }, select: { id: true } }),
    db.video.findUnique({ where: { id: relatedVideoId }, select: { id: true } }),
  ]);
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }
  if (!relatedVideo) {
    return NextResponse.json(
      { error: "related video not found" },
      { status: 404 }
    );
  }

  // Upsert on [videoId, relatedVideoId, relationType]. We do this as a
  // findFirst + create/update pair because (a) the Prisma client's compound
  // unique-key syntax isn't supported by the lightweight Turso wrapper used
  // in production, and (b) findFirst with explicit field-level where clauses
  // works on both backends.
  const existing = (await db.videoRelationship.findFirst({
    where: {
      videoId: id,
      relatedVideoId,
      relationType: body.relationType,
    },
  })) as RelationshipRow | null;

  let relationship: RelationshipRow;
  if (existing) {
    relationship = (await db.videoRelationship.update({
      where: { id: existing.id },
      data: { note, createdBy },
    })) as RelationshipRow;
  } else {
    relationship = (await db.videoRelationship.create({
      data: {
        videoId: id,
        relatedVideoId,
        relationType: body.relationType,
        note,
        createdBy,
      },
    })) as RelationshipRow;
  }

  return NextResponse.json({ relationship }, { status: existing ? 200 : 201 });
}

// ── DELETE ──

export async function DELETE(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  const body = await req.json().catch(() => ({}));
  const relatedVideoId: string =
    typeof body.relatedVideoId === "string"
      ? body.relatedVideoId.slice(0, 60)
      : "";
  if (!relatedVideoId) {
    return NextResponse.json(
      { error: "relatedVideoId required" },
      { status: 400 }
    );
  }
  if (!isRelationType(body.relationType)) {
    return NextResponse.json(
      { error: "invalid relationType", allowed: RELATION_TYPES },
      { status: 400 }
    );
  }

  const result = await db.videoRelationship.deleteMany({
    where: {
      videoId: id,
      relatedVideoId,
      relationType: body.relationType,
    },
  });

  return NextResponse.json({ ok: true, deleted: result.count });
}
