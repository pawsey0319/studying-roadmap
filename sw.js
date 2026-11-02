// 离线缓存：网页代码用“缓存优先、后台更新”，数据文件用“网络优先、断网用缓存”。
// 不缓存任何跨站请求（AI 服务商、GitHub、Supabase 等），只缓存本站文件。
const VER = 'lh-v2-5';
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
  const isData = /\/(content|data)\/.*\.json$/.test(url.pathname) || url.pathname.endsWith('config.json');
  if (isData) {
    e.respondWith(fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(VER).then(x => x.put(req, c)); } return r; })
      .catch(() => caches.match(req).then(r => r || new Response('{}', { headers: { 'content-type': 'application/json' } }))));
    return;
  }
  e.respondWith(caches.match(req).then(hit => {
    const net = fetch(req).then(r => { if (r.ok) { const c = r.clone(); caches.open(VER).then(x => x.put(req, c)); } return r; }).catch(() => hit);
    return hit || net;
  }));
});
