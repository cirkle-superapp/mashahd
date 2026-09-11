"use client";

import { useState, useEffect, useRef } from "react";
import { Search, Mic, Video, Bell, Menu, Sun, Moon, Command } from "lucide-react";
import { useTheme } from "next-themes";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Avatar, AvatarFallback, AvatarImage } from "@/components/ui/avatar";
import {
  Sheet,
  SheetContent,
  SheetTrigger,
} from "@/components/ui/sheet";
import { useAppStore, View } from "@/store/app-store";
import { Sidebar } from "./sidebar";
import { MashahdLogo } from "@/components/brand/mashahd-logo";
import { useCommandPalette } from "@/store/command-palette-store";
import Link from "next/link";

export function Header() {
  const { navigate, toggleSidebar, searchDraft, setSearchDraft } = useAppStore();
  const { theme, setTheme } = useTheme();
  const [mounted, setMounted] = useState(false);
  const [mobileOpen, setMobileOpen] = useState(false);
  const [showSuggest, setShowSuggest] = useState(false);
  const inputRef = useRef<HTMLInputElement>(null);
  const openPalette = useCommandPalette((s) => s.openPalette);

  // next-themes reads from document on the client only; we need a mounted flag
  // to avoid a hydration mismatch on the Sun/Moon icon.
  // eslint-disable-next-line react-hooks/set-state-in-effect
  useEffect(() => setMounted(true), []);

  const submitSearch = (q: string) => {
    const query = q.trim();
    if (!query) return;
    setShowSuggest(false);
    navigate({ kind: "search", query });
    inputRef.current?.blur();
  };

  const [liveSearch] = useState(["next.js", "ramen recipe", "iceland travel", "elden ring", "workout", "lofi beats", "tesla"]);

  return (
    <header className="sticky top-0 z-50 h-14 flex items-center gap-2 sm:gap-4 px-2 sm:px-4 glass-strong border-b border-gold/15">
      {/* Left: hamburger + logo */}
      <div className="flex items-center gap-2 shrink-0">
        {/* Desktop hamburger */}
        <Button
          variant="ghost"
          size="icon"
          className="hidden md:flex rounded-full hover:bg-gold/10"
          aria-label="Toggle menu"
          onClick={toggleSidebar}
        >
          <Menu className="h-5 w-5" />
        </Button>
        {/* Mobile: sidebar in a sheet */}
        <Sheet open={mobileOpen} onOpenChange={setMobileOpen}>
          <SheetTrigger asChild>
            <Button
              variant="ghost"
              size="icon"
              className="md:hidden rounded-full hover:bg-gold/10"
              aria-label="Open menu"
            >
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="w-64 p-0">
            <Sidebar onNavigate={() => setMobileOpen(false)} />
          </SheetContent>
        </Sheet>

        {/* Logo */}
        <button
          className="flex items-center gap-1 px-1 group"
          onClick={() => navigate({ kind: "home" })}
          aria-label="Mashahd home"
        >
          <MashahdLogo size={28} />
        </button>
      </div>

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
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full hidden sm:inline-flex hover:bg-gold/10"
          aria-label="Create"
          title="Create"
        >
          <Video className="h-5 w-5" />
        </Button>
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full hidden sm:inline-flex relative hover:bg-gold/10"
          aria-label="Notifications"
          title="Notifications"
        >
          <Bell className="h-5 w-5" />
          <span className="absolute top-1 right-1.5 w-2 h-2 bg-gold rounded-full" />
        </Button>
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
        <Link
          href="#"
          onClick={(e) => {
            e.preventDefault();
          }}
          className="ml-1"
          aria-label="Account"
        >
          <Avatar className="h-9 w-9 rounded-full border border-border">
            <AvatarImage src="https://api.dicebear.com/7.x/initials/svg?seed=You&backgroundColor=c2a060" alt="" />
            <AvatarFallback>Y</AvatarFallback>
          </Avatar>
        </Link>
        {/* Command palette (⌘K) trigger — Mashahd, adapted from CIRKLE. */}
        <Button
          variant="ghost"
          size="icon"
          className="rounded-full hidden lg:inline-flex"
          onClick={() => openPalette()}
          aria-label="Command palette"
          title="Command palette  (⌘K)"
        >
          <Command className="h-4 w-4" />
        </Button>
      </div>
    </header>
  );
}

export type { View };
