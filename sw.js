// 离线缓存：本站文件一律“网络优先、断网用缓存”，这样每次发布后打开就是新版本，断网时仍能打开看过的页面。
// 不缓存任何跨站请求（AI 服务商、GitHub、Supabase 等），只缓存本站文件。
const VER = 'lh-v3-10';
const SHELL = ['./', 'index.html', 'manifest.webmanifest', 'icons/icon.svg', 'icons/icon-192.png',
  'src/css/base.css', 'src/css/pages.css', 'src/css/shell.css'];

self.addEventListener('install', e => {
  e.waitUntil(caches.open(VER).then(c => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', e => {
  e.waitUntil(caches.keys().then(ks => Promise.all(ks.filter(k => k !== VER).map(k => caches.delete(k)))).then(() => self.clients.claim()));
});
self.addEventListener('fetch', e => {
  const req = e.request, url = new URL(req.url);
  if (req.method !== 'GET' || url.origin !== location.origin) return;
  e.respondWith(fetch(req, { cache: 'no-cache' }).then(r => {
    if (r.ok) { const c = r.clone(); caches.open(VER).then(x => x.put(req, c)); }
    return r;
  }).catch(() => caches.match(req).then(r => r || (/\.json$/.test(url.pathname)
    ? new Response('{}', { headers: { 'content-type': 'application/json' } })
    : new Response('离线，且这个文件没有缓存过', { status: 503 })))));
});
