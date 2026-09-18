import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/videos/[id]/fact-checks
 *
 * Pulled from CIRKLE Mashahd — community fact-check notes.
 * Returns fact-check notes submitted by the community for a video.
 * Per spec §21: "Support differentiated signals such as: accurate, misleading."
 *
 * POST /api/videos/[id]/fact-checks
 * Body: { browserId, timestamp?, claim, verdict, evidence? }
 * Submits a new fact-check note.
 *
 * PATCH /api/videos/[id]/fact-checks
 * Body: { browserId, noteId, action: "upvote" | "downvote" }
 * Community votes on fact-check notes.
 */

const VALID_VERDICTS = ["true", "false", "misleading", "unverified", "context_needed"];

export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`fact-checks:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  try {
    const notes = await (db as any).factCheckNote.findMany({
      where: { videoId: id },
      orderBy: [{ upvotes: "desc" }, { createdAt: "desc" }],
      take: 20,
    });

    return NextResponse.json({
      notes: notes.map((n: any) => ({
        id: n.id,
        timestamp: n.timestamp,
        claim: n.claim,
        verdict: n.verdict,
        evidence: n.evidence,
        submitterName: n.submitterName,
        upvotes: n.upvotes,
        downvotes: n.downvotes,
        score: n.upvotes - n.downvotes,
        status: n.status,
        createdAt: n.createdAt?.toISOString(),
      })),
    });
  } catch {
    return NextResponse.json({ notes: [] });
  }
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const claim: string = (body.claim || "").trim().slice(0, 500);
  const verdict: string = body.verdict || "";
  const evidence: string = (body.evidence || "").slice(0, 2000);
  const timestamp: number | null = typeof body.timestamp === "number" ? Math.max(0, Math.floor(body.timestamp)) : null;

  if (!bid || !claim || !verdict) {
    return NextResponse.json({ error: "browserId+claim+verdict required" }, { status: 400 });
  }
  if (!VALID_VERDICTS.includes(verdict)) {
    return NextResponse.json({ error: `invalid verdict. valid: ${VALID_VERDICTS.join(", ")}` }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`fact-check-create:${ip}`, 5, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  try {
    const video = await db.video.findUnique({ where: { id } });
    if (!video) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    const note = await (db as any).factCheckNote.create({
      data: {
        videoId: id,
        timestamp,
        claim,
        verdict,
        evidence,
        submitterId: verification.id,
        submitterName: "Community",
        status: "pending",
      },
    });

    return NextResponse.json({
      ok: true,
      note: { id: note.id, claim: note.claim, verdict: note.verdict, status: note.status },
    });
  } catch {
    return NextResponse.json({ error: "failed to create" }, { status: 500 });
  }
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const noteId: string = body.noteId || "";
  const action: string = body.action || "";

  if (!bid || !noteId || !action) {
    return NextResponse.json({ error: "browserId+noteId+action required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  try {
    const note = await (db as any).factCheckNote.findUnique({ where: { id: noteId } });
    if (!note || note.videoId !== id) {
      return NextResponse.json({ error: "not found" }, { status: 404 });
    }

    if (action === "upvote") {
      await (db as any).factCheckNote.update({
        where: { id: noteId },
        data: { upvotes: { increment: 1 } },
      });
    } else if (action === "downvote") {
      await (db as any).factCheckNote.update({
        where: { id: noteId },
        data: { downvotes: { increment: 1 } },
      });
    } else {
      return NextResponse.json({ error: "unknown action" }, { status: 400 });
    }

    return NextResponse.json({ ok: true });
  } catch {
    return NextResponse.json({ error: "failed" }, { status: 500 });
  }
}
