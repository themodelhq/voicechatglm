const CACHE = 'voicechatglm-shell-v1.3.2';
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
  if (request.mode === 'navigate') {
    // Navigation is network-first so a deployment cannot be hidden by a stale app shell.
    event.respondWith((async () => {
      try { return await fetch(request); }
      catch { return (await caches.match('/index.html')) || Response.error(); }
    })());
    return;
  }
  event.respondWith((async () => {
    try {
      const response = await fetch(request);
      if (response.ok && ['script', 'style', 'image'].includes(request.destination)) {
        const copy = response.clone(); void caches.open(CACHE).then(cache => cache.put(request, copy));
      }
      return response;
    } catch {
      return (await caches.match(request)) || Response.error();
    }
  })());
});
