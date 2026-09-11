import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserState, parseList, joinList } from "@/lib/user-state";

/**
 * POST /api/videos/[id]/like
 * Body: { browserId, action }
 *   action: "like" | "unlike"
 * Toggles the like state for the anonymous browser and adjusts the video's
 * like counter accordingly. Also unsubscribes from "dislike" logic is not
 * modelled — we only track likes on the client side.
 */
export async function POST(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const body = await req.json().catch(() => ({}));
  const browserId: string = body.browserId || "";
  const action: "like" | "unlike" = body.action === "unlike" ? "unlike" : "like";

  if (!browserId) {
    return NextResponse.json({ error: "browserId required" }, { status: 400 });
  }

  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  const st = await getUserState(browserId);
  const liked = parseList(st.likedVideoIds);

  if (action === "like" && !liked.includes(id)) {
    liked.push(id);
    await db.video.update({ where: { id }, data: { likes: { increment: 1 } } });
  } else if (action === "unlike" && liked.includes(id)) {
    const idx = liked.indexOf(id);
    liked.splice(idx, 1);
    await db.video.update({
      where: { id },
      data: { likes: { decrement: 1 } },
    });
  }

  await db.userState.update({
    where: { browserId },
    data: { likedVideoIds: joinList(liked) },
  });

  return NextResponse.json({ ok: true, liked: action === "like" && liked.includes(id) });
}
