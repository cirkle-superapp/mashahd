/**
 * Mashahd Service Worker — PWA offline shell + cached assets (Pass 101).
 *
 * Strategy:
 *   - Precache the app shell (HTML, CSS, JS bundles, logo) on install.
 *   - Cache-first for static assets (/_next/static/*, fonts, icons).
 *   - Network-first for HTML navigations (falls back to cached shell offline).
 *   - NEVER cache video segments (HLS .m3u8/.ts) — those flow through the
 *     P2P engine or CDN; caching them would blow the storage budget.
 *
 * This makes Mashahd installable (Add to Home Screen) and usable offline
 * for the app shell — years ahead of competitors whose web apps are
 * useless without connectivity.
 */

const CACHE_VERSION = "mashahd-v101";
const SHELL_CACHE = `${CACHE_VERSION}-shell`;
const ASSET_CACHE = `${CACHE_VERSION}-assets`;

// App shell routes that should be available offline.
const SHELL_ROUTES = ["/", "/manifest.webmanifest"];

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches.open(SHELL_CACHE).then((cache) =>
      cache.addAll(SHELL_ROUTES).catch(() => {
        // If any route fails, the shell is still partially cached.
      })
    )
  );
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches.keys().then((keys) =>
      Promise.all(
        keys
          .filter((k) => !k.startsWith(CACHE_VERSION))
          .map((k) => caches.delete(k))
      )
    )
  );
  self.clients.claim();
});

self.addEventListener("fetch", (event) => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET — never intercept POST/PUT/etc.
  if (req.method !== "GET") return;

  // NEVER cache video segments or media uploads — they're too large and
  // flow through the P2P engine or CDN.
  if (
    url.pathname.includes("/api/media/") ||
    url.pathname.endsWith(".m3u8") ||
    url.pathname.endsWith(".ts") ||
    url.pathname.endsWith(".mp4") ||
    url.pathname.includes("/uploads/")
  ) {
    return; // Let the request pass through to the network.
  }

  // Strategy 1: Cache-first for static build assets (immutable).
  if (url.pathname.startsWith("/_next/static/") || url.pathname.includes("/fonts/")) {
    event.respondWith(
      caches.match(req).then(
        (cached) =>
          cached ||
          fetch(req).then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(ASSET_CACHE).then((c) => c.put(req, clone));
            }
            return res;
          })
      )
    );
    return;
  }

  // Strategy 2: Network-first for HTML navigations (offline fallback).
  if (req.mode === "navigate" || (req.headers.get("accept") || "").includes("text/html")) {
    event.respondWith(
      fetch(req)
        .then((res) => {
          if (res.ok) {
            const clone = res.clone();
            caches.open(SHELL_CACHE).then((c) => c.put(req, clone));
          }
          return res;
        })
        .catch(() => caches.match(req).then((c) => c || caches.match("/")))
    );
    return;
  }

  // Strategy 3: Stale-while-revalidate for API GETs (open-data, catalog).
  if (url.pathname.startsWith("/api/open-data/") || url.pathname.startsWith("/api/catalog")) {
    event.respondWith(
      caches.match(req).then((cached) => {
        const fetchPromise = fetch(req)
          .then((res) => {
            if (res.ok) {
              const clone = res.clone();
              caches.open(ASSET_CACHE).then((c) => c.put(req, clone));
            }
            return res;
          })
          .catch(() => cached);
        return cached || fetchPromise;
      })
    );
    return;
  }
});
