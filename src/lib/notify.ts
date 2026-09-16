/**
 * Notification creation helpers — called by domain events to create
 * in-app notifications for the bell icon.
 *
 * Per the social-media structuring audit: replaces the SAMPLE_NOTIFS mock
 * with real, DB-backed notifications. Each helper creates a Notification
 * row with a JSON-encoded payload.
 *
 * These are fire-and-forget — failures are logged but never block the
 * caller (notifications are non-critical UX, not business data).
 */

import { db } from "./db";

export interface NotifPayload {
  title: string;
  body: string;
  linkUrl?: string;
  actorAvatarUrl?: string;
  actorName?: string;
  thumbnailUrl?: string;
}

/**
 * Create a notification for a recipient. Silently fails on error.
 */
export async function createNotification(
  recipientId: string,
  type: "new_video" | "new_comment" | "new_subscriber" | "tip_received" | "system" | "mention",
  payload: NotifPayload
): Promise<void> {
  try {
    await db.notification.create({
      data: {
        recipientId,
        type,
        payload: JSON.stringify(payload),
        read: false,
      },
    });
  } catch (e) {
    // Non-critical — log and continue.
    console.warn("[notifications] failed to create:", e);
  }
}

/**
 * Notify all subscribers of a channel about a new video upload.
 * This is called by the upload pipeline when a video becomes ready.
 *
 * Note: in the current anonymous-browserId model, subscribers are stored
 * as pipe-separated browserIds on UserState — not a relational Subscription
 * table. For zero-cost, we fetch subscribers via a raw-ish scan and create
 * notifications. This is O(subscribers) but bounded by the demo scale.
 * A production system would use a Subscription table + batch inserts.
 */
export async function notifySubscribersOfNewVideo(
  channelId: string,
  video: { id: string; title: string; thumbnailUrl: string }
): Promise<void> {
  try {
    // Fetch all UserStates that have this channelId in subscribedChannelIds.
    // SQLite doesn't have array_contains, so we use a LIKE query on the
    // pipe-separated string. This is efficient for demo-scale (< 10k subs).
    const subscribers = await db.userState.findMany({
      where: {
        subscribedChannelIds: { contains: channelId },
      },
      select: { browserId: true },
    });

    // Create a notification per subscriber.
    // NOTE: for large subscriber counts, this should be batched + queued
    // via Inngest. For now (demo scale), inline creation is fine.
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { name: true, avatarUrl: true, handle: true },
    });

    if (!channel) return;

    for (const sub of subscribers.slice(0, 500)) { // cap at 500 for safety
      await createNotification(sub.browserId, "new_video", {
        title: `${channel.name} uploaded a new video`,
        body: video.title,
        linkUrl: `/?v=watch&id=${video.id}`,
        actorAvatarUrl: channel.avatarUrl,
        actorName: channel.name,
        thumbnailUrl: video.thumbnailUrl,
      });
    }
  } catch (e) {
    console.warn("[notifications] notifySubscribersOfNewVideo failed:", e);
  }
}

/**
 * Notify a video's owner about a new comment.
 */
export async function notifyVideoOwnerOfComment(
  videoId: string,
  comment: { author: string; avatarUrl: string; text: string }
): Promise<void> {
  try {
    const video = await db.video.findUnique({
      where: { id: videoId },
      select: { channelId: true, channel: { select: { ownerId: true } } },
    });
    if (!video?.channel?.ownerId) return; // no owner to notify

    await createNotification(video.channel.ownerId, "new_comment", {
      title: `${comment.author} commented on your video`,
      body: comment.text.slice(0, 120),
      actorAvatarUrl: comment.avatarUrl,
      actorName: comment.author,
    });
  } catch (e) {
    console.warn("[notifications] notifyVideoOwnerOfComment failed:", e);
  }
}

/**
 * Notify a channel owner about a new subscriber.
 */
export async function notifyChannelOwnerOfSubscriber(
  channelId: string,
  subscriber: { browserId: string }
): Promise<void> {
  try {
    const channel = await db.channel.findUnique({
      where: { id: channelId },
      select: { ownerId: true },
    });
    if (!channel?.ownerId) return;

    await createNotification(channel.ownerId, "new_subscriber", {
      title: "You have a new subscriber",
      body: "Someone subscribed to your channel",
    });
  } catch (e) {
    console.warn("[notifications] notifyChannelOwnerOfSubscriber failed:", e);
  }
}
