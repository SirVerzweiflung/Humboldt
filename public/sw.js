// Installability-only service worker (CLAUDE.md §11.6).
//
// This worker deliberately CACHES NOTHING. It exists because Chrome refuses to
// fire `beforeinstallprompt` unless a service worker with a fetch handler is
// registered — that is the whole reason it is here. A stale app shell on quiz
// night is far worse than a slow first load, so there is no cache to go stale.
//
// Registered only in production builds (see apps/web/src/lib/pwa.ts), so
// `pnpm dev` never installs one.

self.addEventListener("install", () => {
  // Take over immediately; there is no cached state worth draining first.
  self.skipWaiting();
});

self.addEventListener("activate", (event) => {
  event.waitUntil(
    (async () => {
      // Belt and braces: if an earlier version of this app ever created caches,
      // drop them, so nobody is served a shell from a previous deploy.
      const keys = await caches.keys();
      await Promise.all(keys.map((k) => caches.delete(k)));
      await self.clients.claim();
    })(),
  );
});

// Present, but never calls respondWith — every request goes to the network and
// the browser's own HTTP cache, governed by the Cache-Control headers Caddy
// sets. Removing this listener would break installability.
self.addEventListener("fetch", () => {});
