// خدمة العمل بدون اتصال لدكان الحي: الصفحات والملفات تُجلب من الشبكة أولًا (فيوصل أي تحديث مباشرة)،
// وإذا الاتصال ضعيف أو مقطوع نفتح آخر نسخة محفوظة. بيانات المتاجر نفسها (Supabase) والخرائط لا تُحفظ هنا أبدًا.
const VERSION = 'dukkan-v1';
const SHELL = `${VERSION}-shell`;
const CDN = `${VERSION}-cdn`;
const NETWORK_TIMEOUT = 4000;
const CDN_HOSTS = new Set(['unpkg.com', 'fonts.googleapis.com', 'fonts.gstatic.com', 'cdn.jsdelivr.net']);

self.addEventListener('install', event => {
  event.waitUntil(caches.open(SHELL).then(c => c.addAll(['./', 'assets/img/icon-192.png'])).then(() => self.skipWaiting()));
});

self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (!key.startsWith(VERSION)) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

async function networkFirst(request, cacheName, fallbackUrl) {
  const cache = await caches.open(cacheName);
  try {
    const response = await Promise.race([
      fetch(request),
      new Promise((_, reject) => setTimeout(() => reject(new Error('timeout')), NETWORK_TIMEOUT)),
    ]);
    if (response.ok) cache.put(request, response.clone());
    return response;
  } catch {
    return (await cache.match(request)) || (fallbackUrl && (await cache.match(fallbackUrl))) || Response.error();
  }
}

async function staleWhileRevalidate(request) {
  const cache = await caches.open(CDN);
  const cached = await cache.match(request);
  const update = fetch(request).then(res => {
    if (res.ok) cache.put(request, res.clone());
    return res;
  }).catch(() => cached);
  return cached || update;
}

self.addEventListener('fetch', event => {
  const { request } = event;
  if (request.method !== 'GET') return;
  const url = new URL(request.url);
  if (url.origin === self.location.origin) {
    if (url.pathname === '/sw.js') return;
    event.respondWith(networkFirst(request, SHELL, request.mode === 'navigate' ? './' : null));
  } else if (CDN_HOSTS.has(url.hostname)) {
    event.respondWith(staleWhileRevalidate(request));
  }
  // غير ذلك (Supabase، مربعات الخرائط، البحث عن الأماكن): يمر مباشرة للشبكة بدون حفظ
});
