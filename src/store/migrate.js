// 把 v1 的进度和笔记转成 v2 格式（纯函数，可测试）。
// v1 结构：{ start, done: {'llm.0.tech.0': 日期}, notes: {'llm.0': 文本}, mt: {'start': ts, 'done.llm.0.tech.0': ts, 'notes.llm.0': ts} }
// v2 结构：progress 文档（键 start 和任务 ID）、notes 文档（键是阶段 ID），见 core/doc.js。
// legacy：content/legacy-v1.json 里的旧 ID → 新 ID 对照表。
import { newDoc } from '../core/doc.js';

import { DATE_RE, ITEM_RE, STAGE_RE, DOCS } from '../core/schema.js';
export { DATE_RE, ITEM_RE, STAGE_RE };
// 来自同步文件或导入文件的数据，写入前都要过这两个检查
export const validProgress = DOCS.progress;
export const validNote = DOCS.notes;

// 没有时间戳的旧数据记为 1：任何一台设备上真实的修改都比它新
export function migrateV1(v1, legacy) {
  const progress = newDoc(), notes = newDoc(), unmapped = [];
  if (!v1 || typeof v1 !== 'object') return { progress, notes, unmapped };
  const mt = v1.mt && typeof v1.mt === 'object' ? v1.mt : {};
  if (DATE_RE.test(v1.start || '')) { progress.e.start = v1.start; progress.mt.start = +mt.start || 1; }

  const done = v1.done && typeof v1.done === 'object' ? v1.done : {};
  for (const [old, id] of Object.entries(legacy.done)) {
    const has = Object.prototype.hasOwnProperty.call(done, old), ts = +mt['done.' + old] || 0;
    if (has) { progress.e[id] = DATE_RE.test(done[old]) ? done[old] : '2026-01-01'; progress.mt[id] = ts || 1; }
    else if (ts) progress.mt[id] = ts;  // 记录过“取消勾选”
  }
  Object.keys(done).filter(k => !legacy.done[k]).forEach(k => unmapped.push('done.' + k));

  const nt = v1.notes && typeof v1.notes === 'object' ? v1.notes : {};
  for (const [old, id] of Object.entries(legacy.notes)) {
    const has = Object.prototype.hasOwnProperty.call(nt, old), ts = +mt['notes.' + old] || 0;
    if (has && String(nt[old]).length) { notes.e[id] = String(nt[old]); notes.mt[id] = ts || 1; }
    else if (ts) notes.mt[id] = ts;
  }
  Object.keys(nt).filter(k => !legacy.notes[k]).forEach(k => unmapped.push('notes.' + k));
  return { progress, notes, unmapped };
}

// v1 的界面偏好（展开状态、筛选）里也用到了旧阶段 ID，一并换成新 ID
export function migrateUiV1(v1, legacy) {
  const ui = { tab: v1.tab, open: {}, filter: v1.filter || {}, snapLvl: v1.snapLvl || {}, snapSrc: v1.snapSrc || {}, snapMore: v1.snapMore || {} };
  for (const [k, v] of Object.entries(v1.open || {})) {
    if (legacy.notes[k]) ui.open[legacy.notes[k]] = v;
    else if (k.startsWith('feed.')) ui.open[k] = v;
  }
  return ui;
}
