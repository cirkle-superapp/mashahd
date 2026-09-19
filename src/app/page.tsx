"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import { Header } from "@/components/youtube/header";
import { Dock } from "@/components/youtube/dock";
import { HomeView } from "@/components/youtube/home-view";
import { WatchView } from "@/components/youtube/watch-view";
import { ChannelView } from "@/components/youtube/channel-view";
import { CategoryView } from "@/components/youtube/category-view";
import { SettingsView } from "@/components/youtube/settings-view";
import { ProfileView } from "@/components/youtube/profile-view";
import {
  SearchView,
  TrendingView,
  SubscriptionsView,
  HistoryView,
  LikedView,
  LibraryView,
  FavoritesView,
  WatchLaterView,
} from "@/components/youtube/list-views";
import { Footer } from "@/components/youtube/footer";
import { CommandPalette } from "@/components/youtube/command-palette";
import { Splash } from "@/components/youtube/splash";
import { KeyboardShortcuts } from "@/components/youtube/keyboard-shortcuts";
import { MiniPlayer } from "@/components/youtube/mini-player";
import { OnboardingTour } from "@/components/youtube/onboarding-tour";
import { PlaylistView } from "@/components/youtube/playlist-view";
import { ClipView } from "@/components/youtube/clip-view";
import { RecommendationProfileView } from "@/components/youtube/recommendation-profile-view";
import { SmartPlaylistResultsView } from "@/components/youtube/smart-playlist-creator";
import { ShortsFeedView } from "@/components/youtube/shorts-feed-view";
import { LiveStreamView } from "@/components/youtube/live-stream-view";
import { useMashahdBridge } from "@/lib/mashahd-bridge";
import { useBrowserId } from "@/hooks/use-browser-id";
import { cn } from "@/lib/utils";

function renderView(view: ReturnType<typeof useAppStore.getState>["view"]) {
  switch (view.kind) {
    case "home":
      return <HomeView />;
    case "watch":
      return <WatchView videoId={view.videoId} />;
    case "channel":
      return <ChannelView channelId={view.channelId} />;
    case "search":
      return <SearchView query={view.query} />;
    case "trending":
      return <TrendingView />;
    case "subscriptions":
      return <SubscriptionsView />;
    case "history":
      return <HistoryView />;
    case "liked":
      return <LikedView />;
    case "library":
      return <LibraryView />;
    case "category":
      return <CategoryView category={view.category} />;
    case "settings":
      return <SettingsView initialTab={view.tab} />;
    case "profile":
      return <ProfileView />;
    case "favorites":
      return <FavoritesView />;
    case "watchLater":
      return <WatchLaterView />;
    case "playlist":
      return <PlaylistView playlistId={view.playlistId} />;
    case "smartPlaylist":
      return <SmartPlaylistResultsView playlistId={view.playlistId} />;
    case "clip":
      return <ClipView clipId={view.clipId} />;
    case "recommendationProfile":
      return <RecommendationProfileView />;
    case "shorts":
      return <ShortsFeedView />;
    case "live":
      return <LiveStreamView streamId={view.streamId} />;
  }
}

export default function Page() {
  const { view, syncFromUrl } = useAppStore();
  const bid = useBrowserId();

  // Mount the super-app integration bridge onto window.mashahd.
  useMashahdBridge();

  // §59 — Multi-device sync. Fire-and-forget on mount: pull the user's
  // cross-device state (preferences, history, library, continue-watching,
  // interest profiles, blocks) so this device is up-to-date. Doesn't
  // block rendering — we just trigger the fetch and let React Query /
  // component-level queries pick up the new state when it lands. Runs
  // once per mount, after the signed browserId is available.
  useEffect(() => {
    if (!bid) return;
    fetch(`/api/sync?bid=${encodeURIComponent(bid)}`, { method: "GET" })
      .then(() => {
        // Sync document received — the components that care about the
        // synced state (continue-watching shelf, history view, etc.) will
        // refetch their own queries on next interaction. We don't write
        // the synced state into the store here to keep this fire-and-forget.
      })
      .catch(() => {
        // Sync failures are non-fatal — the user can still use the app
        // with whatever local state is on this device.
      });
  }, [bid]);

  // Keep the store in sync with browser back / forward.
  useEffect(() => {
    const onPop = () => {
      syncFromUrl();
    };
    window.addEventListener("popstate", onPop);
    // Replace the initial state so popstate fires correctly on first back.
    if (window.history.state?.view === undefined) {
      window.history.replaceState({ view }, "", window.location.href);
    }
    return () => window.removeEventListener("popstate", onPop);
  }, [syncFromUrl, view]);

  return (
    <div className="relative min-h-screen flex flex-col bg-background">
      {/* Aurora wash — the signature Mashahd atmospheric backdrop. Faint so
          content stays legible; only visible at the top edges. */}
      <div className="pointer-events-none fixed inset-0 aurora-bg opacity-50" aria-hidden />
      <div className="relative flex flex-col min-h-screen">
        <Header />
        {/* Main content — Mashahd is a standalone video module. The bottom
            Dock handles all navigation; there is no left sidebar or
            sibling-module rail. */}
        <main className="flex-1 min-w-0 flex flex-col pb-24">
          <div className="flex-1">{renderView(view)}</div>
          <Footer />
        </main>
        {/* Bottom Dock — floating glass navigation */}
        <Dock />
        {/* ⌘K Command Palette */}
        <CommandPalette />
        {/* One-time animated splash on first visit */}
        <Splash />
        {/* Global keyboard shortcuts + Shift+? help overlay */}
        <KeyboardShortcuts />
        {/* Floating mini-player (PiP-style) when navigating away from a video */}
        <MiniPlayer />
        {/* 3-step onboarding tour for first-time visitors */}
        <OnboardingTour />
      </div>
    </div>
  );
}
