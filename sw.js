/*
 * QR照合チェッカー のオフライン用キャッシュ。
 * 一度開けば、以降は圏外・サーバー停止中でも起動できます。
 *
 * アプリを更新したときは、下の VERSION の数字を1つ増やしてください。
 * 各端末は次回起動時に新しい版を取り込みます。
 */
const VERSION = 'qrcheck-v2';
const ASSETS = [
  './',
  './index.html',
  './jsQR.min.js',
  './manifest.webmanifest',
  './icon-192.png',
  './icon-512.png',
  './apple-touch-icon.png',
  './test-qr.html',
  './qrcode.min.js',
  './merge.html',
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(VERSION)
      // 1件でも失敗すると全体が失敗するため、個別に追加する
      .then(c => Promise.all(ASSETS.map(u => c.add(u).catch(() => {}))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(ks => Promise.all(ks.filter(k => k !== VERSION).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', e => {
  if (e.request.method !== 'GET') return;
  e.respondWith(
    caches.match(e.request, { ignoreSearch: true }).then(hit => {
      // キャッシュを即返しつつ、裏で新しい版を取り込む
      const net = fetch(e.request).then(res => {
        if (res && res.ok) {
          const copy = res.clone();
          caches.open(VERSION).then(c => c.put(e.request, copy));
        }
        return res;
      }).catch(() => hit);
      return hit || net;
    })
  );
});
