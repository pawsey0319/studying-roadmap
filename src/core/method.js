// 学习方法档案（纯函数）：学习 Agent 每整理一段对话，就对档案做几处小修改（新增、印证、改写、削弱）。
// 前期变化快、后期变化慢：每次修改的幅度 = rate(已整理的对话数)，从 1 逐渐降到 0.15。
// 你亲手写或改过的条目（by: 'user'）AI 只能印证或削弱权重，不能改写文字，也不会被自动删除。
export const DIMS = ['呈现偏好', '提取练习', '自我解释', '深加工', '元认知', '常见误区', '节奏', '动手偏好', '其他'];
export const ACTIVE = 0.35;           // 权重达到这个值才会带进对话
export const rate = n => Math.max(0.15, 1 / (1 + (n || 0) / 5));

const clip = (s, n) => String(s || '').trim().slice(0, n);

// entries：{ id: {d, t, w, n, c, u, src[], by} }；ops 来自模型；返回 { set: {id: entry}, del: [id] }
export function applyMethodOps(entries, ops, { n = 0, now = Date.now(), src = '', idGen }) {
  const r = rate(n), set = {}, del = [];
  const cur = id => set[id] || entries[id];
  for (const op of Array.isArray(ops) ? ops.slice(0, 4) : []) {
    if (!op || typeof op !== 'object') continue;
    const e = op.id && cur(op.id);
    const touch = x => ({ ...x, u: now, src: [...new Set([...(x.src || []), src].filter(Boolean))].slice(-6) });
    if (op.op === 'add' && clip(op.t, 300)) {
      const t = clip(op.t, 300);
      const dup = Object.entries({ ...entries, ...set }).find(([, x]) => x && x.t === t);
      if (dup) { const [id, x] = dup; set[id] = touch({ ...x, n: (x.n || 1) + 1, w: x.w + r * (1 - x.w) * 0.5 }); continue; }
      const d = DIMS.includes(op.d) ? op.d : '其他';
      set[idGen()] = { d, t, w: +(0.25 + 0.35 * r).toFixed(3), n: 1, c: now, u: now, src: src ? [src] : [], by: 'ai' };
    } else if (op.op === 'reinforce' && e) {
      set[op.id] = touch({ ...e, n: (e.n || 1) + 1, w: +(e.w + r * (1 - e.w) * 0.5).toFixed(3) });
    } else if (op.op === 'revise' && e && clip(op.t, 300)) {
      set[op.id] = e.by === 'user' ? touch({ ...e, n: (e.n || 1) + 1 }) : touch({ ...e, t: clip(op.t, 300), n: (e.n || 1) + 1 });
    } else if (op.op === 'weaken' && e) {
      const w = +(e.w - r * e.w * 0.6).toFixed(3);
      if (w < 0.12 && e.by !== 'user') { del.push(op.id); delete set[op.id]; }
      else set[op.id] = { ...touch(e), w: Math.max(w, e.by === 'user' ? 0.4 : 0) };
    }
  }
  return { set, del };
}

// 带进系统提示的条目：权重够的，按权重排序，最多 12 条
export function activeMethod(entries) {
  return Object.entries(entries || {}).filter(([, x]) => x && x.w >= ACTIVE).sort((a, b) => b[1].w - a[1].w).slice(0, 12);
}
