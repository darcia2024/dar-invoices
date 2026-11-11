// DAR Invoices service worker: makes the dashboard open instantly from the Home Screen and
// still show the last loaded version when offline. Only the dashboard and its own assets are
// handled; client invoice pages and /api are always left to the network.
const VERSION = 'dar-pwa-v1';
const SHELL_CACHE = `${VERSION}-shell`;
const ASSET_CACHE = `${VERSION}-assets`;

const PRECACHE = [
  '/dashboard.css',
  '/invoice-manager.js',
  '/manifest.webmanifest',
  '/brand/dar-mascot-128.png',
  '/brand/dar-mascot-fab.png',
  '/brand/icon-192.png',
  '/brand/apple-touch-icon.png',
];

const DASHBOARD_PAGES = new Set(['/', '/index', '/index.html', '/admin-login']);
const ASSET_PREFIXES = ['/brand/', '/bank-logos/'];
const ASSET_FILES = new Set(['/dashboard.css', '/invoice-manager.js', '/manifest.webmanifest']);
const FONT_HOSTS = new Set(['fonts.googleapis.com', 'fonts.gstatic.com']);

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(ASSET_CACHE)
      .then((cache) => cache.addAll(PRECACHE))
      .catch(() => {})
      .then(() => self.skipWaiting()),
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => !k.startsWith(VERSION)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim()),
  );
});

// The dashboard asks for this on "Kunci" so no copy of the financial page stays on the device.
self.addEventListener('message', (event) => {
  if (event.data === 'clear-dashboard-cache') {
    event.waitUntil(caches.delete(SHELL_CACHE));
  }
});

// Phone notifications (api/cron-reminders.js, api/push.js): { title, body, url, tag }.
self.addEventListener('push', (event) => {
  let message = {};
  try { message = event.data ? event.data.json() : {}; } catch (e) { message = { body: event.data ? event.data.text() : '' }; }
  event.waitUntil(self.registration.showNotification(message.title || 'Pengingat', {
    body: message.body || 'Ada talangan yang jatuh tempo. Buka aplikasinya.',
    icon: '/brand/icon-192.png',
    badge: '/brand/icon-192.png',
    tag: message.tag || 'dar-reminder',
    renotify: true,
    data: { url: message.url || '/' },
  }));
});

// Tapping the notification opens (or focuses) the account it is about.
self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const url = new URL((event.notification.data && event.notification.data.url) || '/', self.location.origin).href;
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((windows) => {
      const open = windows.find((w) => w.url.split('?')[0] === url);
      return open ? open.focus() : self.clients.openWindow(url);
    }),
  );
});

self.addEventListener('fetch', (event) => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);

  if (FONT_HOSTS.has(url.hostname)) {
    event.respondWith(cacheFirst(request, ASSET_CACHE));
    return;
  }
  if (url.origin !== self.location.origin || url.pathname.startsWith('/api/')) return;

  if (request.mode === 'navigate' && DASHBOARD_PAGES.has(url.pathname)) {
    event.respondWith(networkFirstPage(request));
    return;
  }
  // Code changes often: always try the network first so a new deploy shows up immediately.
  if (ASSET_FILES.has(url.pathname)) {
    event.respondWith(networkFirst(request, ASSET_CACHE));
    return;
  }
  if (ASSET_PREFIXES.some((p) => url.pathname.startsWith(p))) {
    event.respondWith(staleWhileRevalidate(request, ASSET_CACHE));
  }
});

async function networkFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match(request, { ignoreSearch: true });
    if (cached) return cached;
    throw error;
  }
}

async function networkFirstPage(request) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put('/', response.clone());
    return response;
  } catch (error) {
    const cached = await cache.match('/');
    if (cached) return cached;
    return new Response(
      '<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">' +
      '<body style="font-family:-apple-system,sans-serif;background:#f1eddf;color:#272722;display:grid;place-items:center;min-height:100vh;margin:0;text-align:center;padding:24px">' +
      '<div><h2>Lagi offline</h2><p>Sambungkan internet, lalu buka lagi DAR.</p></div>',
      { headers: { 'Content-Type': 'text/html; charset=utf-8' } },
    );
  }
}

async function staleWhileRevalidate(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  const network = fetch(request)
    .then((response) => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached);
  return cached || network;
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  const response = await fetch(request);
  if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
  return response;
}
