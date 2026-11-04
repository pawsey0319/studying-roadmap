// 运行时数据模型：把公共内容、个人层、已读状态组合成界面直接用的结构。
// 所有页面都从这里取数据，不直接拼 content 和 store。
import * as store from './store/index.js';
import { trackState } from './core/progress.js';
import { newsId } from './core/ids.js';
import { tagNews, visibleRoutes, hasNew } from './core/routes.js';
import { byDateDesc } from './core/feed.js';

export let C = null;        // 公共内容（content.js 读取的结果）
export const today = (() => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; })();
const cache = {};
export const invalidate = () => { for (const k in cache) delete cache[k]; };

export function setContent(c) { C = c; invalidate(); }

/* ---------- 方向（板块） ---------- */
// 公共方向 + 用户导入的方向；“ext.<方向>”是导入后追加到公共方向末尾的阶段
export function tracks() {
  if (cache.tracks) return cache.tracks;
  const mine = store.all('tracks'), use = new Set(store.adopted());
  const pub = C.tracks.filter(t => use.has(t.id)).map(t => {
    const ext = mine['ext.' + t.id];
    return ext && ext.stages && ext.stages.length ? { ...t, stages: t.stages.concat(ext.stages.map(s => ({ ...s, imported: true }))) } : t;
  });
  const own = Object.entries(mine).filter(([k]) => k.startsWith('u')).map(([, t]) => ({ ...t, mine: true }));
  const hidden = store.ui().hiddenTracks || {};
  return (cache.tracks = pub.concat(own).filter(t => !hidden[t.id]));
}
export const track = id => tracks().find(t => t.id === id);
// 路线库：所有公共方向（不管有没有采用）
export const library = () => C.tracks;
export const adopted = id => store.adopted().includes(id);
export function state(trackId) {
  const k = 'st.' + trackId;
  if (cache[k]) return cache[k];
  return (cache[k] = trackState(track(trackId), store.all('overlay'), store.done()));
}
export function findStage(stageId) {
  for (const t of tracks()) { const s = state(t.id).stages.find(x => x.id === stageId); if (s) return { t, s }; }
  return null;
}

/* ---------- 前沿路线 ---------- */
export function routes(trackId) {
  const mine = store.all('routes');
  const all = C.routes.routes.map(r => (mine[r.id] && mine[r.id].learnAdd) ? { ...r, learn: (r.learn || []).concat(mine[r.id].learnAdd) } : r);
  return trackId ? visibleRoutes(all, mine, trackId) : all.filter(r => r.status === 'active' || !r.status);
}
export const route = id => C.routes.routes.find(r => r.id === id);
export function routeName(id) {
  const mine = store.get('routes', id), r = route(id);
  return (mine && mine.name) || (r && r.title) || id;
}

/* ---------- 资讯 ---------- */
// 统一成一个列表：精选（curated）+ 每日快照（snap，含官方、媒体、日报、社区）
export function news() {
  if (cache.news) return cache.news;
  const R = C.routes.routes;
  const curated = C.feed.items.map(x => ({ ...x, kind: 'curated', k: [x.k] }));
  const cloudNews = (C.cloudNews || []).map(x => ({ ...x, s: x.s || undefined, via: x.via || undefined }));
  const snap = [...((C.community && C.community.items) || []), ...cloudNews, ...((C.sources && C.sources.items) || [])].map(x => ({ ...x, kind: 'snap' }));
  const seen = new Set(), out = [];
  for (const x of [...curated, ...snap]) {
    const id = newsId(x.u);
    if (seen.has(id)) continue;
    seen.add(id);
    const r = tagNews(x, R);
    out.push({ ...x, id, r, rAuto: !(Array.isArray(x.r) && x.r.length) });
  }
  out.sort(byDateDesc);
  return (cache.news = out);
}
export const isRead = id => !!store.get('read', id);
export const isHidden = id => store.get('marks', id) === 'drop';
// 当前在学阶段相关：资讯所属的前沿路线是从这个方向的当前阶段分出来的
export function related(n) {
  return n.r.some(rid => {
    const r = route(rid); if (!r) return false;
    const st = track(r.track) ? state(r.track) : null;
    return st && st.current === r.from;
  });
}
// 未读只统计最近 30 天：更早的资讯默认归档，不再提醒（仍然可以在资讯动态里看到）
// 第一次打开时，7 天以前的资讯都算已读（readBase），免得一上来就有几百条未读
export const isFresh = n => { const base = store.ui().readBase || ''; return n.d && n.d.length === 10 && n.d >= base && (today - new Date(n.d + 'T00:00:00')) / 864e5 <= 30; };
export function unread(trackId) {
  const mine = new Set(tracks().map(t => t.id));
  return news().filter(n => isFresh(n) && !isRead(n.id) && !isHidden(n.id) && (trackId ? n.k.includes(trackId) : n.k.some(k => mine.has(k))));
}
export const routeHasNew = rid => hasNew(rid, news(), today);
export const routeNews = rid => news().filter(n => n.r.includes(rid));

/* ---------- 在学 ---------- */
// 每个方向的当前理论阶段 + 你点了“跟踪学习”的前沿路线
export function doing() {
  const out = [];
  for (const t of tracks()) {
    const st = state(t.id);
    const s = st.stages.find(x => x.id === st.current);
    if (s) out.push({ kind: 'stage', t, s, idx: st.stages.indexOf(s) + 1 });
    for (const r of routes(t.id)) if (r.follow && !r.stopped) out.push({ kind: 'route', t, r });
  }
  return out;
}
