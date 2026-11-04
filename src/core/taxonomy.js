// 知识树（纯函数）：领域 → 方向 → 子方向 → 更细的子方向……
// 前两层来自 content/taxonomy.json（预置，人工整理）；再往下由你点“扩散”时让 AI 生成，确认后存进个人数据（文档 tree）。
// 资讯、论文、笔记按关键词、前沿路线、学习阶段挂到节点上；父节点包含子节点的全部内容。

// 关键词 → 正则：英文前面要有词边界（"MoE" 不匹配 "smoke"）；中文直接包含
const escRe = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
export function kwRegex(kw) {
  const parts = (kw || []).map(k => String(k).trim()).filter(Boolean).map(k => {
    if (/[㐀-鿿]/.test(k)) return escRe(k);
    // 只有全小写、5 个字母以上的词干（quantiz、distill、fine-tun）按前缀匹配；ReAct、MCP 这类专名要整词匹配（ReAct 不匹配 reaction）
    const tail = /^[a-z][a-z\-]{4,}$/.test(k) ? '' : '(?![A-Za-z0-9])';
    return '(?<![A-Za-z0-9])' + escRe(k) + tail;
  });
  return parts.length ? new RegExp(parts.join('|'), 'i') : null;
}

// 拼出一棵树。tax：taxonomy.json；tracks：[{id,name,en?}]；mine：个人数据 tree 文档 {父节点 ID: {kids:[{k,name,en,kw}]}}
// 返回 { root, byId }；节点 {id, name, en, kw, s[], r[], kids[], depth, parent, preset, ai}
export function buildTree({ tax, tracks, mine = {}, root = 'domain', domainName = '全部方向' }) {
  const byId = new Map();
  const mk = (x, parent, depth, preset) => {
    const n = { id: x.id, name: x.name, en: x.en || '', kw: x.kw || [], s: x.s || [], r: x.r || [], kids: [], depth, parent, preset, ai: !!x.ai };
    byId.set(n.id, n);
    const kids = (x.kids || []).concat(((mine[n.id] || {}).kids || []).map(k => ({ ...k, id: n.id + '.' + k.k, ai: true })));
    n.kids = kids.map(k => mk(k, n.id, depth + 1, preset && !k.ai));
    return n;
  };
  const trackNode = t => mk({ id: t.id, name: t.name, en: t.en || '', kw: [], kids: (tax.tracks || {})[t.id] || [] }, root === 'domain' ? 'domain' : null, root === 'domain' ? 1 : 0, true);
  let top;
  if (root === 'domain') {
    top = { id: 'domain', name: domainName, en: 'All directions', kw: [], s: [], r: [], kids: [], depth: 0, parent: null, preset: true };
    byId.set('domain', top);
    top.kids = tracks.map(trackNode);
  } else {
    const t = tracks.find(x => x.id === root); if (!t) return null;
    top = trackNode(t);
  }
  return { root: top, byId };
}

// 显示到第几层：depth 从 0（只有根）开始；focus 是只看这一支时的根节点
export function visible(tree, depth, focus) {
  const start = (focus && tree.byId.get(focus)) || tree.root, base = start.depth, out = [];
  const walk = n => { out.push(n); if (n.depth - base < depth) n.kids.forEach(walk); };
  walk(start);
  return out;
}
export const maxDepth = (tree, focus) => {
  const start = (focus && tree.byId.get(focus)) || tree.root; let m = 0;
  const walk = n => { m = Math.max(m, n.depth - start.depth); n.kids.forEach(walk); };
  walk(start); return m;
};
// 当前显示的最深一层里，还没有子节点的（扩散时要让 AI 细分的就是它们）
export function frontier(tree, depth, focus) {
  const start = (focus && tree.byId.get(focus)) || tree.root;
  return visible(tree, depth, focus).filter(n => n.depth - start.depth === depth && !n.kids.length && n.id !== 'domain');
}
export const pathOf = (tree, id) => { const p = []; let n = tree.byId.get(id); while (n) { p.unshift(n); n = n.parent ? tree.byId.get(n.parent) : null; } return p; };
const trackOf = id => String(id).split('.')[0];

// 把资讯、论文、笔记挂到节点上。items：[{id, t, s, k[], r[], type}]；cards：{id: {t, at}}
// 每一条从它所属的方向往下找：哪些子节点匹配就进哪些子节点，一直到不再匹配为止，挂在最深的那层；
// 一个子节点都不匹配的留在方向节点上。父节点的计数 = 自己 + 全部子孙（去重）。
// 返回 Map(节点 ID → { news:Set, papers:Set, notes:Set, stages:Set, routes:Set })
export function attach(tree, items, cards = {}) {
  const RE = new Map(), own = new Map(), res = new Map();
  // 一个节点匹配 = 它自己或任何子孙的关键词匹配（上层节点的范围就是下层的总和，不会被一个泛词吸走全部资讯）
  const allKw = n => n.kw.concat(...n.kids.map(allKw));
  for (const n of tree.byId.values()) {
    const kw = allKw(n); if (kw.length) RE.set(n.id, kwRegex(kw));
    own.set(n.id, { news: new Set(), papers: new Set(), notes: new Set() });
    res.set(n.id, { news: new Set(), papers: new Set(), notes: new Set(), stages: new Set(n.s), routes: new Set(n.r) });
  }
  const trackIds = [...tree.byId.values()].filter(n => n.depth === (tree.root.id === 'domain' ? 1 : 0)).map(n => n.id);
  const hit = (n, text, routes, at) => (RE.get(n.id) && RE.get(n.id).test(text)) || routes.some(r => n.r.includes(r)) || (at && n.s.includes(at));
  const place = (id, text, bucket, tracks, routes = [], at = null, strict = false) => {
    const down = n => { const m = n.kids.filter(k => hit(k, text, routes, at)); return m.length ? m.flatMap(down) : [n]; };
    for (const tid of tracks) {
      const tn = tree.byId.get(tid); if (!tn) continue;
      const leaves = down(tn);
      // 没有方向标签的（论文）只放进真正匹配到的子方向，不在每个方向顶上都挂一份
      if (strict && leaves.length === 1 && leaves[0] === tn) continue;
      for (const n of leaves) own.get(n.id)[bucket].add(id);
    }
  };
  for (const x of items) {
    const tr = (x.k || []).filter(k => tree.byId.has(k));
    place(x.id, `${x.t} ${x.s || ''}`, x.type === 'paper' ? 'papers' : 'news', tr.length ? tr : trackIds, x.r || [], null, !tr.length);
  }
  for (const [id, c] of Object.entries(cards)) {
    if (!c) continue;
    const tid = c.at ? trackOf(c.at) : null;
    place(id, c.t, 'notes', tid && tree.byId.has(tid) ? [tid] : trackIds, c.at ? [c.at] : [], c.at, !tid);
  }
  const up = n => {
    const r = res.get(n.id), o = own.get(n.id);
    for (const k of ['news', 'papers', 'notes']) o[k].forEach(v => r[k].add(v));
    for (const c of n.kids) { const cr = up(c); for (const k of ['news', 'papers', 'notes', 'stages', 'routes']) cr[k].forEach(v => r[k].add(v)); }
    return r;
  };
  up(tree.root);
  return res;
}

// AI 生成下一层：提示词和结果清洗
export function expandPrompt(tree, nodes, lang = 'zh') {
  const lines = nodes.map(n => `- ${n.id}：${pathOf(tree, n.id).filter(x => x.id !== 'domain').map(x => x.name).join(' → ')}${n.kw.length ? `（关键词：${n.kw.slice(0, 6).join('、')}）` : ''}`).join('\n');
  return [
    '你在帮用户搭一棵学习用的知识树。下面每个节点要再往下细分一层。',
    '要求：每个节点给 3–5 个子方向，彼此不重叠、合起来能覆盖这个节点；粒度比父节点细一级，是能单独学、能单独追资讯的方向，不要写成学习步骤或文章标题；名称 12 字以内。',
    '每个子方向给 4–8 个关键词，中英文都要有（英文写业内通用的叫法），用来从资讯里自动匹配，所以要具体，不要“模型”“AI”这种泛词。en 是英文名称。',
    '只输出一个 ```json``` 代码块：{"kids":{"节点 ID":[{"name":"中文名","en":"English name","kw":["…"]}]}}',
    '要细分的节点：', lines, lang === 'en' ? '名称用中文，en 字段写英文。' : ''
  ].filter(Boolean).join('\n');
}
export function cleanKids(data, allowed) {
  const out = {};
  const kids = data && data.kids && typeof data.kids === 'object' ? data.kids : {};
  for (const [id, L] of Object.entries(kids)) {
    if (!allowed.has(id) || !Array.isArray(L)) continue;
    const seen = new Set();
    out[id] = L.filter(x => x && typeof x.name === 'string' && x.name.trim()).map(x => ({ name: x.name.trim().slice(0, 24), en: String(x.en || '').trim().slice(0, 60),
      kw: (Array.isArray(x.kw) ? x.kw : []).map(k => String(k).trim()).filter(k => k.length >= 2 && k.length <= 40).slice(0, 10) }))
      .filter(x => x.kw.length && !seen.has(x.name) && seen.add(x.name)).slice(0, 6);
    if (!out[id].length) delete out[id];
  }
  return out;
}
