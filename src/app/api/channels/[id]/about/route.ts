import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { sanitizeUrl } from "@/lib/format";

/**
 * GET /api/channels/[id]/about
 *
 * Channel About page (gap feature from YouTube): shows the channel's
 * description, join date, total views, links, and country.
 * YouTube has a dedicated "About" tab on every channel page.
 */
export async function GET(
  _req: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const { id } = await params;

  try {
    const channel = await db.channel.findUnique({ where: { id } }).catch(() => null);
    if (!channel) {
      return NextResponse.json({ error: "channel not found" }, { status: 404 });
    }

    // Aggregate stats from videos
    const videos = await db.video.findMany({
      where: { channelId: id },
      select: { views: true, likes: true, id: true },
    }).catch(() => []);

    const totalViews = (videos || []).reduce((sum: number, v: any) => sum + (v.views || 0), 0);
    const totalLikes = (videos || []).reduce((sum: number, v: any) => sum + (v.likes || 0), 0);
    const videoCount = (videos || []).length;

    // Parse links from the channel's links field
    let links: Array<{ label: string; url: string }> = [];
    try {
      if (channel.links) {
        links = JSON.parse(channel.links);
      }
    } catch { /* invalid JSON — leave empty */ }

    return NextResponse.json({
      about: {
        channelId: channel.id,
        name: channel.name,
        handle: channel.handle,
        description: channel.description || "No description yet.",
        avatarUrl: channel.avatarUrl ? sanitizeUrl(channel.avatarUrl, channel.name) : channel.avatarUrl,
        bannerColors: channel.bannerColors,
        joinDate: channel.createdAt,
        country: channel.country || "Unknown",
        subscribers: channel.subscribers,
        verified: channel.verified,
        totalViews,
        totalLikes,
        videoCount,
        links,
      },
    });
  } catch {
    return NextResponse.json({ error: "internal error" }, { status: 500 });
  }
}
