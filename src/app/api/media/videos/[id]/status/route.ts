import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";

/**
 * GET /api/media/videos/[id]/status
 * Returns the current processing status + progress of the video.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;
  const job = await db.mediaProcessingJob.findFirst({
    where: { videoId: id },
    orderBy: { createdAt: "desc" },
  });
  if (!job) {
    return NextResponse.json({ error: "no job found" }, { status: 404 });
  }
  return NextResponse.json({
    videoId: id,
    status: job.status,
    progress: job.progress,
    error: job.error || undefined,
    profile: job.profile,
    startedAt: job.startedAt,
    completedAt: job.completedAt,
  });
}
