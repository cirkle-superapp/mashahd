import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { computeSwarmId } from "@/lib/swarm";

/**
 * GET /api/media/videos/[id]/playback
 * Returns the playback metadata the player needs to start:
 *   - manifestVersion + masterManifestUrl
 *   - swarmConfig (swarmId + whether P2P is enabled for the server)
 *   - available renditions
 *
 * The client must not invent security-sensitive playback metadata.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const video = await db.video.findUnique({
    where: { id },
    include: {
      manifests: { orderBy: { createdAt: "desc" }, take: 1 },
      renditions: true,
    },
  });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const manifest = video.manifests[0];
  if (!manifest) {
    return NextResponse.json({
      videoId: id,
      status: "processing",
      manifestVersion: null,
      masterManifestUrl: null,
      swarmConfig: { enabled: false, swarmId: null },
      renditions: [],
    });
  }

  // The primary swarm = the lowest rendition (so all peers on the same
  // video+manifest share a swarm regardless of rendition — the player can
  // switch renditions and stay in the swarm by using the rendition-specific
  // swarm for segment exchange).
  const primaryRendition = video.renditions[0];
  const swarmId = primaryRendition
    ? computeSwarmId(id, primaryRendition.id, manifest.version)
    : null;

  return NextResponse.json({
    videoId: id,
    status: "ready",
    manifestVersion: manifest.version,
    masterManifestUrl: `/api/media/videos/${id}/manifest/master.m3u8`,
    swarmConfig: {
      enabled: process.env.P2P_ENABLED !== "false",
      swarmId,
      signalingUrl: process.env.P2P_SIGNALING_URL || null,
    },
    renditions: video.renditions.map((r) => ({
      id: r.id,
      resolution: r.resolution,
      height: r.height,
      width: r.width,
      bitrate: r.bitrate,
      manifestUrl: `/api/media/videos/${id}/manifest/${r.resolution}/index.m3u8`,
    })),
  });
}
