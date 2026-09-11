import { NextResponse } from "next/server";
import { db } from "@/lib/db";
import { channels, videos, commentTemplates } from "@/lib/seed-data";

/**
 * POST /api/seed
 * Idempotently seeds the database with demo channels, videos, and comments.
 * Safe to call multiple times — it wipes existing seed data first.
 */
export async function POST() {
  // Wipe (order matters for FK constraints)
  await db.comment.deleteMany();
  await db.video.deleteMany();
  await db.channel.deleteMany();

  // Insert channels and remember their new ids
  const channelByHandle: Record<string, { id: string }> = {};
  for (const c of channels) {
    const created = await db.channel.create({
      data: {
        name: c.name,
        handle: c.handle,
        avatarUrl: c.avatarUrl,
        bannerColors: c.bannerColors,
        description: c.description,
        subscribers: c.subscribers,
      },
    });
    channelByHandle[c.handle] = { id: created.id };
  }

  // Insert videos
  let videoCount = 0;
  const now = Date.now();
  for (const vid of videos) {
    const ch = channelByHandle[vid.channelHandle];
    if (!ch) continue;
    const createdAt = new Date(now - vid.daysAgo * 24 * 60 * 60 * 1000);
    const created = await db.video.create({
      data: {
        title: vid.title,
        description: vid.description,
        thumbnailUrl: vid.thumbnailUrl,
        videoUrl: vid.videoUrl,
        durationSec: vid.durationSec,
        views: vid.views,
        likes: vid.likes,
        dislikes: vid.dislikes,
        category: vid.category,
        tags: vid.tags,
        channelId: ch.id,
        createdAt,
      },
    });

    // Add 2-4 starter comments per video
    const count = 2 + (videoCount % 3);
    for (let i = 0; i < count; i++) {
      const t = commentTemplates[(videoCount * 2 + i) % commentTemplates.length];
      const daysAgo = 1 + ((videoCount + i) % vid.daysAgo);
      await db.comment.create({
        data: {
          videoId: created.id,
          author: t.author,
          avatarUrl: `https://api.dicebear.com/7.x/notionists/svg?seed=${encodeURIComponent(t.author)}&backgroundColor=64748b&radius=50`,
          text: t.text,
          likes: Math.floor(vid.likes * 0.001 * (i + 1)),
          createdAt: new Date(now - daysAgo * 24 * 60 * 60 * 1000),
        },
      });
    }
    videoCount++;
  }

  return NextResponse.json({
    ok: true,
    channels: channels.length,
    videos: videos.length,
    comments: videos.length * 3,
  });
}
