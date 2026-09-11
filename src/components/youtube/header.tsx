"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Mic, Sun, Moon, Command, Radio, LogIn } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import { useAppStore, View } from "@/store/app-store";
import { MashahdLogo } from "@/components/brand/mashahd-logo";
import { useCommandPalette } from "@/store/command-palette-store";
import { NotificationsButton, CreateButton } from "./header-overlays";
import { GoLive } from "./go-live";
import { CreateChannel } from "./create-channel";
import { UserAvatar } from "./user-avatar";
import { AuthScreen } from "./auth-screen";
import { useAuth } from "@/hooks/use-auth";

export function Header() {
  const { navigate, searchDraft, setSearchDraft } = useAppStore();
  const { theme, setTheme } = useTheme();
  const { user } = useAuth();
  const [mounted, setMounted] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const [goLiveOpen, setGoLiveOpen] = useState(false);
  const [createChannelOpen, setCreateChannelOpen] = useState(false);
  const [authOpen, setAuthOpen] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openPalette = useCommandPalette((s) => s.openPalette);

  // next-themes reads from document on the client only; we need a mounted flag
  // to avoid a hydration mismatch on the Sun/Moon icon.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  // Listen for command-palette triggers to open Go Live / Create Channel.
  useEffect(() => {
    const onGoLive = () => setGoLiveOpen(true);
    const onCreateChannel = () => setCreateChannelOpen(true);
    window.addEventListener("mashahd:go-live", onGoLive);
    window.addEventListener("mashahd:create-channel", onCreateChannel);
    return () => {
      window.removeEventListener("mashahd:go-live", onGoLive);
      window.removeEventListener("mashahd:create-channel", onCreateChannel);
    };
  }, []);

  const submitSearch = (q: string) => {
    const query = q.trim();
    if (!query) return;
    setShowSuggest(false);
    navigate({ kind: "search", query });
    inputRef.current?.blur();
  };

  const [liveSearch] = useState(["next.js", "ramen recipe", "iceland travel", "elden ring", "workout", "lofi beats", "tesla"]);

  return (
    <header className="sticky top-0 z-50 px-3 pt-3">
      {/* Floating glass pill — semi-transparent so content scrolls visibly
          behind it (Mashahd identity, adapted from CIRKLE's TopBar). */}
      <div className="glass rounded-full px-3 py-2 flex items-center gap-2 shadow-glass border border-gold/15">
        {/* Left: logo (no hamburger — the bottom Dock replaces the sidebar) */}
        <button
          className="flex items-center gap-1 px-1 group shrink-0"
          onClick={() => navigate({ kind: "home" })}
          aria-label="Mashahd home"
        >
          <MashahdLogo size={28} />
        </button>

      {/* Center: search */}
      <div className="flex-1 flex items-center justify-center max-w-2xl mx-auto">
        <div className="relative w-full flex">
          <div className="relative flex-1 group">
            <Input
              ref={inputRef}
              value={searchDraft}
              onChange={(e) => setSearchDraft(e.target.value)}
              onFocus={() => setShowSuggest(true)}
              onKeyDown={(e) => {
                if (e.key === "Enter") submitSearch(searchDraft);
                if (e.key === "Escape") {
                  setShowSuggest(false);
                  inputRef.current?.blur();
                }
              }}
              placeholder="Search"
              className="w-full h-10 rounded-full md:rounded-l-full md:rounded-r-none md:border-r-0 pr-12 md:pr-4 bg-surface/70 border-border focus-visible:ring-1 focus-visible:ring-gold/60 placeholder:text-muted-foreground"
              aria-label="Search"
            />
            {/* Mobile search submit button */}
            <Button
              type="button"
              size="icon"
              variant="ghost"
              className="absolute right-1 top-1/2 -translate-y-1/2 md:hidden h-8 w-8 rounded-full"
              onClick={() => submitSearch(searchDraft)}
              aria-label="Search"
            >
              <Search className="h-4 w-4" />
            </Button>

            {showSuggest && (
              <>
                <div
                  className="fixed inset-0 z-40"
                  onClick={() => setShowSuggest(false)}
                />
                <div className="absolute left-0 right-0 top-11 z-50 bg-popover border border-border rounded-lg shadow-lg overflow-hidden max-h-80 overflow-y-auto">
                  <p className="px-4 py-2 text-xs text-muted-foreground uppercase tracking-wide">
                    Trending searches
                  </p>
                  {liveSearch
                    .filter((s) =>
                      searchDraft
                        ? s.toLowerCase().includes(searchDraft.toLowerCase())
                        : true
                    )
                    .map((s) => (
                      <button
                        key={s}
                        className="flex items-center gap-3 w-full px-4 py-2 hover:bg-accent text-left text-sm"
                        onClick={() => {
                          setSearchDraft(s);
                          submitSearch(s);
                        }}
                      >
                        <Search className="h-4 w-4 text-muted-foreground" />
                        <span>{s}</span>
                      </button>
                    ))}
                </div>
              </>
            )}
          </div>
          {/* Desktop search button */}
          <Button
            type="button"
            variant="secondary"
            className="hidden md:flex h-10 rounded-r-full px-6 bg-surface hover:bg-gold/10 border border-l-0 border-border text-foreground"
            onClick={() => submitSearch(searchDraft)}
            aria-label="Search"
          >
            <Search className="h-5 w-5" />
          </Button>
          {/* Mic */}
          <Button
            variant="ghost"
            size="icon"
            className="hidden md:flex ml-2 rounded-full bg-surface hover:bg-gold/10"
            aria-label="Voice search"
            title="Voice search"
          >
            <Mic className="h-4 w-4" />
          </Button>
        </div>
      </div>

      {/* Right: actions */}
      <div className="flex items-center gap-1 sm:gap-2 shrink-0">
        {/* Go Live — prominent red pill, easy to start */}
        <Button
          onClick={() => setGoLiveOpen(true)}
          size="sm"
          className="rounded-full bg-red-600 text-white hover:bg-red-700 font-semibold h-9 px-3 sm:px-4"
          aria-label="Go live"
          title="Start a live stream"
        >
          <Radio className="h-4 w-4 sm:mr-1.5 fill-current" />
          <span className="hidden sm:inline">Go Live</span>
        </Button>
        <CreateButton />
        <NotificationsButton />
        {mounted && (
          <Button
            variant="ghost"
            size="icon"
            className="rounded-full hover:bg-gold/10"
            onClick={() => setTheme(theme === "dark" ? "light" : "dark")}
            aria-label="Toggle theme"
            title="Toggle theme"
          >
            {theme === "dark" ? (
              <Sun className="h-5 w-5" />
            ) : (
              <Moon className="h-5 w-5" />
            )}
          </Button>
        )}
        {/* Profile avatar / Sign-in button — shows the auth screen if
            the user isn't logged in, or the profile if they are. */}
        {user ? (
          <button
            onClick={() => navigate({ kind: "profile" })}
            className="ml-1 shrink-0 rounded-full"
            aria-label="Open your profile"
            title="Profile"
          >
            {user.avatarUrl ? (
              <Avatar className="h-9 w-9 rounded-full border border-gold/30 hover:ring-2 hover:ring-gold/40 transition-all">
                <AvatarImage src={user.avatarUrl} alt={user.displayName} />
                <AvatarFallback>{user.displayName.slice(0, 1)}</AvatarFallback>
              </Avatar>
            ) : (
              <UserAvatar className="h-9 w-9 rounded-full border border-gold/30 hover:ring-2 hover:ring-gold/40 transition-all" />
            )}
          </button>
        ) : (
          <Button
            onClick={() => setAuthOpen(true)}
            size="sm"
            className="ml-1 rounded-full bg-primary text-primary-foreground hover:bg-primary/90 h-9 px-4 font-medium"
            aria-label="Sign in"
            title="Sign in or create an account"
          >
            <LogIn className="h-4 w-4 mr-1.5" />
            Sign in
          </Button>
        )}
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full hidden lg:inline-flex hover:bg-gold/10"
          onClick={() => openPalette()}
          aria-label="Command palette"
          title="Command palette  (⌘K)"
        >
          <Command className="h-4 w-4" />
        </Button>
        </div>
      </div>
      {/* Auth + Go Live + Create Channel dialogs */}
      <AuthScreen open={authOpen} onOpenChange={setAuthOpen} />
      <GoLive open={goLiveOpen} onOpenChange={setGoLiveOpen} />
      <CreateChannel open={createChannelOpen} onOpenChange={setCreateChannelOpen} />
    </header>
  );
}

export type { View };
