/**
 * Mashahd Edge Worker — Cloudflare Worker (free tier: 100K req/day, 10ms CPU)
 *
 * Service Worker format (no ES modules). This is a thin edge layer that:
 *   1. Caches HLS segments at the edge (immutable, 1 year)
 *   2. Caches master manifests for 10 minutes (mutable)
 *   3. Routes /api/* to the origin (Vercel or self-hosted)
 *   4. Adds security headers (HSTS, X-Frame-Options, etc.)
 *
 * Deploy:
 *   wrangler deploy cloudflare/worker.js --name mashahd-edge
 *
 * Or via API:
 *   curl -X PUT -H "Authorization: Bearer $TOKEN" \
 *     "https://api.cloudflare.com/client/v4/accounts/$ACCOUNT_ID/workers/scripts/mashahd-edge" \
 *     --data-binary @cloudflare/worker.js
 */

var IMMUTABLE_CACHE = "public, max-age=31536000, immutable";
var MANIFEST_CACHE = "public, max-age=600";
var NO_CACHE = "no-store";

var SECURITY_HEADERS = {
  "Strict-Transport-Security": "max-age=63072000; includeSubDomains; preload",
  "X-Frame-Options": "SAMEORIGIN",
  "X-Content-Type-Options": "nosniff",
  "Referrer-Policy": "strict-origin-when-cross-origin",
  "Permissions-Policy": "camera=(), microphone=(), geolocation=()"
};

var ORIGIN_URL = "https://mashahd.vercel.app";

addEventListener("fetch", function(event) {
  event.respondWith(handleRequest(event.request));
});

function handleRequest(request) {
  var url = new URL(request.url);
  var path = url.pathname;

  // API routes: only cache media manifest/segment routes.
  if (path.startsWith("/api/")) {
    if (path.indexOf("/manifest/") !== -1) {
      return handleMedia(request);
    }
    return proxyToOrigin(request, NO_CACHE);
  }

  // Static assets: long cache.
  return proxyToOrigin(request, IMMUTABLE_CACHE);
}

function handleMedia(request) {
  var url = new URL(request.url);
  var cacheKey = new Request(url, request);
  var cache = caches.default;

  return cache.match(cacheKey).then(function(cached) {
    if (cached) {
      var headers = new Headers(cached.headers);
      for (var k in SECURITY_HEADERS) {
        headers.set(k, SECURITY_HEADERS[k]);
      }
      return new Response(cached.body, {
        status: cached.status,
        statusText: cached.statusText,
        headers: headers
      });
    }

    return proxyToOrigin(request, NO_CACHE).then(function(response) {
      if (response.status !== 200) return response;

      var path = url.pathname;
      var isSegment = path.endsWith(".m4s") || path.endsWith(".mp4") ||
        path.endsWith(".ts") || path.endsWith(".jpg") || path.endsWith(".png");
      var cacheControl = isSegment ? IMMUTABLE_CACHE : MANIFEST_CACHE;

      return response.text().then(function(body) {
        var headers = new Headers(response.headers);
        headers.set("Cache-Control", cacheControl);
        for (var k in SECURITY_HEADERS) {
          headers.set(k, SECURITY_HEADERS[k]);
        }

        if (request.method === "GET") {
          var cacheResponse = new Response(body, { headers: headers });
          cache.put(cacheKey, cacheResponse);
        }

        return new Response(body, { status: 200, headers: headers });
      });
    });
  });
}

function proxyToOrigin(request, cacheControl) {
  var url = new URL(request.url);
  var targetUrl = ORIGIN_URL + url.pathname + url.search;

  var headers = new Headers(request.headers);
  headers.set("Host", new URL(ORIGIN_URL).host);
  var cfIp = request.headers.get("CF-Connecting-IP");
  if (cfIp) headers.set("X-Forwarded-For", cfIp);
  headers.set("X-Forwarded-Proto", "https");

  var fetchOpts = {
    method: request.method,
    headers: headers
  };
  if (request.method !== "GET" && request.method !== "HEAD") {
    fetchOpts.body = request.body;
  }

  return fetch(targetUrl, fetchOpts).then(function(response) {
    var respHeaders = new Headers(response.headers);
    if (cacheControl !== NO_CACHE) {
      respHeaders.set("Cache-Control", cacheControl);
    }
    for (var k in SECURITY_HEADERS) {
      respHeaders.set(k, SECURITY_HEADERS[k]);
    }

    return new Response(response.body, {
      status: response.status,
      statusText: response.statusText,
      headers: respHeaders
    });
  }).catch(function(e) {
    return new Response(JSON.stringify({ error: "Origin unavailable", detail: e.message }), {
      status: 502,
      headers: { "Content-Type": "application/json" }
    });
  });
}
