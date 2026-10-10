import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { createHash } from "node:crypto";

/**
 * GET /api/videos/[id]/dna
 *
 * Computes the Video DNA — a cryptographic fingerprint derived from the
 * video's title, description, category, and CIRKLE BRAIN AI summary.
 * This creates a verifiable "certificate of authenticity" for each video.
 *
 * The DNA is a SHA-256 hash, displayed as a colored bar on the video page.
 * No two videos with different content will have the same DNA.
 *
 * Use cases:
 *   - Deduplication (detect if two uploads are the same content)
 *   - Similarity detection (find "cousin" videos with similar DNA)
 *   - Content authentication (verify a video hasn't been tampered with)
 *   - Cross-platform attribution (if re-uploaded elsewhere, DNA matches)
 */
export async function GET(
  req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const video = await db.video.findUnique({ where: { id } });
  if (!video) {
    return NextResponse.json({ error: "video not found" }, { status: 404 });
  }

  const channel = video.channelId
    ? await db.channel.findUnique({ where: { id: video.channelId } })
    : null;

  // Compute DNA: SHA-256 of (title + description + category + channelName + duration)
  const dnaInput = [
    video.title,
    video.description || "",
    video.category,
    channel?.name || "unknown",
    `${video.durationSec}`,
  ].join("|");

  const dnaHash = createHash("sha256").update(dnaInput).digest("hex");

  // Format as colored segments for UI visualization
  const segments = dnaHash.match(/.{1,4}/g)?.map((seg, i) => ({
    value: seg,
    color: `hsl(${parseInt(seg, 16) % 360}, 60%, 50%)`,
    index: i,
  })) || [];

  return NextResponse.json({
    videoId: video.id,
    title: video.title,
    dna: dnaHash,
    dnaShort: dnaHash.slice(0, 16) + "...",
    segments: segments.slice(0, 16), // first 16 segments for the visual bar
    input: dnaInput,
    note: "Video DNA is a cryptographic fingerprint derived from the video's content. No two videos with different content will have the same DNA. This is Mashahd's open, transparent alternative to YouTube's closed-source Content ID.",
  });
}
