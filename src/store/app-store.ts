"use client";

import { create } from "zustand";

export type View =
  | { kind: "home" }
  | { kind: "watch"; videoId: string }
  | { kind: "channel"; channelId: string }
  | { kind: "search"; query: string }
  | { kind: "trending" }
  | { kind: "subscriptions" }
  | { kind: "history" }
  | { kind: "liked" }
  | { kind: "library" }
  | { kind: "category"; category: string }
  | { kind: "settings"; tab?: string }
  | { kind: "profile" }
  | { kind: "favorites" }
  | { kind: "watchLater" }
  | { kind: "playlist"; playlistId: string }
  | { kind: "smartPlaylist"; playlistId: string }
  | { kind: "recommendationProfile" };

type AppState = {
  view: View;
  sidebarOpen: boolean;
  // search draft state
  searchDraft: string;
  // navigate to a new view (pushes a new history entry)
  navigate: (v: View) => void;
  // sync the store's view from the current URL WITHOUT pushing history
  // (used by the popstate handler for back/forward)
  syncFromUrl: () => void;
  setSidebarOpen: (open: boolean) => void;
  toggleSidebar: () => void;
  setSearchDraft: (s: string) => void;
};

/** Serialize a View into URL search params. */
export function viewToQuery(v: View): string {
  switch (v.kind) {
    case "home":
      return "";
    case "watch":
      return `?v=watch&id=${encodeURIComponent(v.videoId)}`;
    case "channel":
      return `?v=channel&id=${encodeURIComponent(v.channelId)}`;
    case "search":
      return `?v=search&q=${encodeURIComponent(v.query)}`;
    case "trending":
      return `?v=trending`;
    case "subscriptions":
      return `?v=subscriptions`;
    case "history":
      return `?v=history`;
    case "liked":
      return `?v=liked`;
    case "library":
      return `?v=library`;
    case "category":
      return `?v=category&cat=${encodeURIComponent(v.category)}`;
    case "settings":
      return v.tab ? `?v=settings&tab=${encodeURIComponent(v.tab)}` : `?v=settings`;
    case "profile":
      return `?v=profile`;
    case "favorites":
      return `?v=favorites`;
    case "watchLater":
      return `?v=watchLater`;
    case "playlist":
      return `?v=playlist&id=${encodeURIComponent(v.playlistId)}`;
    case "smartPlaylist":
      return `?v=smartPlaylist&id=${encodeURIComponent(v.playlistId)}`;
    case "recommendationProfile":
      return `?v=recommendationProfile`;
  }
}

/** Parse URL search params into a View. */
export function queryToView(search: string): View {
  const sp = new URLSearchParams(search);
  const v = sp.get("v") || "home";
  switch (v) {
    case "watch":
      return { kind: "watch", videoId: sp.get("id") || "" };
    case "channel":
      return { kind: "channel", channelId: sp.get("id") || "" };
    case "search":
      return { kind: "search", query: sp.get("q") || "" };
    case "trending":
      return { kind: "trending" };
    case "subscriptions":
      return { kind: "subscriptions" };
    case "history":
      return { kind: "history" };
    case "liked":
      return { kind: "liked" };
    case "library":
      return { kind: "library" };
    case "category":
      return { kind: "category", category: sp.get("cat") || "All" };
    case "settings":
      return { kind: "settings", tab: sp.get("tab") || undefined };
    case "profile":
      return { kind: "profile" };
    case "favorites":
      return { kind: "favorites" };
    case "watchLater":
      return { kind: "watchLater" };
    case "playlist":
      return { kind: "playlist", playlistId: sp.get("id") || "" };
    case "smartPlaylist":
      return { kind: "smartPlaylist", playlistId: sp.get("id") || "" };
    case "recommendationProfile":
      return { kind: "recommendationProfile" };
    default:
      return { kind: "home" };
  }
}

export const useAppStore = create<AppState>((set) => ({
  view: typeof window !== "undefined"
    ? queryToView(window.location.search)
    : { kind: "home" },
  sidebarOpen: true,
  searchDraft: typeof window !== "undefined"
    ? queryToView(window.location.search).kind === "search"
      ? (new URLSearchParams(window.location.search).get("q") || "")
      : ""
    : "",
  navigate: (v) => {
    set({ view: v });
    if (typeof window !== "undefined") {
      const q = viewToQuery(v);
      const newUrl = window.location.pathname + q;
      window.history.pushState({ view: v }, "", newUrl);
      // scroll to top on navigation
      window.scrollTo({ top: 0, behavior: "auto" });
    }
  },
  syncFromUrl: () => {
    if (typeof window === "undefined") return;
    const v = queryToView(window.location.search);
    set({ view: v, searchDraft: v.kind === "search" ? v.query : "" });
  },
  setSidebarOpen: (open) => set({ sidebarOpen: open }),
  toggleSidebar: () => set((s) => ({ sidebarOpen: !s.sidebarOpen })),
  setSearchDraft: (s) => set({ searchDraft: s }),
}));
