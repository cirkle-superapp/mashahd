import { NextRequest, NextResponse } from "next/server";
import { db } from "@/lib/db";
import { channels, videos, commentTemplates } from "@/lib/seed-data";

/**
 * POST /api/seed
 * Idempotently seeds the database with demo channels, videos, and comments.
 * Safe to call multiple times — it wipes existing seed data first.
 *
 * SECURITY (hardened): this endpoint is DESTRUCTIVE (it wipes all comments,
 * videos, and channels). It is now locked down:
 *
 *   1. In production (NODE_ENV=production): BLOCKED unless an admin token
 *      matching SEED_ADMIN_TOKEN env var is provided in the request body
 *      or the `x-admin-token` header. Without it, returns 403.
 *
 *   2. In development: allowed without a token (for local `bun run dev`).
 *
 * This closes the previous self-DOS vector where anyone could wipe the DB.
 */
export async function POST(req: NextRequest) {
  // ── Auth gate ──
  const isProd = process.env.NODE_ENV === "production";
  if (isProd) {
    const adminToken = process.env.SEED_ADMIN_TOKEN;
    if (!adminToken) {
      return NextResponse.json(
        { error: "Seeding is disabled in production. Set SEED_ADMIN_TOKEN to enable admin-only seeding." },
        { status: 403 }
      );
    }
    let providedToken: string | undefined;
    try {
      const body = await req.clone().json().catch(() => ({}));
      providedToken = body?.adminToken;
    } catch {
      providedToken = undefined;
    }
    if (!providedToken) {
      providedToken = req.headers.get("x-admin-token") || undefined;
    }
    if (providedToken !== adminToken) {
      return NextResponse.json(
        { error: "Unauthorized — admin token required for production seeding." },
        { status: 403 }
      );
    }
  }

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
