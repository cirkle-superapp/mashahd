import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserState, parseList, joinList } from "@/lib/user-state";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * POST /api/videos/[id]/like
 * Body: { browserId, action }
 *   action: "like" | "unlike" | "dislike" | "undislike"
 *
 * Toggles the like / dislike state for the anonymous browser and adjusts the
 * video's counters accordingly. Like and dislike are mutually exclusive —
 * liking a disliked video clears the dislike (and vice versa), matching
 * YouTube's behavior.
 *
 * `likedVideoIds` and `dislikedVideoIds` are stored on UserState as
 * pipe-separated strings (project rule: SQLite has no list type).
 *
 * SECURITY (deep audit pass 2): verifies browserId HMAC signature + rate
 * limits per browserId (20/min) and per IP (60/min) to prevent inflation.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const browserId: string = body.browserId || "";
  const action: "like" | "unlike" | "dislike" | "undislike" = body.action;

  if (!browserId) {
    return NextResponse.json({ error: "browserId required" }, { status: 400 });
  }
  if (!["like", "unlike", "dislike", "undislike"].includes(action)) {
    return NextResponse.json({ error: "invalid action" }, { status: 400 });
  }

  // ── Verify browserId signature ──
  const verification = verifyBrowserId(browserId);
  if (!verification.valid) {
    return NextResponse.json(
      { error: "invalid browserId signature", reissue: true },
      { status: 403 }
    );
  }

  // ── Rate limit ──
  const ip = getClientIP(req);
  const ipRl = await rateLimit(`like-ip:${ip}`, 60, 60_000);
  if (ipRl.limited) {
    return NextResponse.json(
      { error: "rate limited" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }
  const bidRl = await rateLimit(`like-bid:${verification.id}`, 20, 60_000);
  if (bidRl.limited) {
    return NextResponse.json(
      { error: "rate limited per browser" },
      { status: 429, headers: { "Retry-After": "60" } }
    );
  }

  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const st = await getUserState(browserId);
  const liked = parseList(st.likedVideoIds);
  // dislikedVideoIds is a new column added by the social-media structuring
  // audit. It may not exist on older UserState rows — default to "".
  const disliked = parseList((st as any).dislikedVideoIds ?? "");

  // Like and dislike are mutually exclusive.
  if (action === "like") {
    if (disliked.includes(id)) {
      disliked.splice(disliked.indexOf(id), 1);
      await db.video.update({ where: { id }, data: { dislikes: { decrement: 1 } } });
    }
    if (!liked.includes(id)) {
      liked.push(id);
      await db.video.update({ where: { id }, data: { likes: { increment: 1 } } });
    }
  } else if (action === "unlike") {
    if (liked.includes(id)) {
      liked.splice(liked.indexOf(id), 1);
      await db.video.update({ where: { id }, data: { likes: { decrement: 1 } } });
    }
  } else if (action === "dislike") {
    if (liked.includes(id)) {
      liked.splice(liked.indexOf(id), 1);
      await db.video.update({ where: { id }, data: { likes: { decrement: 1 } } });
    }
    if (!disliked.includes(id)) {
      disliked.push(id);
      await db.video.update({ where: { id }, data: { dislikes: { increment: 1 } } });
    }
  } else if (action === "undislike") {
    if (disliked.includes(id)) {
      disliked.splice(disliked.indexOf(id), 1);
      await db.video.update({ where: { id }, data: { dislikes: { decrement: 1 } } });
    }
  }

  await db.userState.update({
    where: { browserId },
    data: {
      likedVideoIds: joinList(liked),
      dislikedVideoIds: joinList(disliked),
    },
  });

  return NextResponse.json({
    ok: true,
    liked: liked.includes(id),
    disliked: disliked.includes(id),
  });
}
