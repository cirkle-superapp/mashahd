import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/blocks?bid=<browserId>
 * Returns the user's blocks (topics, keywords, creators, etc.).
 *
 * POST /api/blocks
 * Body: { browserId, blockType, blockValue }
 * Creates a block (§11). Affects Home, Search, Up Next, Discovery, Notifications.
 *
 * DELETE /api/blocks
 * Body: { browserId, blockType, blockValue }
 * Removes a block (undo).
 *
 * Per spec §11: "Implement persistent user controls for:
 * topic blocks, keyword blocks, creator/channel blocks, content-type blocks,
 * language blocks, AI-content blocks."
 * "The controls should affect: Home, Search, Up Next, Discovery, Notifications, Suggestions."
 *
 * Valid block types: topic | keyword | creator | content_type | language | ai_content
 */

const VALID_BLOCK_TYPES = ["topic", "keyword", "creator", "content_type", "language", "ai_content"];

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  if (!bid) return NextResponse.json({ blocks: [] });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const blocks = await db.userBlock.findMany({
    where: { userId: verification.id },
    orderBy: { createdAt: "desc" },
  });

  return NextResponse.json({
    blocks: blocks.map((b) => ({
      id: b.id,
      blockType: b.blockType,
      blockValue: b.blockValue,
      createdAt: b.createdAt.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const blockType: string = body.blockType || "";
  const blockValue: string = (body.blockValue || "").slice(0, 200);

  if (!bid || !blockType || !blockValue) {
    return NextResponse.json({ error: "browserId+blockType+blockValue required" }, { status: 400 });
  }
  if (!VALID_BLOCK_TYPES.includes(blockType)) {
    return NextResponse.json({ error: `invalid blockType. valid: ${VALID_BLOCK_TYPES.join(", ")}` }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`blocks:${ip}`, 30, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const block = await db.userBlock.upsert({
    where: { userId_blockType_blockValue: { userId: verification.id, blockType, blockValue } },
    create: { userId: verification.id, blockType, blockValue },
    update: {},
  });

  return NextResponse.json({
    ok: true,
    blockId: block.id,
    blockType,
    blockValue,
    effects: ["excluded_from_home", "excluded_from_search", "excluded_from_up_next", "excluded_from_discovery"],
  });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const blockType: string = body.blockType || "";
  const blockValue: string = body.blockValue || "";

  if (!bid || !blockType || !blockValue) {
    return NextResponse.json({ error: "browserId+blockType+blockValue required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  await db.userBlock.deleteMany({
    where: { userId: verification.id, blockType, blockValue },
  }).catch(() => {});

  return NextResponse.json({ ok: true });
}
