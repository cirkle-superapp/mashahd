"use client";

import { useState, useEffect } from "react";
import { Home, Flame, ListVideo, Clock, ThumbsUp, User, LayoutGrid, X, Compass, Sparkles, Settings, HelpCircle, MessageSquare, Heart, Bookmark, ListMusic, Zap } from "lucide-react";
import {
  Sheet,
  SheetContent,
  SheetHeader,
  SheetTitle,
  SheetDescription,
} from "@/components/ui/sheet";
import { useAppStore, View } from "@/store/app-store";
import { useBrowserId } from "@/hooks/use-browser-id";
import { cn } from "@/lib/utils";
import { toast } from "sonner";

/**
 * Dock — Mashahd's bottom navigation bar (NOT a YouTube-style left sidebar).
 *
 * Architecture adapted from CIRKLE's `src/components/shell/dock.tsx`:
 *   - 5 primary tabs always visible in a floating glass dock at the bottom.
 *   - A "More" button opens a sheet with secondary destinations
 *     (Library, Settings, Help, Feedback, Explore categories).
 *
 * This deliberately replaces the YouTube-style left sidebar so Mashahd has
 * its own navigation identity as a super-app module.
 */

type DockTab = {
  id: string;
  label: string;
  icon: React.ComponentType<{ className?: string }>;
  view: View;
};

const PRIMARY_TABS: DockTab[] = [
  { id: "home", label: "Home", icon: Home, view: { kind: "home" } },
  { id: "shorts", label: "Shorts", icon: Zap, view: { kind: "shorts" } },
  { id: "trending", label: "Trending", icon: Flame, view: { kind: "trending" } },
  { id: "subs", label: "Subs", icon: ListVideo, view: { kind: "subscriptions" } },
  { id: "profile", label: "You", icon: User, view: { kind: "profile" } },
];

const MORE_LINKS: { label: string; icon: React.ComponentType<{ className?: string }>; view: View }[] = [
  { label: "Favorites", icon: Heart, view: { kind: "favorites" } },
  { label: "Watch Later", icon: Bookmark, view: { kind: "watchLater" } },
  { label: "Library", icon: LayoutGrid, view: { kind: "library" } },
  { label: "Liked", icon: ThumbsUp, view: { kind: "liked" } },
  { label: "Playlists", icon: ListMusic, view: { kind: "library" } },
  { label: "History", icon: Clock, view: { kind: "history" } },
  { label: "Settings", icon: Settings, view: { kind: "settings", tab: "general" } },
  { label: "Help", icon: HelpCircle, view: { kind: "settings", tab: "help" } },
  { label: "Send feedback", icon: MessageSquare, view: { kind: "settings", tab: "feedback" } },
];

const EXPLORE_CATS = [
  "Music", "Gaming", "News", "Sports", "Learning",
  "Travel", "Cooking", "Fitness", "Tech", "Science",
  "Nature", "Art", "Cars",
];

export function Dock() {
  const { view, navigate } = useAppStore();
  const [moreOpen, setMoreOpen] = useState(false);
  const bid = useBrowserId();

  // ── Contextual badges (Pass 63) ──
  // Fetch live stream count + unread notification count to show as
  // small badges on the Dock tabs. This gives the user at-a-glance
  // awareness of what's happening on the platform.
  const [liveCount, setLiveCount] = useState(0);
  const [notifCount, setNotifCount] = useState(0);

  useEffect(() => {
    // Poll live streams every 30s.
    const fetchLive = () => {
      fetch("/api/live-streams?status=live")
        .then((r) => r.ok ? r.json() : null)
        .then((d) => setLiveCount(d?.count || 0))
        .catch(() => {});
    };
    fetchLive();
    const interval = setInterval(fetchLive, 30_000);
    return () => clearInterval(interval);
  }, []);

  useEffect(() => {
    if (!bid) return;
    // Fetch unread notification count.
    fetch(`/api/notifications?bid=${encodeURIComponent(bid)}&limit=1`)
      .then((r) => r.ok ? r.json() : null)
      .then((d) => setNotifCount(d?.unread || 0))
      .catch(() => {});
  }, [bid]);

  const isActive = (tabView: View): boolean => {
    // Match by kind, but for settings/profile also check we're not on a
    // different settings tab.
    if (tabView.kind === "settings" && view.kind === "settings") {
      return (view as { tab?: string }).tab === (tabView as { tab?: string }).tab;
    }
    return view.kind === tabView.kind;
  };

  return (
    <>
      {/* Bottom dock — floating glass bar, centered, with safe-area padding */}
      <nav
        className="fixed bottom-0 inset-x-0 z-40 pb-[env(safe-area-inset-bottom)] px-3 pb-3 pointer-events-none"
        aria-label="Primary navigation"
      >
        <div className="mx-auto max-w-md glass-strong rounded-full px-2 py-1.5 flex items-center justify-between shadow-float border border-gold/20 pointer-events-auto backdrop-blur-xl">
          {PRIMARY_TABS.map((tab) => {
            const Icon = tab.icon;
            const active = isActive(tab.view);
            // Contextual badges: Home gets live-stream count, Profile gets notification count.
            const badge = tab.id === "home" ? liveCount : tab.id === "profile" ? notifCount : 0;
            return (
              <button
                key={tab.id}
                onClick={() => navigate(tab.view)}
                className={cn(
                  "relative flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full transition-all min-w-[52px] min-h-[44px]",
                  active
                    ? "bg-gradient-gold text-charcoal shadow-soft"
                    : "text-muted-foreground hover:text-foreground hover:bg-gold/10"
                )}
                aria-label={tab.label}
                aria-current={active ? "page" : undefined}
              >
                <Icon className="h-5 w-5" />
                <span className="text-[10px] font-medium leading-none">{tab.label}</span>
                {/* Contextual badge — small red dot with count */}
                {badge > 0 && (
                  <span className="absolute top-0.5 right-1.5 grid place-items-center min-h-[16px] min-w-[16px] h-4 px-1 rounded-full bg-red-600 text-white text-[9px] font-bold leading-none">
                    {badge > 99 ? "99+" : badge}
                  </span>
                )}
                {/* Active indicator — gold glow at top */}
                {active && (
                  <span className="absolute -top-0.5 left-1/2 -translate-x-1/2 h-1 w-8 rounded-full bg-gold-light opacity-60 blur-sm" />
                )}
              </button>
            );
          })}
          {/* More button */}
          <button
            onClick={() => setMoreOpen(true)}
            className="flex flex-col items-center justify-center gap-0.5 px-3 py-1.5 rounded-full text-muted-foreground hover:text-foreground hover:bg-gold/10 transition-all min-w-[52px] min-h-[44px]"
            aria-label="More destinations"
          >
            <LayoutGrid className="h-5 w-5" />
            <span className="text-[10px] font-medium leading-none">More</span>
          </button>
        </div>
      </nav>

      {/* "More" sheet — secondary destinations + explore categories */}
      <Sheet open={moreOpen} onOpenChange={setMoreOpen}>
        <SheetContent side="bottom" className="rounded-t-2xl p-0 max-h-[85vh]">
          <SheetHeader className="px-5 pt-5 pb-3">
            <SheetTitle className="font-display">More</SheetTitle>
            <SheetDescription>
              Jump to any destination or browse a category.
            </SheetDescription>
          </SheetHeader>
          <div className="px-5 pb-8 overflow-y-auto custom-scroll max-h-[70vh]">
            {/* Secondary links */}
            <div className="grid grid-cols-2 gap-2 mb-6">
              {MORE_LINKS.map((l) => {
                const Icon = l.icon;
                return (
                  <button
                    key={l.label}
                    onClick={() => {
                      navigate(l.view);
                      setMoreOpen(false);
                    }}
                    className="flex items-center gap-2.5 p-3 rounded-xl border border-border bg-card hover:bg-accent/50 transition-colors text-left"
                  >
                    <Icon className="h-4 w-4 text-[hsl(var(--gold))]" />
                    <span className="text-sm font-medium">{l.label}</span>
                  </button>
                );
              })}
            </div>

            {/* Explore categories */}
            <h3 className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-2 flex items-center gap-1.5">
              <Compass className="h-3.5 w-3.5" /> Explore
            </h3>
            <div className="flex flex-wrap gap-2">
              {EXPLORE_CATS.map((cat) => (
                <button
                  key={cat}
                  onClick={() => {
                    navigate({ kind: "category", category: cat });
                    setMoreOpen(false);
                  }}
                  className="px-3 py-1.5 rounded-full text-xs font-medium brand-chip transition-colors"
                >
                  {cat}
                </button>
              ))}
            </div>

            {/* Command palette CTA */}
            <button
              onClick={() => {
                setMoreOpen(false);
                toast.info("Press ⌘K anytime to open the command palette");
              }}
              className="mt-6 w-full flex items-center gap-2 p-3 rounded-xl border border-gold/25 bg-gradient-to-br from-[hsl(var(--gold)/0.08)] to-transparent hover:from-[hsl(var(--gold)/0.14)] transition-colors text-left"
            >
              <Sparkles className="h-4 w-4 text-[hsl(var(--gold))]" />
              <span className="text-sm">Command palette (⌘K)</span>
            </button>
          </div>
        </SheetContent>
      </Sheet>
    </>
  );
}
