"use client";

import { useAppStore } from "@/store/app-store";
import { MashahdMark } from "@/components/brand/mashahd-logo";

/**
 * Footer with site info and quick navigation. Sticks to the bottom of the
 * viewport on short pages (the page wrapper is `min-h-screen flex flex-col`
 * with this footer's parent `main` being `flex-1`).
 */
export function Footer() {
  const { navigate } = useAppStore();
  const links: { label: string; view: Parameters<typeof navigate>[0] }[] = [
    { label: "Home", view: { kind: "home" } },
    { label: "Trending", view: { kind: "trending" } },
    { label: "Subscriptions", view: { kind: "subscriptions" } },
    { label: "History", view: { kind: "history" } },
    { label: "Liked", view: { kind: "liked" } },
  ];

  return (
    <footer className="mt-auto glass border-t border-gold/15">
      <div className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2">
            <MashahdMark size={22} animated={false} />
            <span className="font-bold tracking-tight gradient-text-gold">Mashahd</span>
            <span className="text-xs text-muted-foreground ml-1" lang="ar" style={{ direction: "rtl" }}>
              مشاهِد
            </span>
            <span className="text-xs text-muted-foreground ml-2 hidden sm:inline">
              — a video discovery app
            </span>
          </div>
          <nav className="flex flex-wrap gap-x-5 gap-y-2 text-sm text-muted-foreground">
            {links.map((l) => (
              <button
                key={l.label}
                onClick={() => navigate(l.view)}
                className="hover:text-foreground transition-colors"
              >
                {l.label}
              </button>
            ))}
          </nav>
        </div>
        <p className="mt-4 text-xs text-muted-foreground max-w-2xl">
          Mashahd (مشاهِد) — built with Next.js 16, TypeScript, Tailwind CSS 4 &amp;
          shadcn/ui. Brand mark &amp; AI feature concepts adapted from CIRKLE
          (دواير). All channels, videos and comments shown here are demo
          content. Video playback uses Google&apos;s public sample MP4s;
          thumbnails are fetched via the z-ai image-search service.
        </p>
      </div>
    </footer>
  );
}
