/**
 * Service Worker – Offline-Caching für die Familienzentrale.
 *
 * Strategie:
 *  - App-Shell wird bei der Installation vorab gecacht (VERSION erhöhen → Update).
 *  - Navigationen: Network-first, offline Fallback auf index.html.
 *  - Eigene statische Dateien: Stale-while-revalidate.
 *  - Fremde Origins (Apps Script, Google) werden nicht angefasst – die App
 *    speichert ihre Daten selbst in localStorage (offline-first).
 */
const VERSION = 'v1.1.1';
const CACHE = `familienzentrale-${VERSION}`;
// Google Fonts (Bitter, Source Sans 3) bleiben versionsunabhängig im Cache → auch offline schön
const FONT_CACHE = 'familienzentrale-fonts';
const FONT_HOSTS = ['fonts.googleapis.com', 'fonts.gstatic.com'];

const SHELL = [
  './',
  'index.html',
  'manifest.json',
  'css/style.css',
  'js/app.js',
  'js/api.js',
  'js/calendar.js',
  'js/config.js',
  'js/mock-data.js',
  'js/reminders.js',
  'js/store.js',
  'js/ui.js',
  'icons/icon.svg',
  'icons/icon-192.png',
  'icons/icon-512.png',
  'icons/maskable-512.png',
  'icons/badge-96.png',
];

self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(SHELL.map(url => new Request(url, { cache: 'reload' })))),
  );
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    const keys = await caches.keys();
    await Promise.all(keys.filter(k => k.startsWith('familienzentrale-') && k !== CACHE && k !== FONT_CACHE).map(k => caches.delete(k)));
    await self.clients.claim();
  })());
});

// Die App fragt nach, bevor ein Update aktiviert wird (Toast „Aktualisieren“).
self.addEventListener('message', event => {
  if (event.data?.type === 'SKIP_WAITING') self.skipWaiting();
});

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (FONT_HOSTS.includes(url.hostname)) {
    event.respondWith(cacheFirst(request, FONT_CACHE));
    return;
  }
  if (url.origin !== self.location.origin) return;

  if (request.mode === 'navigate') {
    event.respondWith(networkFirst(request));
    return;
  }
  event.respondWith(staleWhileRevalidate(request, event));
});

async function networkFirst(request) {
  const cache = await caches.open(CACHE);
  try {
    const response = await fetch(request);
    if (response.ok) cache.put(new URL('index.html', self.registration.scope).href, response.clone());
    return response;
  } catch {
    return (await cache.match(new URL('index.html', self.registration.scope).href))
      || (await cache.match(self.registration.scope))
      || new Response('Offline', { status: 503, headers: { 'Content-Type': 'text/plain; charset=utf-8' } });
  }
}

async function cacheFirst(request, cacheName) {
  const cache = await caches.open(cacheName);
  const cached = await cache.match(request);
  if (cached) return cached;
  try {
    const response = await fetch(request);
    if (response.ok || response.type === 'opaque') cache.put(request, response.clone());
    return response;
  } catch {
    return Response.error();
  }
}

async function staleWhileRevalidate(request, event) {
  const cache = await caches.open(CACHE);
  const cached = await cache.match(request, { ignoreSearch: true });
  const network = fetch(request)
    .then(response => {
      if (response.ok) cache.put(request, response.clone());
      return response;
    })
    .catch(() => cached || Response.error());
  if (cached) {
    event.waitUntil(network);
    return cached;
  }
  return network;
}

/* ---------- Benachrichtigungen ---------- */

self.addEventListener('notificationclick', event => {
  event.notification.close();
  const target = new URL(event.notification.data?.url || './', self.registration.scope).href;
  event.waitUntil((async () => {
    const windows = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    const existing = windows.find(c => c.url.startsWith(self.registration.scope));
    if (existing) return existing.focus();
    return self.clients.openWindow(target);
  })());
});

// Vorbereitet für echte Web-Push-Nachrichten (benötigt einen Push-Server, siehe README).
self.addEventListener('push', event => {
  let data = {};
  try { data = event.data?.json() ?? {}; } catch { data = { body: event.data?.text() }; }
  event.waitUntil(self.registration.showNotification(data.title || 'Familienzentrale', {
    body: data.body || '',
    icon: 'icons/icon-192.png',
    badge: 'icons/badge-96.png',
    data: { url: data.url || './#home' },
  }));
});
