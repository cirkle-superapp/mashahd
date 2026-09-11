import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * POST /api/media/videos
 * Body: { title, channelId, category, description }
 *
 * Creates a new Video record in UPLOADING state + a MediaProcessingJob.
 * Returns the videoId needed for the subsequent upload step.
 */
export async function POST(req: NextRequest) {
  const body = await req.json().catch(() => ({}));
  const title: string = body.title?.slice(0, 200) || "Untitled";
  const channelId: string = body.channelId || "";
  const category: string = body.category || "Tech";
  const description: string = body.description?.slice(0, 5000) || "";

  if (!channelId) {
    return NextResponse.json({ error: "channelId required" }, { status: 400 });
  }
  const channel = await db.channel.findUnique({ where: { id: channelId } });
  if (!channel) {
    return NextResponse.json({ error: "channel not found" }, { status: 404 });
  }

  const video = await db.video.create({
    data: {
      title,
      description,
      thumbnailUrl: "", // set after processing
      videoUrl: "", // set after processing
      durationSec: 0, // set after probe
      category,
      tags: "",
      channelId,
    },
  });

  const job = await db.mediaProcessingJob.create({
    data: {
      videoId: video.id,
      status: "UPLOADING",
      profile: "cpu-safe",
    },
  });

  return NextResponse.json({
    videoId: video.id,
    jobId: job.id,
    uploadUrl: `/api/media/videos/${video.id}/upload`,
  });
}
