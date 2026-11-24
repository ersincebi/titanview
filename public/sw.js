/* TitanView service worker — yalnız uygulama kabuğunu önbelleğe alır.
 * Piyasa verisi (/api, /ws) ASLA önbelleğe alınmaz: eski fiyat göstermek sahte veriyle aynıdır.
 * Çevrimdışıyken kabuk açılır; UI "çevrimdışı" bandını ve açık veri hatasını gösterir. */
const VERSION = 'v1';
const SHELL_CACHE = `titanview-shell-${VERSION}`;
const ASSET_CACHE = `titanview-assets-${VERSION}`;
const PRECACHE = ['/', '/manifest.webmanifest', '/icons/icon-192.png', '/icons/icon-512.png', '/icons/apple-touch-icon.png'];

/** İstek stratejisi: 'bypass' (SW dokunmaz) | 'navigate' | 'asset' | 'static'. */
function decide(method, urlStr, mode, origin) {
  if (method !== 'GET') return 'bypass';
  let u;
  try {
    u = new URL(urlStr);
  } catch (_) {
    return 'bypass';
  }
  if (u.origin !== origin) return 'bypass'; // Google Fonts vb.: tarayıcıya bırak
  if (u.pathname.startsWith('/api/') || u.pathname === '/api' || u.pathname.startsWith('/ws')) return 'bypass';
  if (u.pathname === '/sw.js') return 'bypass';
  if (mode === 'navigate') return 'navigate';
  if (u.pathname.startsWith('/assets/')) return 'asset'; // içerik karmalı → cache-first güvenli
  return 'static';
}

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(SHELL_CACHE)
      .then((c) => c.addAll(PRECACHE))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) =>
        Promise.all(keys.filter((k) => k !== SHELL_CACHE && k !== ASSET_CACHE).map((k) => caches.delete(k)))
      )
      .then(() => self.clients.claim())
  );
});

async function cacheFirst(req) {
  const cache = await caches.open(ASSET_CACHE);
  const hit = await cache.match(req);
  if (hit) return hit;
  const res = await fetch(req);
  if (res.ok) cache.put(req, res.clone());
  return res;
}

async function networkFirstNav(req) {
  const cache = await caches.open(SHELL_CACHE);
  try {
    const res = await fetch(req);
    if (res.ok) cache.put('/', res.clone());
    return res;
  } catch (_) {
    const hit = await cache.match('/');
    if (hit) return hit;
    throw _;
  }
}

async function staleWhileRevalidate(req) {
  const cache = await caches.open(SHELL_CACHE);
  const hit = await cache.match(req);
  const net = fetch(req)
    .then((res) => {
      if (res.ok) cache.put(req, res.clone());
      return res;
    })
    .catch(() => hit);
  return hit || net;
}

self.addEventListener('fetch', (event) => {
  const req = event.request;
  const kind = decide(req.method, req.url, req.mode, self.location.origin);
  if (kind === 'bypass') return;
  if (kind === 'navigate') event.respondWith(networkFirstNav(req));
  else if (kind === 'asset') event.respondWith(cacheFirst(req));
  else event.respondWith(staleWhileRevalidate(req));
});

/** Faz 23: sunucu alarm motorundan Web Push (RFC 8291) — tarayıcı/sekme kapalıyken de bildirim. */
function pushNotification(data) {
  const d = data && typeof data === 'object' ? data : {};
  const title = typeof d.title === 'string' && d.title ? d.title : 'TitanView alarmı';
  return {
    title,
    options: {
      body: typeof d.body === 'string' ? d.body : '',
      tag: typeof d.tag === 'string' ? d.tag : 'titan-alert',
      renotify: true,
      requireInteraction: true,
      icon: '/icons/icon-192.png',
      badge: '/icons/icon-192.png',
      timestamp: typeof d.time === 'number' ? d.time : Date.now(),
      data: { symbol: typeof d.symbol === 'string' ? d.symbol : '', alertId: d.alertId || '' },
    },
  };
}

self.addEventListener('push', (event) => {
  let data = {};
  try {
    data = event.data ? event.data.json() : {};
  } catch (_) {
    data = { body: event.data ? event.data.text() : '' };
  }
  const n = pushNotification(data);
  event.waitUntil(self.registration.showNotification(n.title, n.options));
});

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  const sym = event.notification.data && event.notification.data.symbol;
  const target = sym ? `/?symbol=${encodeURIComponent(sym)}` : '/';
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) {
        if ('focus' in c) {
          if (sym && 'postMessage' in c) c.postMessage({ type: 'titan-alert-open', symbol: sym });
          return c.focus();
        }
      }
      return self.clients.openWindow(target);
    })
  );
});

self.addEventListener('message', (event) => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// test için
self.__titanSw = { decide, PRECACHE, SHELL_CACHE, ASSET_CACHE, pushNotification };
