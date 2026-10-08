/* Lyrics Video Studio service worker.
 *
 * Conservative by design. An SW that mis-caches is worse than none: a user
 * stuck on a stale build is exactly how a local-only editor loses trust. So:
 *
 *  - Navigations are NETWORK-FIRST with the cache as an offline fallback only.
 *    A fresh build always wins on the next load; the cache is never ahead of
 *    the server.
 *  - Only same-origin, hashed, immutable assets are cached (stale-while-revalidate).
 *  - /api, /models and any cross-origin request is never cached by this service worker.
 *    The model workers manage their own consent-aware Cache Storage entries.
 *  - On activate, every obsolete app cache is deleted, so deploys cannot strand users.
 */

const VERSION = 'vidlyrics-v1';
const STATIC = `${VERSION}-static`;
const NAV = `${VERSION}-nav`;
const WHISPER_MODELS = 'vidlyrics-whisper-models-v1';

self.addEventListener('install', (event) => {
  event.waitUntil(self.skipWaiting());
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    (async () => {
      const keys = await caches.keys();
      // The user-approved Whisper model cache is versioned independently from
      // the app shell. Keep it across releases so an old local copy remains
      // available until the user approves its replacement.
      await Promise.all(keys.filter((k) => k !== STATIC && k !== NAV && k !== WHISPER_MODELS).map((k) => caches.delete(k)));
      await self.clients.claim();
    })()
  );
});

function isCachableAsset(url) {
  if (url.origin !== self.location.origin) return false;
  if (url.pathname.startsWith('/api') || url.pathname.startsWith('/models')) return false;
  // Hashed build assets are immutable and safe to cache.
  if (url.pathname.startsWith('/assets/')) return true;
  // The manifest and icons change rarely and are version-tolerant.
  return ['/manifest.webmanifest', '/icon-192.png', '/favicon.svg', '/og.png'].includes(url.pathname);
}

self.addEventListener('fetch', (event) => {
  const request = event.request;
  if (request.method !== 'GET') return;

  const url = new URL(request.url);

  // Navigations: network first, cache as offline fallback.
  if (request.mode === 'navigate') {
    event.respondWith(
      (async () => {
        try {
          const response = await fetch(request);
          const cache = await caches.open(NAV);
          cache.put(request, response.clone());
          return response;
        } catch {
          const cached = await caches.match(request, { ignoreSearch: true });
          return cached ?? Response.error();
        }
      })()
    );
    return;
  }

  // Hashed assets and icons: stale-while-revalidate.
  if (isCachableAsset(url)) {
    event.respondWith(
      (async () => {
        const cache = await caches.open(STATIC);
        const cached = await cache.match(request);
        const network = fetch(request)
          .then((response) => {
            if (response && response.ok) cache.put(request, response.clone());
            return response;
          })
          .catch(() => undefined);
        return cached ?? (await network) ?? Response.error();
      })()
    );
  }
});
