// RentalIQ Service Worker - App Shell Cache
// Strategy: cache-first for static assets, network-first for API and pages

const CACHE_NAME  = 'rentaliq-shell-v2';
const OFFLINE_URL = '/';

// Static assets to precache - Next.js _next/static is handled dynamically
const PRECACHE_URLS = [
  '/',
  '/scout',
  // Note: manifest.json/icons excluded - can return 401 on Vercel preview deployments
];

// -- Install: precache app shell ----------------------------------------------
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE_NAME).then(cache =>
      cache.addAll(PRECACHE_URLS).catch(err => {
        // Non-fatal: precache may fail for pages that need auth
        console.warn('[SW] Precache partial failure:', err.message);
      })
    ).then(() => self.skipWaiting())
  );
});

// -- Activate: clean up old caches ---------------------------------------------
self.addEventListener('activate', event => {
  event.waitUntil(
    caches.keys().then(keys =>
      Promise.all(
        keys
          .filter(k => k !== CACHE_NAME)
          .map(k => caches.delete(k))
      )
    ).then(() => self.clients.claim())
  );
});

// -- Fetch: routing strategy ---------------------------------------------------
self.addEventListener('fetch', event => {
  const { request } = event;
  const url = new URL(request.url);

  // Skip non-GET and cross-origin requests
  if (request.method !== 'GET') return;
  if (url.origin !== self.location.origin) return;

  // API routes - always network, never cache
  if (url.pathname.startsWith('/api/')) return;

  // Next.js static assets (_next/static) - cache first, very long TTL
  if (url.pathname.startsWith('/_next/static/')) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // Static public files (icons, manifest, robots)
  if (url.pathname.match(/\.(png|svg|ico|json|txt|webp)$/)) {
    event.respondWith(
      caches.open(CACHE_NAME).then(cache =>
        cache.match(request).then(cached => {
          if (cached) return cached;
          return fetch(request).then(response => {
            if (response.ok) cache.put(request, response.clone());
            return response;
          });
        })
      )
    );
    return;
  }

  // HTML pages - network first, fall back to cache, then offline shell
  event.respondWith(
    fetch(request)
      .then(response => {
        // Cache successful HTML responses - clone BEFORE returning to avoid "body used" error
        if (response.ok && response.headers.get('content-type')?.includes('text/html')) {
          const toCache = response.clone();
          caches.open(CACHE_NAME).then(cache => cache.put(request, toCache));
        }
        return response;
      })
      .catch(async () => {
        // Network failed - serve from cache or offline shell
        const cached = await caches.match(request);
        if (cached) return cached;
        // Fall back to the homepage shell (still shows the UI)
        const shell = await caches.match(OFFLINE_URL);
        if (shell) return shell;
        // Last resort
        return new Response(
          '<html><body><h2>RentalIQ</h2><p>You appear to be offline. Please check your connection.</p></body></html>',
          { headers: { 'content-type': 'text/html' } }
        );
      })
  );
});
