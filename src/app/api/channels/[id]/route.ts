import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { getUserState, parseList } from "@/lib/user-state";

/**
 * GET /api/channels/[id]
 * Optional `?bid=<browserId>` to return whether this browser is subscribed.
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const channel = await db.channel.findUnique({ where: { id } });
  if (!channel) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  let subscribed = false;
  const bid = new URL(req.url).searchParams.get("bid") || "";
  if (bid) {
    const st = await getUserState(bid);
    subscribed = parseList(st.subscribedChannelIds).includes(id);
  }

  return NextResponse.json({ channel, subscribed });
}
