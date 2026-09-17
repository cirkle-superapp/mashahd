import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { getUserState } from "@/lib/user-state";
import { rateLimit, getClientIP } from "@/lib/rate-limiter";

/**
 * GET /api/playlist-folders?bid=<browserId>
 * Returns all playlist folders for the user.
 *
 * POST /api/playlist-folders
 * Body: { browserId, name, parentId? }
 * Creates a new folder (§29).
 *
 * PATCH /api/playlist-folders
 * Body: { browserId, folderId, action: "rename" | "move", name?, parentId? }
 * Renames or moves a folder.
 *
 * DELETE /api/playlist-folders
 * Body: { browserId, folderId }
 * Deletes a folder (playlists inside are moved to root, not deleted).
 *
 * Per spec §29: "Add missing: search, folders, collections, sorting,
 * bulk editing, duplicate detection, watched/unwatched filtering."
 */

export async function GET(req: NextRequest) {
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";
  if (!bid) return NextResponse.json({ folders: [] });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  // Get the user's UserState to find their playlists + folders.
  const st = await getUserState(verification.id);
  const folders = await db.playlistFolder.findMany({
    where: { userStateId: st.id },
    orderBy: { position: "asc" },
  });

  return NextResponse.json({
    folders: folders.map((f: any) => ({
      id: f.id,
      name: f.name,
      parentId: f.parentId,
      position: f.position,
      createdAt: f.createdAt?.toISOString(),
    })),
  });
}

export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const name: string = (body.name || "").slice(0, 100);
  const parentId: string | null = body.parentId ? String(body.parentId).slice(0, 60) : null;

  if (!bid || !name) {
    return NextResponse.json({ error: "browserId+name required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const ip = getClientIP(req);
  const rl = await rateLimit(`folders:${ip}`, 20, 60_000);
  if (rl.limited) {
    return NextResponse.json({ error: "rate limited" }, { status: 429, headers: { "Retry-After": "60" } });
  }

  const st = await getUserState(verification.id);

  // Enforce max 1 level of nesting — a folder's parent can't have a parent.
  if (parentId) {
    const parent = await db.playlistFolder.findUnique({ where: { id: parentId } });
    if (!parent || parent.userStateId !== st.id) {
      return NextResponse.json({ error: "parent folder not found" }, { status: 404 });
    }
    if (parent.parentId) {
      return NextResponse.json({ error: "max nesting depth is 1 level" }, { status: 400 });
    }
  }

  // Count existing folders for position.
  const existingCount = await db.playlistFolder.count({ where: { userStateId: st.id } });

  const folder = await db.playlistFolder.create({
    data: {
      userStateId: st.id,
      name,
      parentId: parentId || undefined,
      position: existingCount,
    },
  });

  return NextResponse.json({
    ok: true,
    folder: { id: folder.id, name: folder.name, parentId: folder.parentId, position: folder.position },
  });
}

export async function PATCH(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const folderId: string = body.folderId || "";
  const action: string = body.action || "";

  if (!bid || !folderId || !action) {
    return NextResponse.json({ error: "browserId+folderId+action required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const st = await getUserState(verification.id);
  const folder = await db.playlistFolder.findUnique({ where: { id: folderId } });
  if (!folder || folder.userStateId !== st.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  if (action === "rename") {
    const name = (body.name || "").slice(0, 100);
    if (!name) return NextResponse.json({ error: "name required" }, { status: 400 });
    const updated = await db.playlistFolder.update({ where: { id: folderId }, data: { name } });
    return NextResponse.json({ ok: true, folder: { id: updated.id, name: updated.name } });
  }

  if (action === "move") {
    const parentId = body.parentId ? String(body.parentId).slice(0, 60) : null;
    // Validate nesting.
    if (parentId) {
      const parent = await db.playlistFolder.findUnique({ where: { id: parentId } });
      if (!parent || parent.userStateId !== st.id) {
        return NextResponse.json({ error: "parent folder not found" }, { status: 404 });
      }
      if (parent.parentId || parentId === folderId) {
        return NextResponse.json({ error: "invalid move (nesting or cycle)" }, { status: 400 });
      }
    }
    await db.playlistFolder.update({ where: { id: folderId }, data: { parentId: parentId || undefined } });
    return NextResponse.json({ ok: true });
  }

  return NextResponse.json({ error: "unknown action" }, { status: 400 });
}

export async function DELETE(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const bid: string = body.browserId || "";
  const folderId: string = body.folderId || "";

  if (!bid || !folderId) {
    return NextResponse.json({ error: "browserId+folderId required" }, { status: 400 });
  }

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  const st = await getUserState(verification.id);
  const folder = await db.playlistFolder.findUnique({ where: { id: folderId } });
  if (!folder || folder.userStateId !== st.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  await db.playlistFolder.delete({ where: { id: folderId } });
  // Note: playlists that were in this folder are NOT deleted — they move to root.
  // (This requires adding a folderId to the Playlist model, which we haven't done
  // yet to avoid destructive migrations. For now, folders are standalone organizational
  // containers that the UI can group playlists under.)

  return NextResponse.json({ ok: true });
}
