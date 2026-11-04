// 離線快取：安裝時一次把整組檔案抓齊，之後都從手機上的版本開啟。
// 有新版本時（改了這個檔的版本號），背景下載整組新檔，下次開啟才換，不會新舊混用。
const V = 'daigou-1.2.0';
const FILES = ['./', './index.html', './app.js', './cards.js', './manifest.webmanifest', './icon-180.png', './icon-192.png', './icon-512.png'];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(V)
      .then(c => Promise.all(FILES.map(f => fetch(new Request(f, { cache: 'reload' })).then(r => { if (!r.ok) throw new Error(f); return c.put(f, r); }))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== V).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  const r = e.request;
  if (r.method !== 'GET') return;
  if (new URL(r.url).origin !== location.origin) return; // 匯率 API 等外部請求不經過快取
  e.respondWith(
    caches.match(r, { ignoreSearch: true }).then(hit => hit || fetch(r).catch(() => caches.match('./index.html')))
  );
});
