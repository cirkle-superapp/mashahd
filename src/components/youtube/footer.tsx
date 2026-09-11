"use client";

import { useAppStore } from "@/store/app-store";

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
    <footer className="mt-auto border-t border-border bg-muted/30">
      <div className="px-4 sm:px-6 py-6 max-w-[1400px] mx-auto">
        <div className="flex flex-col sm:flex-row sm:items-center sm:justify-between gap-4">
          <div className="flex items-center gap-2">
            <span className="flex items-center justify-center w-7 h-7 rounded bg-red-600">
              <svg viewBox="0 0 24 24" className="w-4 h-4 fill-white" aria-hidden>
                <path d="M8 5v14l11-7z" />
              </svg>
            </span>
            <span className="font-bold tracking-tight">ZTube</span>
            <span className="text-xs text-muted-foreground ml-2">— a YouTube-style demo</span>
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
          Built with Next.js 16, TypeScript, Tailwind CSS 4 &amp; shadcn/ui. All
          channels, videos and comments shown here are demo content. Video
          playback uses Google&apos;s public sample MP4s; thumbnails are fetched
          from real web sources via the z-ai image-search service.
        </p>
      </div>
    </footer>
  );
}
