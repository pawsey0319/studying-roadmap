// 学习方法档案（纯函数）：学习 Agent 每整理一段对话，就对档案做几处小修改（新增、印证、改写、削弱、删除）。
// 前期变化快、后期变化慢：每次修改的幅度 = rate(已整理的对话数)，从 1 逐渐降到 0.15。
// 你亲手写或改过的条目（by: 'user'）AI 只能印证或削弱权重，不能改写文字，也不会被自动删除。
//
// v3 加的约束（证据约束参考 DeepTutor 的学习者档案规则，短编号、查重、修改历史参考 mem0 的做法，都是自己重写的，见 NOTICE）：
//   1. 给模型看的条目用短编号 1、2、3…，模型回来的编号再换回真实 ID，防止它编造 ID。
//   2. “偏好”类条目（呈现偏好、节奏、动手偏好）必须引用用户的原话，程序核对原话确实出现在用户说过的话里。
//   3. 硬上限：总共 40 条；每个偏好维度最多 6 条，其他维度最多 12 条。满了就不再新增。
//   4. 删除只能给四种理由之一：contradicted 被反驳、superseded 被新条目取代、stale 过时、low_signal 证据太弱。
//   5. 不许用“深刻、总是、完全……”这类绝对化的词；每条最多 240 字。
//   6. 新条目先查重：文字相同或意思很接近（同一维度、字面相似度高）就当作印证已有条目。
//   7. 每次修改都记下改之前和改之后，可以整次撤销。
//   “这次不改”是正常结果：ops 为空时什么都不做。
export const DIMS = ['呈现偏好', '提取练习', '自我解释', '深加工', '元认知', '常见误区', '节奏', '动手偏好', '其他'];
export const PREF_DIMS = new Set(['呈现偏好', '节奏', '动手偏好']);
export const ACTIVE = 0.35;           // 权重达到这个值才会带进对话
export const MAX_TOTAL = 40, MAX_PREF = 6, MAX_OBS = 12, MAX_LEN = 240, MAX_OPS = 4;
export const DEL_WHY = { contradicted: '和新的表现矛盾', superseded: '被新条目取代', stale: '过时了', low_signal: '证据太弱' };
export const BANNED = /深刻|总是|从不|从来不|完全|彻底|永远|绝对|一定会|所有时候|任何时候|毫无/;
export const rate = n => Math.max(0.15, 1 / (1 + (n || 0) / 5));

const clip = (s, n) => String(s || '').trim().slice(0, n);
const norm = s => String(s || '').toLowerCase().replace(/[\s\p{P}\p{S}]+/gu, '');
const grams = s => { const t = norm(s), g = new Set(); for (let i = 0; i < t.length - 1; i++) g.add(t.slice(i, i + 2)); return g; };
// 字面相似度：二元组的 Jaccard 系数
export function similar(a, b) {
  const A = grams(a), B = grams(b); if (!A.size || !B.size) return norm(a) === norm(b) ? 1 : 0;
  let n = 0; for (const x of A) if (B.has(x)) n++;
  return n / (A.size + B.size - n);
}
// 原话核对：去掉空白和标点后，引文要原样出现在用户说过的话里，且至少 4 个字
export const quoteOk = (quote, userText) => { const q = norm(quote); return q.length >= 4 && norm(userText).includes(q); };

// 给模型看的条目：短编号 → 真实 ID
export function methodView(entries) {
  const L = Object.entries(entries || {}).filter(([, x]) => x).sort((a, b) => b[1].w - a[1].w).slice(0, MAX_TOTAL);
  const map = {}, lines = L.map(([id, x], i) => { map[String(i + 1)] = id; return `${i + 1}｜${x.d}｜${x.t}｜${x.w >= 0.7 ? '很有把握' : x.w >= ACTIVE ? '较有把握' : '待观察'}${x.by === 'user' ? '｜用户写的' : ''}`; });
  return { lines: lines.join('\n'), map };
}

// entries：{ id: {d, t, w, n, c, u, src[], by, q?} }；ops 来自模型（id 是短编号，传 map 换回真实 ID）
// 返回 { set: {id: entry}, del: [id], log: [{id, before, after}], rejected: [{op, why}] }
export function applyMethodOps(entries, ops, { n = 0, now = Date.now(), src = '', idGen, map = null, userText = null }) {
  const r = rate(n), set = {}, del = [], log = [], rejected = [];
  const cur = id => (del.includes(id) ? null : set[id] || entries[id]);
  const live = () => Object.entries({ ...entries, ...set }).filter(([id, x]) => x && !del.includes(id));
  const record = (id, after) => { const before = entries[id] || null; const i = log.findIndex(l => l.id === id); if (i >= 0) log[i].after = after; else log.push({ id, before, after }); };
  const touch = x => ({ ...x, u: now, src: [...new Set([...(x.src || []), src].filter(Boolean))].slice(-6) });
  const real = id => (map ? map[String(id)] : id);
  const reinforce = (id, x) => { const y = touch({ ...x, n: (x.n || 1) + 1, w: +(x.w + r * (1 - x.w) * 0.5).toFixed(3) }); set[id] = y; record(id, y); };
  const list = Array.isArray(ops) ? ops : [];
  if (list.length > MAX_OPS) list.slice(MAX_OPS).forEach(op => rejected.push({ op, why: `一次最多改 ${MAX_OPS} 处` }));
  for (const op of list.slice(0, MAX_OPS)) {
    if (!op || typeof op !== 'object') continue;
    const id = op.id != null ? real(op.id) : null, e = id && cur(id);
    if (op.id != null && !e) { rejected.push({ op, why: '编号不存在' }); continue; }
    const t = clip(op.t, MAX_LEN + 60);
    if ((op.op === 'add' || op.op === 'revise') && t && BANNED.test(t)) { rejected.push({ op, why: '用了绝对化的词' }); continue; }
    if ((op.op === 'add' || op.op === 'revise') && t.length > MAX_LEN) { rejected.push({ op, why: `超过 ${MAX_LEN} 字` }); continue; }
    if (op.op === 'add' && t) {
      const d = DIMS.includes(op.d) ? op.d : '其他';
      const dup = live().find(([, x]) => x.t === t || (x.d === d && similar(x.t, t) >= 0.6));
      if (dup) { reinforce(dup[0], dup[1]); continue; }
      if (PREF_DIMS.has(d) && userText != null && !quoteOk(op.q, userText)) { rejected.push({ op, why: '偏好类要引用用户原话，没有核对上' }); continue; }
      const all = live();
      if (all.length >= MAX_TOTAL) { rejected.push({ op, why: `档案已满 ${MAX_TOTAL} 条` }); continue; }
      if (all.filter(([, x]) => x.d === d).length >= (PREF_DIMS.has(d) ? MAX_PREF : MAX_OBS)) { rejected.push({ op, why: `“${d}”已满` }); continue; }
      const nid = idGen(), x = { d, t, w: +(0.25 + 0.35 * r).toFixed(3), n: 1, c: now, u: now, src: src ? [src] : [], by: 'ai', ...(op.q ? { q: clip(op.q, 120) } : {}) };
      set[nid] = x; record(nid, x);
    } else if (op.op === 'reinforce' && e) {
      reinforce(id, e);
    } else if (op.op === 'revise' && e && t) {
      if (e.by === 'user') { reinforce(id, e); continue; }
      const y = touch({ ...e, t, n: (e.n || 1) + 1 }); set[id] = y; record(id, y);
    } else if (op.op === 'weaken' && e) {
      const w = +(e.w - r * e.w * 0.6).toFixed(3);
      if (w < 0.12 && e.by !== 'user') { del.push(id); delete set[id]; record(id, null); }
      else { const y = { ...touch(e), w: Math.max(w, e.by === 'user' ? 0.4 : 0) }; set[id] = y; record(id, y); }
    } else if (op.op === 'delete' && e) {
      if (!DEL_WHY[op.why]) { rejected.push({ op, why: '删除理由不在四种之内' }); continue; }
      if (e.by === 'user') { rejected.push({ op, why: '用户写的条目不自动删除' }); continue; }
      del.push(id); delete set[id]; record(id, null);
    } else if (op.op) rejected.push({ op, why: '不认识的操作' });
  }
  return { set, del, log, rejected };
}

// 撤销一次修改：把 log 里每一项恢复成改之前
export function undoOps(log) {
  const set = {}, del = [];
  for (const l of log || []) { if (l.before) set[l.id] = l.before; else del.push(l.id); }
  return { set, del };
}

// 带进系统提示的条目：权重够的，按权重排序，最多 12 条
export function activeMethod(entries) {
  return Object.entries(entries || {}).filter(([, x]) => x && x.w >= ACTIVE).sort((a, b) => b[1].w - a[1].w).slice(0, 12);
}
