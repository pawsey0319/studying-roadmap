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
