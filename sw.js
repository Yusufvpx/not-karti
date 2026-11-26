// Not Kartı servis çalışanı: uygulama dosyalarını internetten taze alır,
// internet yoksa kayıtlı kopyayı kullanır. Kart resimlerini saklar.
const SHELL = 'nk-shell-v1';
const IMAGES = 'nk-images-v1';
const FILES = ['./', 'index.html', 'style.css', 'app.js', 'config.js', 'vendor/supabase.js',
  'manifest.webmanifest', 'icons/icon-192.png', 'icons/icon-512.png', 'icons/apple-touch-icon.png'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(SHELL).then(c => c.addAll(FILES)).then(() => self.skipWaiting()));
});

self.addEventListener('activate', e => {
  e.waitUntil(caches.keys()
    .then(keys => Promise.all(keys.filter(k => k !== SHELL && k !== IMAGES).map(k => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('message', e => { if (e.data === 'skipWaiting') self.skipWaiting(); });

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  // Kart resimleri: önce kayıtlı kopya
  if (url.pathname.includes('/storage/v1/object/public/')) {
    e.respondWith(caches.open(IMAGES).then(async c => {
      const hit = await c.match(req);
      if (hit) return hit;
      const res = await fetch(req);
      if (res.ok) c.put(req, res.clone());
      return res;
    }));
    return;
  }

  // Uygulama dosyaları: önce internet, yoksa kayıtlı kopya
  if (url.origin === self.location.origin) {
    if (url.pathname.endsWith('version.json')) return;
    e.respondWith(fetch(req, { cache: 'no-cache' }).then(res => {
      if (res.ok) { const copy = res.clone(); caches.open(SHELL).then(c => c.put(req, copy)); }
      return res;
    }).catch(async () => (await caches.match(req, { ignoreSearch: true })) ||
      (req.mode === 'navigate' ? caches.match('index.html') : Response.error())));
  }
});
