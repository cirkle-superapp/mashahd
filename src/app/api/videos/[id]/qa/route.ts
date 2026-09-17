import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/videos/[id]/qa
 * Returns all Q&A entries for a live stream (answered + unanswered).
 *
 * POST /api/videos/[id]/qa
 * Body: { askerName, askerAvatar?, question }
 * Submits a question (viewer-side). Per spec §45: "Q&A".
 *
 * PATCH /api/videos/[id]/qa
 * Body: { qaId, action: "answer" | "upvote", answer?, answeredBy? }
 * - "answer": creator answers the question.
 * - "upvote": viewer upvotes the question.
 *
 * Per spec §45: "Support where applicable: Q&A."
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const entries = await db.liveQA.findMany({
    where: { videoId: id },
    orderBy: [
      { answeredAt: "desc" }, // answered first
      { upvotes: "desc" },    // then by upvotes
    ],
    take: 100,
  });

  return NextResponse.json({
    entries: entries.map((e: any) => ({
      id: e.id,
      askerName: e.askerName,
      askerAvatar: e.askerAvatar,
      question: e.question,
      answer: e.answer,
      answeredBy: e.answeredBy,
      answeredAt: e.answeredAt?.toISOString(),
      upvotes: e.upvotes,
      isAnswered: !!e.answer,
      createdAt: e.createdAt?.toISOString(),
    })),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`live-qa:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await req.json().catch(() => ({}));
  const askerName: string = (body.askerName || "Anonymous").slice(0, 60);
  const askerAvatar: string = (body.askerAvatar || "").slice(0, 500);
  const question: string = (body.question || "").trim().slice(0, 500);

  if (!question) {
    return NextResponse.json({ error: "question required" }, { status: 400 });
  }

  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const entry = await db.liveQA.create({
    data: {
      videoId: id,
      askerName,
      askerAvatar,
      question,
    },
  });

  return NextResponse.json({
    ok: true,
    entry: {
      id: entry.id,
      askerName: entry.askerName,
      question: entry.question,
      upvotes: 0,
      isAnswered: false,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const qaId: string = body.qaId || "";
  const action: string = body.action || "";

  if (!qaId || !action) {
    return NextResponse.json({ error: "qaId+action required" }, { status: 400 });
  }

  const entry = await db.liveQA.findUnique({ where: { id: qaId } });
  if (!entry || entry.videoId !== id) {
    return NextResponse.json({ error: "Q&A entry not found" }, { status: 404 });
  }

  if (action === "answer") {
    const answer: string = (body.answer || "").trim().slice(0, 1000);
    const answeredBy: string = (body.answeredBy || "Creator").slice(0, 60);
    if (!answer) {
      return NextResponse.json({ error: "answer required" }, { status: 400 });
    }
    await db.liveQA.update({
      where: { id: qaId },
      data: { answer, answeredBy, answeredAt: new Date() },
    });
    return NextResponse.json({ ok: true, answer, answeredBy });
  }

  if (action === "upvote") {
    await db.liveQA.update({
      where: { id: qaId },
      data: { upvotes: { increment: 1 } },
    });
    return NextResponse.json({ ok: true, upvotes: entry.upvotes + 1 });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
