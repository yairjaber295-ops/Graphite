// Офлайн-кэш приложения: на телефоне редактор открывается и без компа.
// Стратегия «сначала сеть»: если комп доступен — всегда свежая версия, иначе — из кэша.
const CACHE = 'narezchik-v23';

self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    try {
      const list = await (await fetch('precache.json', { cache: 'no-store' })).json();
      // по одному, чтобы одна ошибка не сорвала всё
      for (const f of ['./', ...list]) { try { await cache.add(new Request(f, { cache: 'reload' })); } catch { /* пропускаем */ } }
    } catch { /* без списка — кэшируем по мере использования */ }
    self.skipWaiting();
  })());
});

self.addEventListener('activate', (e) => {
  e.waitUntil((async () => {
    for (const k of await caches.keys()) if (k !== CACHE) await caches.delete(k);
    await self.clients.claim();
  })());
});

self.addEventListener('fetch', (e) => {
  const url = new URL(e.request.url);
  if (e.request.method !== 'GET' || url.origin !== location.origin) return;
  // данные проектов и видео не кэшируем — только само приложение
  if (/^\/(api|files|source)\//.test(url.pathname) || e.request.headers.has('range')) return;
  e.respondWith((async () => {
    try {
      const res = await fetch(e.request);
      if (res.ok) (await caches.open(CACHE)).put(e.request, res.clone());
      return res;
    } catch {
      const hit = await caches.match(e.request, { ignoreSearch: true });
      if (hit) return hit;
      if (e.request.mode === 'navigate') return caches.match('./');
      throw new Error('нет сети');
    }
  })());
});
