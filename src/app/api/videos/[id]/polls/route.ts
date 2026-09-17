import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/videos/[id]/polls
 * Returns all polls for a live stream (active + closed). Per spec §45.
 *
 * POST /api/videos/[id]/polls
 * Body: { question, options: string[], creatorToken? }
 * Creates a new poll (creator-only). Per spec §45: "polls".
 *
 * PATCH /api/videos/[id]/polls
 * Body: { pollId, action: "vote" | "close", optionIndex? }
 * - "vote": increments the vote count for the given option.
 * - "close": closes the poll (creator-only).
 *
 * Per spec §45: "Support where applicable: polls, Q&A."
 */

export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const polls = await db.livePoll.findMany({
    where: { videoId: id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    polls: polls.map((p: any) => {
      let options: any[] = [];
      try { options = JSON.parse(p.options || "[]"); } catch { /* corrupted */ }
      return {
        id: p.id,
        question: p.question,
        options,
        status: p.status,
        createdAt: p.createdAt?.toISOString(),
        closedAt: p.closedAt?.toISOString(),
        totalVotes: options.reduce((sum: number, o: any) => sum + (o.votes || 0), 0),
      };
    }),
  });
}

export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const ip = getClientIP(req);
  const rl = await rateLimit(`live-poll:${ip}`, 10, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const body = await req.json().catch(() => ({}));
  const question: string = (body.question || "").slice(0, 500);
  const options: string[] = Array.isArray(body.options)
    ? body.options.slice(0, 6).map((o: string) => String(o).slice(0, 200))
    : [];

  if (!question || options.length < 2) {
    return NextResponse.json({ error: "question + at least 2 options required" }, { status: 400 });
  }

  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  // Initialize options with 0 votes.
  const optionsWithVotes = options.map((text: string) => ({ text, votes: 0 }));

  const poll = await db.livePoll.create({
    data: {
      videoId: id,
      question,
      options: JSON.stringify(optionsWithVotes),
      status: "active",
    },
  });

  return NextResponse.json({
    ok: true,
    poll: {
      id: poll.id,
      question: poll.question,
      options: optionsWithVotes,
      status: poll.status,
    },
  });
}

export async function PATCH(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const pollId: string = body.pollId || "";
  const action: string = body.action || "";

  if (!pollId || !action) {
    return NextResponse.json({ error: "pollId+action required" }, { status: 400 });
  }

  const poll = await db.livePoll.findUnique({ where: { id: pollId } });
  if (!poll || poll.videoId !== id) {
    return NextResponse.json({ error: "poll not found" }, { status: 404 });
  }

  if (action === "vote") {
    const optionIndex = Math.floor(Number(body.optionIndex));
    let options: any[] = [];
    try { options = JSON.parse(poll.options || "[]"); } catch { /* corrupted */ }
    if (optionIndex < 0 || optionIndex >= options.length) {
      return NextResponse.json({ error: "invalid optionIndex" }, { status: 400 });
    }
    if (poll.status !== "active") {
      return NextResponse.json({ error: "poll is closed" }, { status: 400 });
    }
    options[optionIndex].votes = (options[optionIndex].votes || 0) + 1;
    await db.livePoll.update({
      where: { id: pollId },
      data: { options: JSON.stringify(options) },
    });
    return NextResponse.json({
      ok: true,
      options,
      totalVotes: options.reduce((sum: number, o: any) => sum + (o.votes || 0), 0),
    });
  }

  if (action === "close") {
    await db.livePoll.update({
      where: { id: pollId },
      data: { status: "closed", closedAt: new Date() },
    });
    return NextResponse.json({ ok: true, status: "closed" });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}
