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
  description: string;
  subscribers: number;
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
};

export type VideoWithFlags = Video & {
  liked: boolean;
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
