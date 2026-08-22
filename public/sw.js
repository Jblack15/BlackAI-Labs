/* DealForge Properties — service worker (mobile PWA).
 *
 * HONEST SCOPE: this is a minimal, network-first installability/offline worker,
 * NOT a full offline app. The site is server-rendered on demand against Neon
 * Postgres behind owner auth, so we do not promise offline access to live
 * owner data. What we DO provide:
 *   - Precaching the app shell + static brand/assets for a fast, resilient
 *     cold start and a real "add to home screen" (installability) signal.
 *   - Network-first for API + navigation requests (fall back to cached shell
 *     / offline page only when truly offline).
 *   - Aggressive stale-while-revalidate for versioned static assets under
 *     /assets/ (hashed by Vite, so a cache-busting update is expected).
 * Owner data / API calls are NEVER cached to disk — they are proxied
 * network-only so nothing sensitive is persisted in the service-worker cache.
 */

const VERSION = "v1";
const SHELL_CACHE = `dealforge-shell-${VERSION}`;
const ASSET_CACHE = `dealforge-assets-${VERSION}`;

const SHELL_URLS = [
  "/",
  "/login",
  "/icons/icon-192.png",
  "/icons/icon-512.png",
  "/icons/maskable-192.png",
  "/icons/maskable-512.png",
  "/favicon.svg",
  "/favicon-32.png",
  "/favicon-180.png",
  "/manifest.webmanifest",
];

const OFFLINE_HTML = `<!doctype html>
<html lang="en">
  <head>
    <meta charset="utf-8" />
    <meta name="viewport" content="width=device-width, initial-scale=1" />
    <title>DealForge — Offline</title>
    <style>
      body { margin:0; font-family: system-ui, sans-serif; background:#0a1628; color:#e5e7eb;
             display:flex; min-height:100vh; align-items:center; justify-content:center; }
      .box { max-width: 30rem; margin: 2rem; text-align:center; }
      h1 { color:#c8a951; font-size: 1.4rem; }
      p { color:#9ca3af; line-height:1.6; }
      a { color:#d6bc6f; }
    </style>
  </head>
  <body>
    <div class="box">
      <h1>DealForge — you're offline</h1>
      <p>This page needs a connection to load your live data. Reconnect and try again,
         or use one of the offline-safe shortcuts on your home screen.</p>
      <p><a href="/">Retry</a></p>
    </div>
  </body>
</html>`;

self.addEventListener("install", (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((cache) => cache.addAll(SHELL_URLS))
      .catch(() => {}) // never fail install; precache is best-effort
      .then(() => self.skipWaiting())
  );
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(
          keys
            .filter((k) => k.startsWith("dealforge-") && k !== SHELL_CACHE && k !== ASSET_CACHE)
            .map((k) => caches.delete(k))
        )
      )
      .then(() => self.clients.claim())
  );
});

function offlineResponse() {
  return new Response(OFFLINE_HTML, {
    headers: { "Content-Type": "text/html; charset=utf-8" },
  });
}

self.addEventListener("fetch", (event) => {
  const { request } = event;
  if (request.method !== "GET") return;

  const url = new URL(request.url);
  if (url.origin !== self.location.origin) return;

  const path = url.pathname;

  // Never touch auth/API — owner data stays out of the cache entirely.
  if (path.startsWith("/api/")) return;

  // Versioned hashed static bundles: stale-while-revalidate under /assets/.
  if (path.startsWith("/assets/")) {
    event.respondWith(
      caches.match(request).then((cached) => {
        const network = fetch(request)
          .then((res) => {
            if (res && res.ok) {
              const clone = res.clone();
              caches.open(ASSET_CACHE).then((c) => c.put(request, clone));
            }
            return res;
          })
          .catch(() => cached);
        return cached || network;
      })
    );
    return;
  }

  // App shell (root navigation + precached files): network-first, then shell.
  if (request.mode === "navigate" || SHELL_URLS.includes(path)) {
    event.respondWith(
      fetch(request)
        .then((res) => res)
        .catch(() => caches.match(request).then((cached) => cached || offlineResponse()))
    );
    return;
  }

  // Everything else same-origin: network-first with best-effort cache fallback.
  event.respondWith(
    fetch(request)
      .then((res) => res)
      .catch(() => caches.match(request))
  );
});
