// 自测掌握度（纯函数）。
// 算法思路参考 DeepTutor（https://github.com/HKUDS/DeepTutor，Apache-2.0，Copyright HKUDS）的掌握度与下一步优先级逻辑，
// 按本项目的数据结构用 JS 重写，没有复制原代码。见仓库根目录 NOTICE。
//
// 每个知识点 = 阶段里的一项任务（任务 ID）；没有对应任务的题目记在阶段 ID 上。
// 记录：{ k: 'memory'|'procedural'|'concept', a: [{s 得分 0–1, h 用了几次提示, r 重试几次, p 是否通过, t 时间}], qs: [{t 题目, a 参考答案}] }
export const KINDS = { memory: '记忆', procedural: '步骤', concept: '概念' };
export const WEIGHTS = [0.5, 0.7, 0.85, 0.95, 1.0];   // 最近 5 次，越新权重越大（最后一个是最新一次）
export const THRESHOLD = 0.9;                         // 记忆、步骤类达到这个值算掌握
export const HINT_COST = 0.08, HINT_MAX = 0.25;       // 每用一次提示扣分，最多扣这么多
export const RETRY_COST = 0.05, RETRY_MAX = 0.2;      // 每多试一次扣分，最多扣这么多
export const KEEP = 5;

const clamp = x => Math.max(0, Math.min(1, x));

// 一次作答的有效得分：原始得分减去提示和重试的扣分
export function attemptScore({ s = 0, h = 0, r = 0 }) {
  return clamp(clamp(+s || 0) - Math.min(HINT_MAX, HINT_COST * Math.max(0, h | 0)) - Math.min(RETRY_MAX, RETRY_COST * Math.max(0, r | 0)));
}

// 掌握度：最近 5 次加权平均；只答过 1 次最多 0.5，2 次最多 0.8
export function mastery(rec) {
  const a = ((rec && rec.a) || []).slice(-KEEP);
  if (!a.length) return 0;
  const w = WEIGHTS.slice(-a.length);
  const sum = a.reduce((x, at, i) => x + w[i] * attemptScore(at), 0) / w.reduce((x, y) => x + y, 0);
  const cap = a.length === 1 ? 0.5 : a.length === 2 ? 0.8 : 1;
  return +Math.min(sum, cap).toFixed(3);
}

// 是否掌握：记忆和步骤类看掌握度；概念类要最近一次“用自己的话讲一遍”被判为通过，且掌握度不低于 0.5
export function isMastered(rec) {
  if (!rec || !rec.a || !rec.a.length) return false;
  if (rec.k === 'concept') { const last = rec.a[rec.a.length - 1]; return !!last.p && mastery(rec) >= 0.5; }
  return mastery(rec) >= THRESHOLD;
}

// 记一次作答，返回新记录（不改入参）
export function addAttempt(rec, { kind, s, h, r, p, t = Date.now(), q }) {
  const k = KINDS[kind] ? kind : (rec && rec.k) || 'memory';
  const a = [...((rec && rec.a) || []), { s: +clamp(+s || 0).toFixed(3), h: Math.max(0, h | 0), r: Math.max(0, r | 0), p: !!p, t }].slice(-KEEP);
  let qs = (rec && rec.qs) || [];
  if (q && q.t) qs = [...qs.filter(x => x.t !== q.t), { t: String(q.t).slice(0, 400), a: String(q.a || '').slice(0, 600) }].slice(-KEEP);
  return { k, a, qs };
}

// 阶段的自测情况：测过几项、达标几项、平均掌握度
export function stageMastery(stage, recs) {
  const items = stage.items.filter(i => !i.skipped);
  const tested = items.filter(i => recs[i.id] && recs[i.id].a && recs[i.id].a.length);
  const ok = tested.filter(i => isMastered(recs[i.id]));
  const avg = tested.length ? tested.reduce((x, i) => x + mastery(recs[i.id]), 0) / tested.length : 0;
  return { items: items.length, tested: tested.length, mastered: ok.length, avg: +avg.toFixed(3) };
}

// 自测显示整个阶段都会了：每一项要么已完成、要么自测达标，并且至少有一项是靠自测达标的
export function suggestMastered(stage, recs, done) {
  if (stage.mastered) return false;
  const items = stage.items.filter(i => !i.skipped);
  if (!items.length) return false;
  let viaTest = 0;
  for (const i of items) {
    const m = isMastered(recs[i.id]);
    if (m) viaTest++;
    else if (!done[i.id]) return false;
  }
  return viaTest > 0;
}

// 下一步优先级：先是等批改的题，再是第一个没掌握的任务；自测已达标的任务排到最后
// pending：{ 任务 ID 或阶段 ID: 条数 }
export function nextItems(stage, recs, done, pending = {}) {
  const left = stage.items.filter(i => !i.skipped && !done[i.id]);
  const rank = i => (pending[i.id] ? 0 : isMastered(recs[i.id]) ? 2 : 1);
  return left.map((i, n) => ({ i, n, r: rank(i) })).sort((a, b) => a.r - b.r || a.n - b.n).map(x => x.i);
}

// 给模型看的掌握情况
export function masteryLines(stage, recs) {
  return stage.items.filter(i => !i.skipped).map(i => {
    const r = recs[i.id];
    if (!r || !r.a || !r.a.length) return `- ${i.id}：还没自测`;
    return `- ${i.id}：${KINDS[r.k] || ''}类，作答 ${r.a.length} 次，掌握度 ${Math.round(mastery(r) * 100)}%${isMastered(r) ? '（达标）' : ''}`;
  }).join('\n');
}
