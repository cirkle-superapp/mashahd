"use client";

import { create } from "zustand";

/**
 * Mini-player store — holds the video that's currently "in the mini-player"
 * (the floating picture-in-picture-style player shown when you navigate away
 * from the watch page while a video is still playing).
 *
 * The watch page populates this on mount and clears it on unmount; the
 * MiniPlayer component renders a floating card when `videoId` is set and the
 * current view is not the watch page for that video.
 */
type MiniPlayerState = {
  videoId: string | null;
  videoTitle: string | null;
  videoUrl: string | null;
  thumbnailUrl: string | null;
  channelName: string | null;
  /** Time the user had reached when they navigated away. */
  currentTime: number;
  setVideo: (v: {
    videoId: string;
    videoTitle: string;
    videoUrl: string;
    thumbnailUrl: string;
    channelName: string;
    currentTime: number;
  }) => void;
  updateCurrentTime: (t: number) => void;
  close: () => void;
};

export const useMiniPlayer = create<MiniPlayerState>((set) => ({
  videoId: null,
  videoTitle: null,
  videoUrl: null,
  thumbnailUrl: null,
  channelName: null,
  currentTime: 0,
  setVideo: (v) =>
    set({
      videoId: v.videoId,
      videoTitle: v.videoTitle,
      videoUrl: v.videoUrl,
      thumbnailUrl: v.thumbnailUrl,
      channelName: v.channelName,
      currentTime: v.currentTime,
    }),
  updateCurrentTime: (t) => set({ currentTime: t }),
  close: () =>
    set({
      videoId: null,
      videoTitle: null,
      videoUrl: null,
      thumbnailUrl: null,
      channelName: null,
      currentTime: 0,
    }),
}));
