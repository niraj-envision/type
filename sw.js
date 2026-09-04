/* ─────────────────────────────────────────────────────────────────
   sw.js — the service worker: the site works offline and installs
   like an app.

   Strategy: network first, cache as the fallback. There is no build
   step and no version stamp to bump, so the network copy is always the
   truth when there is a network; the cache only ever answers when there
   is not. The fonts are the one exception — their URLs are immutable,
   so they are served from the cache and refreshed in the background.

   The leaderboard API lives on another origin and is never cached.
   ───────────────────────────────────────────────────────────────── */
const CACHE = 'type-shell-v1';
const SHELL = [
  './', './index.html', './css/style.css',
  './js/config.js', './js/words.js', './js/stories.js', './js/replay.js',
  './js/sound.js', './js/leaderboard.js', './js/app.js',
  './manifest.webmanifest', './icons/icon.svg', './icons/icon-192.png', './icons/icon-512.png'
];

self.addEventListener('install', e => {
  e.waitUntil(
    caches.open(CACHE)
      .then(c => Promise.allSettled(SHELL.map(u => c.add(u))))   // one missing icon must not block install
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', e => {
  e.waitUntil(
    caches.keys()
      .then(keys => Promise.all(keys.filter(k => k !== CACHE).map(k => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

const isFont = url => /fonts\.(googleapis|gstatic)\.com/.test(url.host);

self.addEventListener('fetch', e => {
  const req = e.request;
  if (req.method !== 'GET') return;
  const url = new URL(req.url);

  if (isFont(url)) {
    /* stale-while-revalidate: whatever is cached, now; a fresh copy for next time */
    e.respondWith(
      caches.open(CACHE).then(async c => {
        const cached = await c.match(req);
        const fresh = fetch(req).then(res => { if (res.ok || res.type === 'opaque') c.put(req, res.clone()); return res; }).catch(() => null);
        return cached || (await fresh) || Response.error();
      })
    );
    return;
  }

  if (url.origin !== location.origin) return;         // the leaderboard API, or anything else

  e.respondWith(
    fetch(req).then(res => {
      if (res.ok) caches.open(CACHE).then(c => c.put(req, res.clone()));
      return res;
    }).catch(async () => {
      const cached = await caches.match(req, { ignoreSearch: true });
      if (cached) return cached;
      if (req.mode === 'navigate') return (await caches.match('./index.html')) || (await caches.match('./')) || Response.error();
      return Response.error();
    })
  );
});
