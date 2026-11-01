// 前沿路线（纯函数）：按关键词把资讯归到路线上，生成进展时间线。
// 路线：{ id, track, title, desc, from, kw: [关键词], status: 'active'|'pending'|'merged', into?, learn: [{id,text,mode,url?}], updated }
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
const cache = new Map();

// 英文关键词按词边界匹配，中文直接包含；以 / 开头的关键词当正则
export function routeRegex(kw) {
  const key = kw.join('\u0001');
  if (cache.has(key)) return cache.get(key);
  const parts = kw.filter(Boolean).map(k => k.startsWith('/') && k.lastIndexOf('/') > 0 ? k.slice(1, k.lastIndexOf('/'))
    : /^[\x00-\x7f]+$/.test(k) ? `(?<![A-Za-z0-9])${escRe(k)}` : escRe(k));
  const re = parts.length ? new RegExp(parts.join('|'), 'i') : null;
  cache.set(key, re);
  return re;
}

// 只匹配本方向的路线；已合并的路线把命中算到合并后的路线上
export function matchRoutes(text, trackIds, routes) {
  const out = new Set();
  for (const r of routes) {
    if (trackIds && !trackIds.includes(r.track)) continue;
    const re = routeRegex(r.kw || []);
    if (re && re.test(text)) out.add(r.status === 'merged' && r.into ? r.into : r.id);
  }
  return [...out];
}

// 给一条资讯算出所属路线：资讯自己写了 r（每周 AI 整理时给定）就用它，否则按关键词
export function tagNews(item, routes) {
  if (Array.isArray(item.r) && item.r.length) return item.r;
  const tracks = Array.isArray(item.k) ? item.k : [item.k];
  return matchRoutes(`${item.t} ${item.s || ''}`, tracks, routes);
}

export function timeline(routeId, news) {
  return news.filter(n => (n.r || []).includes(routeId)).sort((a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0));
}

// 路线有新进展：最近 7 天内有命中的资讯
export function hasNew(routeId, news, today) {
  const cut = new Date(today.getTime() - 7 * 864e5).toISOString().slice(0, 10);
  return news.some(n => (n.r || []).includes(routeId) && n.d >= cut);
}

// 应用个人操作（改名、停止跟踪）后，可见的路线
export function visibleRoutes(routes, mine, trackId) {
  return routes.filter(r => r.track === trackId && r.status !== 'merged')
    .map(r => ({ ...r, title: (mine[r.id] && mine[r.id].name) || r.title, stopped: !!(mine[r.id] && mine[r.id].stopped), follow: !!(mine[r.id] && mine[r.id].follow) }));
}
