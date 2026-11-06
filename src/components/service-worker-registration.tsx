"use client";

import { useEffect } from "react";

/**
 * ServiceWorkerRegistration — registers /sw.js for PWA offline support.
 *
 * Mounted once in the root layout. The service worker precaches the app
 * shell (HTML, CSS, JS) so Mashahd loads even when offline, and uses
 * stale-while-revalidate for open-data API responses. This makes the
 * app installable (Add to Home Screen) — years ahead of competitors
 * whose web apps require connectivity.
 */
export function ServiceWorkerRegistration() {
  useEffect(() => {
    if (
      typeof window === "undefined" ||
      !("serviceWorker" in navigator) ||
      process.env.NODE_ENV !== "production"
    ) {
      // Only register in production — dev server HMR conflicts with SW caching.
      return;
    }
    const register = () => {
      navigator.serviceWorker
        .register("/sw.js")
        .catch(() => {
          // SW registration failed — silently ignore (app still works online).
        });
    };
    if (document.readyState === "complete") register();
    else window.addEventListener("load", register, { once: true });
  }, []);
  return null;
}
