import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { verifyBrowserId } from "@/lib/browser-id-security";
import { resolveSmartPlaylist } from "../../route";

/**
 * GET /api/smart-playlists/[id]/resolve?bid=<browserId>
 *
 * Resolves a smart playlist's rules → returns matching videos (dynamic).
 * Per spec §30: "Rules must update dynamically."
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const url = new URL(req.url);
  const bid = url.searchParams.get("bid") || "";

  if (!bid) return NextResponse.json({ videos: [] });

  const verification = verifyBrowserId(bid);
  if (!verification.valid) {
    return NextResponse.json({ error: "invalid browserId", reissue: true }, { status: 403 });
  }

  // Fetch the smart playlist + verify ownership.
  const playlist = await db.smartPlaylist.findUnique({ where: { id } });
  if (!playlist || playlist.userId !== verification.id) {
    return NextResponse.json({ error: "not found" }, { status: 404 });
  }

  // Parse rules.
  let rules: any = {};
  try { rules = JSON.parse(playlist.rules || "{}"); } catch { /* corrupted */ }

  // Resolve.
  const videos = await resolveSmartPlaylist(verification.id, rules);

  return NextResponse.json({
    playlist: {
      id: playlist.id,
      name: playlist.name,
      description: playlist.description,
      rules,
    },
    videos,
    count: videos.length,
  });
}
