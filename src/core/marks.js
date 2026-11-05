// 点赞与引用（纯函数）。
// 点赞：likes 文档，键 "card:<卡片>"、"stage:<阶段或前沿路线>"、"track:<方向>"，值是点赞时间。
// 引用：refs 文档，键 q<随机>，值 { from:{k,id}, to:{k,id}, snap, at, c }；
//   from 是引用发生的地方，to 是被引用的内容，snap 是引用当时的文字，原内容后来改了或删了，引用处仍然保留它。
export const KINDS = ['card', 'stage', 'track'];
const ID_RE = /^[a-z0-9][a-z0-9.\-]{1,60}$/;
export const likeKey = (k, id) => `${k}:${id}`;
export const splitKey = key => { const i = String(key).indexOf(':'); return i < 0 ? null : { k: key.slice(0, i), id: key.slice(i + 1) }; };

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
export const endOk = e => isObj(e) && KINDS.includes(e.k) && typeof e.id === 'string' && ID_RE.test(e.id);
export const likeOk = (key, v) => { const p = splitKey(key); return !!p && endOk(p) && Number.isInteger(v) && v > 0; };
export const refOk = (key, v) => /^q[0-9a-z]{6,24}$/.test(key) && isObj(v) && endOk(v.from) && endOk(v.to)
  && typeof v.snap === 'string' && v.snap.length <= 600 && typeof v.c === 'number' && (v.at === undefined || typeof v.at === 'string');

export const isLiked = (likes, k, id) => !!likes[likeKey(k, id)];
export const likeCount = likes => Object.keys(likes).length;

// 被引用的索引：目标键 → 引用记录列表（新的在前）
export function refIndex(refs) {
  const by = new Map(), from = new Map();
  for (const [qid, r] of Object.entries(refs)) {
    const tk = likeKey(r.to.k, r.to.id), fk = likeKey(r.from.k, r.from.id);
    if (!by.has(tk)) by.set(tk, []); by.get(tk).push({ qid, ...r });
    if (!from.has(fk)) from.set(fk, []); from.get(fk).push({ qid, ...r });
  }
  for (const m of [by, from]) for (const L of m.values()) L.sort((a, b) => b.c - a.c);
  return { by, from };
}
export const citedBy = (ix, k, id) => ix.by.get(likeKey(k, id)) || [];
export const citesOf = (ix, k, id) => ix.from.get(likeKey(k, id)) || [];

// 取一段文字做快照：去掉 Markdown 标记里的引用前缀，截到 max 字
export function snapOf(text, max = 600) {
  const s = String(text || '').replace(/^>\s?/gm, '').replace(/\s+\n/g, '\n').trim();
  return s.length > max ? s.slice(0, max - 1) + '…' : s;
}
// 插入到目标笔记里的引用文字（Markdown 引用块）
export function quoteMd(title, text, max = 140) {
  const body = snapOf(text, max).replace(/\n+/g, ' ');
  return `> 引用：${String(title || '').replace(/\n/g, ' ').slice(0, 60)}\n> ${body}`;
}
// 原内容现在的状态：same 没变；changed 改过；gone 找不到了
export function refStatus(ref, current) {
  if (current == null) return 'gone';
  return snapOf(current) === ref.snap ? 'same' : 'changed';
}
export function makeRef({ from, to, text, id, now }) {
  if (!endOk(from) || !endOk(to)) throw new Error('引用的位置不对');
  if (from.k === to.k && from.id === to.id) throw new Error('不能引用自己');
  return [id, { from: { k: from.k, id: from.id }, to: { k: to.k, id: to.id }, snap: snapOf(text), c: now }];
}
