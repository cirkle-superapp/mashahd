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
import { RecommendationProfileView } from "@/components/youtube/recommendation-profile-view";
import { useMashahdBridge } from "@/lib/mashahd-bridge";
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
    case "recommendationProfile":
      return <RecommendationProfileView />;
  }
}

export default function Page() {
  const { view, syncFromUrl } = useAppStore();

  // Mount the super-app integration bridge onto window.mashahd.
  useMashahdBridge();

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
