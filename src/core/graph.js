// 知识树 A 档（纯函数）：用现有数据现算出关系图，不用 AI，也不加新数据。
// 方向 → 阶段 → 任务 / 资源；前沿路线挂在分出它的阶段上；资讯挂在路线上；笔记挂在阶段或路线上。
// 节点：{ id, label, type: track|stage|item|res|route|news|note, st: done|mastered|now|todo|skip, n 叶子数字, href }
import { stageStatus } from './progress.js';

const cut = (s, n) => { s = String(s || '').replace(/\s+/g, ' ').trim(); return s.length > n ? s.slice(0, n - 1) + '…' : s; };

// track：方向；st：trackState 结果；routes：这个方向的前沿路线；newsOf(rid)；cards：{id: {t, at}}；docs：{阶段 ID: 文本}；done：完成记录
// opts.items 是否画任务和资源节点；opts.news 每条路线最多挂几条资讯
export function buildGraph({ track, st, routes, newsOf, cards = {}, docs = {}, done = {} }, opts = {}) {
  const { items = true, news = 3 } = opts, N = [], E = [];
  const node = x => N.push(x), edge = (s, t, k = '') => E.push({ id: `${s}>${t}`, source: s, target: t, k });
  node({ id: track.id, label: track.name, type: 'track', st: st.doneStages === st.stages.length && st.stages.length ? 'done' : 'now', n: st.stages.length });
  const noteCount = at => Object.values(cards).filter(c => c && c.at === at).length + (docs[at] ? 1 : 0);
  let prev = null;
  for (const s of st.stages) {
    const k = stageStatus(s, st.current), nn = noteCount(s.id);
    node({ id: s.id, label: cut(s.title, 14), type: 'stage', st: k, n: s.prog.n + '/' + s.prog.total, notes: nn, href: `#/t/${track.id}?s=${encodeURIComponent(s.id)}` });
    edge(prev || track.id, s.id, prev ? 'next' : 'has'); prev = s.id;
    if (items) {
      for (const i of s.items) { node({ id: i.id, label: cut(i.text, 22), type: 'item', st: i.skipped ? 'skip' : s.mastered || done[i.id] ? 'done' : 'todo', practice: i.mode === 'practice', full: i.text }); edge(s.id, i.id, 'has'); }
      for (const r of (s.resources || []).slice(0, 8)) { const id = `${s.id}#${r.id || r.name}`; node({ id, label: cut(r.name, 20), type: 'res', st: 'todo', url: r.url || '' }); edge(s.id, id, 'res'); }
    }
    if (nn) { const id = s.id + '#notes'; node({ id, label: `笔记 ${nn}`, type: 'note', st: 'todo', n: nn, href: `#/notes/s/${encodeURIComponent(s.id)}` }); edge(s.id, id, 'note'); }
  }
  const ids = new Set(N.map(x => x.id));
  for (const r of routes) {
    const ns = newsOf(r.id), from = ids.has(r.from) ? r.from : track.id;
    node({ id: r.id, label: cut(r.title, 16), type: 'route', st: r.stopped ? 'skip' : r.follow ? 'now' : 'todo', n: ns.length, href: `#/r/${encodeURIComponent(r.id)}` });
    edge(from, r.id, 'route');
    for (const x of ns.slice(0, news)) { if (ids.has(x.id)) continue; ids.add(x.id); node({ id: x.id, label: cut(x.t, 20), type: 'news', st: 'todo', url: x.u, full: x.t, d: x.d }); edge(r.id, x.id, 'news'); }
    const nn = noteCount(r.id); if (nn) { const id = r.id + '#notes'; node({ id, label: `笔记 ${nn}`, type: 'note', st: 'todo', n: nn, href: `#/notes/s/${encodeURIComponent(r.id)}` }); edge(r.id, id, 'note'); }
  }
  return { nodes: N, edges: E };
}

// 局部图：只留一个节点和它一跳内的邻居（手机和阶段详情用）
export function neighborhood(g, id) {
  const keep = new Set([id]);
  for (const e of g.edges) { if (e.source === id) keep.add(e.target); if (e.target === id) keep.add(e.source); }
  return { nodes: g.nodes.filter(n => keep.has(n.id)), edges: g.edges.filter(e => keep.has(e.source) && keep.has(e.target)) };
}
