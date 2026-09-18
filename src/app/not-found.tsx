import Link from "next/link";
import { Compass } from "lucide-react";

/**
 * not-found.tsx — Next.js 404 page.
 *
 * Since Mashahd is a SPA-on-`/` architecture, this page is only reachable
 * if the user navigates to a non-existent path (e.g. /unknown-route).
 * It provides a friendly recovery path back to the app.
 */
export default function NotFound() {
  return (
    <main className="flex min-h-screen flex-col items-center justify-center gap-6 bg-background p-6 text-center">
      <div className="flex h-16 w-16 items-center justify-center rounded-2xl bg-gold/10 text-[hsl(var(--gold))]">
        <Compass className="h-8 w-8" aria-hidden />
      </div>
      <div>
        <h1 className="text-3xl font-bold font-display">404 — Page not found</h1>
        <p className="mt-2 max-w-md text-sm text-muted-foreground">
          This page doesn&apos;t exist. Mashahd is a single-page app — everything
          lives at the home route. Let&apos;s get you back.
        </p>
      </div>
      <Link
        href="/"
        className="inline-flex items-center gap-2 rounded-full bg-primary px-6 py-2.5 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
      >
        Back to Mashahd
      </Link>
    </main>
  );
}
