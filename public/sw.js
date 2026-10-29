const CACHE = 'voicechatglm-shell-v1.3.0';
const SHELL = ['/', '/index.html', '/manifest.webmanifest', '/icons/icon.svg', '/icons/icon-192.png', '/icons/icon-512.png'];
self.addEventListener('install', event => { event.waitUntil(caches.open(CACHE).then(cache => cache.addAll(SHELL)).then(() => self.skipWaiting())); });
self.addEventListener('activate', event => { event.waitUntil(caches.keys().then(keys => Promise.all(keys.filter(key => key !== CACHE).map(key => caches.delete(key)))).then(() => self.clients.claim())); });
self.addEventListener('fetch', event => {
  const request = event.request;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  // Never cache API traffic or credentials/private conversation payloads.
  if (url.pathname.startsWith('/api/')) return;
  if (url.origin !== self.location.origin) return;
  event.respondWith(caches.match(request).then(cached => cached || fetch(request).then(response => {
    if (response.ok && (request.destination === 'script' || request.destination === 'style' || request.destination === 'document' || request.destination === 'image')) {
      const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(request, copy));
    }
    return response;
  }).catch(() => request.mode === 'navigate' ? caches.match('/index.html') : undefined)));
});
