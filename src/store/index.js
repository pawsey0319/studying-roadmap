// 数据层：界面只通过这里读写个人数据。
// 现在的实现：本地 IndexedDB + 私有 Gist 同步；以后加云端（Supabase）时只改这一层。
// 个人数据分两份可同步文档：progress（开始日期 + 任务完成情况）、notes（阶段笔记）。
// 界面偏好（展开状态、筛选、当前板块）只存本地，不同步。
import { kvGet, kvSet } from './kv.js';
import { newDoc, setKey, delKey, mergeDoc } from '../core/doc.js';
import { migrateV1, migrateUiV1, validProgress, validNote } from './migrate.js';

export const V1_KEY = 'learning-hub.v1';
const DOCS = { progress: validProgress, notes: validNote };

const S = { progress: newDoc(), notes: newDoc(), ui: {} };
const listeners = new Set();
let legacy = null;

export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = what => listeners.forEach(fn => fn(what));

export async function init({ legacyMap, defaultTab, today }) {
  legacy = legacyMap;
  const [p, n, ui, meta] = await Promise.all(['progress', 'notes', 'ui', 'meta'].map(kvGet));
  if (p && n && meta && meta.v === 2) {
    S.progress = p; S.notes = n; S.ui = ui || {};
  } else {
    // 第一次打开 v2：从 v1 的 localStorage 迁移；v1 数据原样保留，作为备份
    let v1 = null;
    try { v1 = JSON.parse(localStorage.getItem(V1_KEY)); } catch (e) {}
    if (v1) {
      const m = migrateV1(v1, legacy);
      S.progress = m.progress; S.notes = m.notes; S.ui = migrateUiV1(v1, legacy);
      if (m.unmapped.length) console.warn('这些旧数据没有对应的新 ID，已跳过：', m.unmapped);
      try { localStorage.setItem(V1_KEY + '.backup-' + today, localStorage.getItem(V1_KEY)); } catch (e) {}
    }
    await persist('all');
    await kvSet('meta', { v: 2, migratedAt: Date.now(), fromV1: !!v1 });
  }
  if (!S.progress.e.start) setKey(S.progress, 'start', today, 1);
  S.ui = Object.assign({ tab: defaultTab, open: {}, filter: {}, snapLvl: {}, snapSrc: {}, snapMore: {} }, S.ui);
}

async function persist(which) {
  if (which === 'all' || which === 'progress') await kvSet('progress', S.progress);
  if (which === 'all' || which === 'notes') await kvSet('notes', S.notes);
  if (which === 'all' || which === 'ui') await kvSet('ui', S.ui);
}

/* ---------- 读 ---------- */
export const start = () => S.progress.e.start;
export const done = () => S.progress.e;          // { 任务 ID: 日期 }，也含 start 键，按 ID 取值时无影响
export const isDone = id => !!S.progress.e[id];
export const note = stageId => S.notes.e[stageId] || '';
export const ui = () => S.ui;

/* ---------- 写 ---------- */
export function setStart(d) { setKey(S.progress, 'start', d); persist('progress'); emit('progress'); }
export function setDone(id, on, date) {
  if (on) setKey(S.progress, id, date); else delKey(S.progress, id);
  persist('progress'); emit('progress');
}
export function setNote(stageId, text) {
  if (text) setKey(S.notes, stageId, text); else delKey(S.notes, stageId);
  persist('notes'); emit('notes');
}
// 界面偏好：直接改 ui() 返回的对象后调用
export function saveUi() { persist('ui'); }

/* ---------- 导出 / 导入 ---------- */
export function exportData() {
  return { app: 'learning-hub', v: 2, exportedAt: new Date().toISOString(), progress: S.progress, notes: S.notes };
}
// 接受 v2 导出文件，也接受 v1 导出的 {start, done, notes}。导入视为一次新的修改，覆盖本地。
export function importData(d) {
  if (!d || typeof d !== 'object') throw new Error('格式不对');
  let p, n;
  if (d.v === 2 && d.progress && d.notes) { p = d.progress.e || {}; n = d.notes.e || {}; }
  else { const m = migrateV1({ start: d.start, done: d.done, notes: d.notes }, legacy); p = m.progress.e; n = m.notes.e; }
  const now = Date.now();
  replaceAll(S.progress, p, validProgress, now);
  replaceAll(S.notes, n, validNote, now);
  if (!S.progress.e.start) setKey(S.progress, 'start', new Date().toISOString().slice(0, 10), now);
  persist('all'); emit('progress'); emit('notes');
}
function replaceAll(doc, entries, valid, ts) {
  for (const k of Object.keys(doc.e)) if (!(k in entries)) delKey(doc, k, ts);
  for (const [k, v] of Object.entries(entries)) if (valid(k, v)) setKey(doc, k, v, ts);
}

/* ---------- 同步用 ---------- */
export const docs = () => ({ progress: S.progress, notes: S.notes });
export function mergeRemote(name, remote) {
  const changed = mergeDoc(S[name], remote, DOCS[name]);
  if (changed) { persist(name); emit('remote:' + name); }
  return changed;
}
export const legacyMap = () => legacy;
