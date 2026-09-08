// A minimal, deliberately inert service worker.
//
// Its only job is to exist. Chrome's installability check for firing
// beforeinstallprompt (the event the "Install Discriminantly" button in
// Settings needs, to trigger the browser's native install flow) still looks
// for a registered service worker with a fetch handler, even though a plain
// menu-based install no longer requires one. See:
// https://developer.chrome.com/blog/update-install-criteria
//
// This is not the start of an offline strategy. It does not call
// respondWith(), so it never intercepts, caches, or modifies a single
// request — every request, including authenticated pages, private catalogue
// data, and the MCP endpoint, passes straight through to the network exactly
// as if this file did not exist. Deliberate: caching any of that without a
// real design for it would be a data-exposure risk, not a convenience.

self.addEventListener('install', () => {
  self.skipWaiting();
});

self.addEventListener('activate', (event) => {
  event.waitUntil(self.clients.claim());
});

self.addEventListener('fetch', () => {
  // Intentionally empty. No respondWith — the browser handles every
  // request normally. This listener exists only so the browser sees a
  // fetch handler is registered.
});
