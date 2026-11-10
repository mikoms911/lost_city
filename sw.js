// 자동 생성 파일 (scripts/build-offline.js). 직접 고치지 말 것.
'use strict';
const CACHE = 'lost-cities-4f3764125a';
const FILES = ["./","index.html","app.js","style.css","engine.js","manifest.webmanifest","icon-192.png","icon-512.png"];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k.startsWith('lost-cities-') && k !== CACHE).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

async function respond(req) {
  const hit = await caches.match(req, { ignoreSearch: true });
  if (hit) return hit;
  if (req.mode === 'navigate') {
    const page = await caches.match('./index.html');
    if (page) return page;
  }
  return fetch(req);
}

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  e.respondWith(respond(e.request));
});
