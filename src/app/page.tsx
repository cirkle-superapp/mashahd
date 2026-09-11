"use client";

import { useEffect } from "react";
import { useAppStore } from "@/store/app-store";
import { Header } from "@/components/youtube/header";
import { Sidebar } from "@/components/youtube/sidebar";
import { HomeView } from "@/components/youtube/home-view";
import { WatchView } from "@/components/youtube/watch-view";
import { ChannelView } from "@/components/youtube/channel-view";
import {
  SearchView,
  TrendingView,
  SubscriptionsView,
  HistoryView,
  LikedView,
  LibraryView,
} from "@/components/youtube/list-views";
import { Footer } from "@/components/youtube/footer";
import { CommandPalette } from "@/components/youtube/command-palette";
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
  }
}

export default function Page() {
  const { view, sidebarOpen, syncFromUrl } = useAppStore();

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
  }, [syncFromUrl]);

  return (
    <div className="min-h-screen flex flex-col bg-background">
      <Header />
      <div className="flex flex-1 min-h-0">
        {/* Desktop sidebar */}
        <aside
          className={cn(
            "hidden md:block shrink-0 border-r border-border overflow-hidden transition-all duration-200 sticky top-14 h-[calc(100vh-3.5rem)]",
            sidebarOpen ? "w-60" : "w-0"
          )}
        >
          <div className={cn("w-60 h-full", !sidebarOpen && "opacity-0")}>
            <Sidebar />
          </div>
        </aside>

        {/* Main content — flex column so Footer's `mt-auto` sticks it to
            the bottom of the viewport on short pages, and it gets pushed
            down naturally when content is taller than the screen. */}
        <main className="flex-1 min-w-0 flex flex-col">
          <div className="flex-1">{renderView(view)}</div>
          <Footer />
        </main>
      </div>
      {/* ⌘K Command Palette — Mashahd (adapted from CIRKLE) */}
      <CommandPalette />
    </div>
  );
}
