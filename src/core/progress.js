// 进度计算（纯函数）。阶段没有周次限制，只按内容顺序排列；
// “当前阶段” = 第一个既没学完、也没被你标为已掌握的阶段。
import { effectiveStage, stageProgress } from './overlay.js';

export const pct = (done, ids) => ids.length ? ids.filter(id => done[id]).length / ids.length : 0;
export const countDone = (done, ids) => ids.filter(id => done[id]).length;

// overlays：{ 阶段 ID: 个人调整 }
export function trackState(track, overlays, done) {
  const stages = track.stages.map(s => {
    const es = effectiveStage(s, overlays[s.id]);
    return { ...es, prog: stageProgress(es, done) };
  });
  const cur = stages.find(s => !s.prog.complete) || null;
  const n = stages.reduce((a, s) => a + s.prog.n, 0), total = stages.reduce((a, s) => a + s.prog.total, 0);
  return {
    stages, current: cur ? cur.id : null,
    doneStages: stages.filter(s => s.prog.complete).length,
    n, total, pct: total ? n / total : 0
  };
}

// 阶段状态：done 学完 / mastered 已掌握 / now 当前 / todo 未学
export function stageStatus(s, currentId) {
  if (s.mastered) return 'mastered';
  if (s.prog.complete) return 'done';
  if (s.id === currentId) return 'now';
  return 'todo';
}

// 使用统计（只存这台设备，不上传）：stats = { d: { 'YYYY-MM-DD': { o 当天打开过, a Agent 回答次数, t 勾完的任务数 } } }，只留最近 60 天
export function bumpStat(stats, day, key, n = 1) {
  // 每一天也复制一份，返回值完全独立于入参（只复制 d，不修改原对象）
  const s = { d: Object.fromEntries(Object.entries((stats && stats.d) || {}).map(([k, v]) => [k, v && typeof v === 'object' ? { ...v } : {}])) };
  const cur = { o: 0, a: 0, t: 0, ...(s.d[day] || {}) };
  cur[key] = key === 'o' ? 1 : (cur[key] || 0) + n;
  s.d[day] = cur;
  s.d = Object.fromEntries(Object.keys(s.d).sort().slice(-60).map(k => [k, s.d[k]]));
  return s;
}
// 截至 today 的最近 7 天：打开了几天、Agent 回答几次、勾完几项任务
export function weekStats(stats, today) {
  const t = Date.parse(today + 'T00:00:00Z'), d = (stats && stats.d) || {};
  return [...Array(7)].map((_, i) => new Date(t - i * 864e5).toISOString().slice(0, 10))
    .reduce((r, k) => { const x = d[k]; if (x) { r.open += x.o ? 1 : 0; r.agent += x.a || 0; r.tasks += x.t || 0; } return r; }, { open: 0, agent: 0, tasks: 0 });
}
