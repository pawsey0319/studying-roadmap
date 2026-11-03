// 学习方向的采用（纯函数）。新用户没有默认方向，自己从路线库挑或让 Agent 规划。
// 这次改版之前就在用的人（已有进度、调整、笔记，或之前读过资讯），第一次打开时自动采用全部公共方向，保持原样。
export const CUTOFF = '2026-11-04';
export function wasUsingBefore(docs) {
  if (!docs) return false;
  const keys = n => Object.keys((docs[n] && docs[n].e) || {});
  return keys('progress').some(k => k !== 'start') || keys('overlay').length > 0 || keys('cards').length > 0 || keys('notes').length > 0
    || !!(docs.meta && docs.meta.e && docs.meta.e.onboarded)
    || Object.values((docs.read && docs.read.e) || {}).some(v => String(v) < CUTOFF);
}
export const adoptedList = docs => { const a = docs && docs.meta && docs.meta.e && docs.meta.e.adopted; return Array.isArray(a) ? a : null; };
