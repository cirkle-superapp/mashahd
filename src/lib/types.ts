/**
 * Shared type definitions for the YouTube-like app. These mirror the Prisma
 * models (without the relation back-references we don't need on the client).
 */

export type Channel = {
  id: string;
  name: string;
  handle: string;
  avatarUrl: string;
  bannerColors: string;
  bannerUrl?: string; // optional custom banner image (falls back to gradient)
  description: string;
  subscribers: number;
  verified?: boolean; // verification badge (social-media structuring audit)
  ownerId?: string | null; // owning User (creator economy)
  links?: string; // pipe-separated social links
  country?: string; // ISO country code
  createdAt: string;
};

export type Video = {
  id: string;
  title: string;
  description: string;
  thumbnailUrl: string;
  videoUrl: string;
  durationSec: number;
  views: number;
  likes: number;
  dislikes: number;
  category: string;
  tags: string;
  channelId: string;
  visibility?: string; // public | unlisted | private | scheduled
  publishedAt?: string; // ISO date string
  language?: string; // ISO 639-1 code
  ageGated?: boolean; // 18+ restriction
  createdAt: string;
  channel: Channel;
};

export type Comment = {
  id: string;
  videoId: string;
  author: string;
  avatarUrl: string;
  text: string;
  likes: number;
  createdAt: string;
  // Optional timestamp the comment is pinned to (seconds from video start).
  timestamp?: number | null;
  // Optional parent comment ID (for threaded replies).
  parentId?: string | null;
  // Replies to this comment (only populated on top-level comments).
  replies?: Comment[];
  // Whether the comment has been pinned by the channel owner (Pass 56).
  pinned?: boolean;
};

export type VideoWithFlags = Video & {
  liked: boolean;
  disliked?: boolean; // social-media structuring audit: wire dislike
  subscribed: boolean;
};

export type ChannelWithFlags = Channel & {
  subscribed: boolean;
};

export const CATEGORIES = [
  "All",
  "Music",
  "Gaming",
  "Live",
  "Mixes",
  "News",
  "Sports",
  "Learning",
  "Fashion",
  "Podcasts",
  "Comedy",
  "Travel",
  "Cooking",
  "Fitness",
  "Tech",
  "Science",
  "Art",
  "Cars",
  "Nature",
  "Recently uploaded",
  "New to you",
] as const;
