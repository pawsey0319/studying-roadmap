// 相关内容（纯函数）：读一篇资讯时，从全部资讯、论文、笔记和学习阶段里找出“接着读什么”。
// 不用 AI，按下面几样打分，并给出理由：
//   同一件事：标题高度相似、日期相差 3 天内 → “同一件事的其他报道”
//   同一条前沿路线 → “都属于前沿路线：…”
//   共同的关键词（按稀有程度加权，常见词不算）→ “都讲到 MCP、A2A”
//   论文、一手来源排在“更深入”里
const STOP = new Set('the and for with from that this your you are was were has have will into about over after more than what when how why new its our their via using use based towards toward can not but all one two out now just also make makes made get gets via'.split(' '));
const CJK = /[㐀-鿿]/;
const NOISE = /^(发布|宣布|推出|上线|正式|全新|最新|如何|什么|我们|他们|一个|这个|已经|可以|进行|通过|以及|因为|所以|没有|就是|还是|不是|报告|消息|公司|今天|今年|月日)$/;

export function tokens(text) {
  const s = String(text || ''), out = new Set();
  for (const w of s.match(/[A-Za-z][A-Za-z0-9.+\-]{1,30}/g) || []) {
    const k = w.toLowerCase().replace(/[.\-]+$/, '');
    if (k.length >= 3 && !STOP.has(k)) out.add(k);
    else if (k.length === 2 && /^[A-Z0-9]{2}$/.test(w)) out.add(k);   // 两个字母的缩写：AI、RL
  }
  for (const run of s.match(/[㐀-鿿]+/g) || []) for (let i = 0; i < run.length - 1; i++) { const g = run.slice(i, i + 2); if (!NOISE.test(g)) out.add(g); }
  return out;
}

// pool：[{id, t, s, d, r[], k[], lvl, type, src}]；返回一个可以反复查询的索引
export function buildIndex(pool) {
  const docs = pool.map(x => ({ x, tk: tokens(`${x.t} ${x.t} ${x.s || ''}`), tt: tokens(x.t) }));
  const df = new Map();
  for (const d of docs) for (const w of d.tk) df.set(w, (df.get(w) || 0) + 1);
  const N = docs.length || 1;
  const idf = w => { const n = df.get(w) || 0; return n <= 1 ? 0 : Math.log(N / n); };   // 只出现一次的词说明不了关联
  for (const d of docs) d.norm = Math.sqrt([...d.tk].reduce((a, w) => a + idf(w) ** 2, 0)) || 1;
  return { docs, idf, byId: new Map(docs.map(d => [d.x.id, d])) };
}

// 理由里显示的词：英文词原样；中文从标题里取两边都出现的最长片段（如“工具调用”），不显示“具调”这种半截词
export function sharedPhrases(title, other, idf) {
  const o = String(other || '').toLowerCase(), out = [];
  for (const w of String(title).match(/[A-Za-z][A-Za-z0-9.+\-]{1,30}/g) || []) { const k = w.toLowerCase().replace(/[.\-]+$/, ''); if ((k.length >= 3 && !STOP.has(k) || /^[A-Z0-9]{2}$/.test(w)) && new RegExp('(^|[^a-z0-9])' + k.replace(/[.+]/g, '\\$&') + '($|[^a-z0-9])').test(o) && idf(k) > 1) out.push(w); }
  for (const run of String(title).match(/[㐀-鿿]+/g) || []) {
    let i = 0;
    while (i < run.length - 1) {
      let L = 1; while (i + L < run.length && o.includes(run.slice(i, i + L + 1))) L++;
      const ph = run.slice(i, i + L);
      if (L >= 3 || (L === 2 && !NOISE.test(ph) && idf(ph) > 2)) out.push(ph);
      i += Math.max(L, 1);
    }
  }
  return [...new Set(out)].sort((a, b) => b.length - a.length);
}
const days = (a, b) => (a && b ? Math.abs(new Date(a) - new Date(b)) / 864e5 : 99);
const jacc = (A, B) => { if (!A.size || !B.size) return 0; let n = 0; for (const w of A) if (B.has(w)) n++; return n / (A.size + B.size - n); };
export const isDeep = x => x.type === 'paper' || /arxiv|论文|Papers/i.test(x.src || '') || x.lvl === 'A';

// 给一条资讯找相关内容。routeName(id) 用来写理由。返回 [{x, score, why, group: same|deep|more}]
export function relatedTo(index, item, { routeName = id => id, limit = 8 } = {}) {
  const me = index.byId.get(item.id) || { x: item, tk: tokens(`${item.t} ${item.t} ${item.s || ''}`), tt: tokens(item.t) };
  if (!me.norm) me.norm = Math.sqrt([...me.tk].reduce((a, w) => a + index.idf(w) ** 2, 0)) || 1;
  const myR = new Set(item.r || []), out = [];
  for (const d of index.docs) {
    if (d.x.id === item.id || d.x.u === item.u) continue;
    const shared = [...me.tk].filter(w => d.tk.has(w));
    let cos = shared.reduce((a, w) => a + index.idf(w) ** 2, 0) / (me.norm * d.norm);
    const sameR = (d.x.r || []).filter(r => myR.has(r));
    const tj = jacc(me.tt, d.tt), near = days(item.d, d.x.d);
    const same = tj >= 0.3 && near <= 3;
    let score = cos + (sameR.length ? 0.25 : 0) + (same ? 0.5 : 0) + ((d.x.k || []).some(k => (item.k || []).includes(k)) ? 0.03 : 0) - Math.min(near, 60) / 600;
    const words = sharedPhrases(item.t, `${d.x.t} ${d.x.s || ''}`, index.idf).slice(0, 3);
    // 没有同一路线时，至少要有一个说得出口的共同词（英文词或三个字以上的中文片段），否则只是零散字面重合
    if (score < 0.12 || (!sameR.length && !same && (cos < 0.1 || !words.length))) continue;
    const why = same ? '同一件事的其他报道' : sameR.length ? `都属于前沿路线：${routeName(sameR[0])}` : words.length ? `都讲到 ${words.join('、')}` : '内容相近';
    out.push({ x: d.x, score: +score.toFixed(3), why, group: same ? 'same' : isDeep(d.x) ? 'deep' : 'more' });
  }
  out.sort((a, b) => b.score - a.score);
  // 同一件事最多 3 条，避免一屏全是同一新闻的转载
  const res = [], n = { same: 0 };
  for (const o of out) { if (o.group === 'same' && n.same >= 3) continue; if (o.group === 'same') n.same++; res.push(o); if (res.length >= limit) break; }
  return res;
}

// 相关的笔记和学习阶段。notes：[{id, t, at}]；stages：[{id, title, text, routes[]}]
export function relatedMine(item, { notes = [], stages = [] }, idf = () => 1) {
  const me = tokens(`${item.t} ${item.s || ''}`), myR = new Set(item.r || []);
  const sc = tk => [...me].filter(w => tk.has(w)).reduce((a, w) => a + Math.max(idf(w), 0.5), 0);
  const ns = notes.map(n => ({ n, s: sc(tokens(n.t)) + (n.at && myR.has(n.at) ? 2 : 0) })).filter(o => o.s >= 2).sort((a, b) => b.s - a.s).slice(0, 4).map(o => o.n);
  const ss = stages.map(s => ({ s, v: sc(tokens(s.title + ' ' + s.text)) + ((s.routes || []).some(r => myR.has(r)) ? 3 : 0) })).filter(o => o.v >= 2.5).sort((a, b) => b.v - a.v).slice(0, 3).map(o => o.s);
  return { notes: ns, stages: ss };
}
