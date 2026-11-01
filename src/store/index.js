// 数据层：界面只通过这里读写个人数据。
// 本地：IndexedDB（kv.js）。同步：私有 Gist（gist.js）或云端 Supabase（cloud.js），两者用同一套“文档合并”逻辑。
// 个人数据按用途分成多份可同步文档（见 core/schema.js），界面偏好 ui 和 AI 设置只存本地，不同步。
import { kvGet, kvSet } from './kv.js';
import { newDoc, setKey, delKey, mergeDoc } from '../core/doc.js';
import { DOC_NAMES, validFor } from '../core/schema.js';
import { migrateV1, migrateUiV1 } from './migrate.js';

export const V1_KEY = 'learning-hub.v1';
const D = Object.fromEntries(DOC_NAMES.map(n => [n, newDoc()]));
let UI = {};
const listeners = new Set();
let legacy = null;

export const onChange = fn => { listeners.add(fn); return () => listeners.delete(fn); };
const emit = what => listeners.forEach(fn => { try { fn(what); } catch (e) { console.error(e); } });

export async function init({ legacyMap, defaultTab, today }) {
  legacy = legacyMap;
  const meta = await kvGet('meta');
  if (meta && meta.v === 2) {
    for (const n of DOC_NAMES) D[n] = (await kvGet(n)) || newDoc();
    UI = (await kvGet('ui')) || {};
  } else {
    // 第一次打开 v2：从 v1 的 localStorage 迁移；v1 数据原样保留，另存一份备份
    let v1 = null;
    try { v1 = JSON.parse(localStorage.getItem(V1_KEY)); } catch (e) {}
    if (v1) {
      const m = migrateV1(v1, legacy);
      D.progress = m.progress; D.notes = m.notes; UI = migrateUiV1(v1, legacy);
      if (m.unmapped.length) console.warn('这些旧数据没有对应的新 ID，已跳过：', m.unmapped);
      try { localStorage.setItem(V1_KEY + '.backup-' + today, localStorage.getItem(V1_KEY)); } catch (e) {}
    }
    for (const n of DOC_NAMES) await kvSet(n, D[n]);
    await kvSet('meta', { v: 2, migratedAt: Date.now(), fromV1: !!v1 });
  }
  if (!D.progress.e.start) setKey(D.progress, 'start', today, 1);
  UI = Object.assign({ tab: defaultTab, open: {}, filter: {}, snapLvl: {}, snapSrc: {}, snapMore: {} }, UI);
  await kvSet('ui', UI);
}

const persist = n => kvSet(n, D[n]);

/* ---------- 通用读写 ---------- */
export const get = (doc, k) => D[doc].e[k];
export const all = doc => D[doc].e;
export function put(doc, k, v) {
  if (v === undefined || v === null || v === '') delKey(D[doc], k); else setKey(D[doc], k, v);
  persist(doc); emit(doc);
}
export function del(doc, k) { delKey(D[doc], k); persist(doc); emit(doc); }

/* ---------- 常用快捷方式 ---------- */
export const start = () => D.progress.e.start;
export const done = () => D.progress.e;
export const isDone = id => !!D.progress.e[id];
export const setStart = d => put('progress', 'start', d);
export const setDone = (id, on, date) => put('progress', id, on ? date : null);
export const note = id => D.notes.e[id] || '';
export const setNote = (id, text) => put('notes', id, text);
export const ui = () => UI;
export const saveUi = () => kvSet('ui', UI);

/* ---------- 只存本地的设置（AI Key、花费记录等，不同步） ---------- */
export const localGet = k => kvGet('local.' + k);
export const localSet = (k, v) => kvSet('local.' + k, v);

/* ---------- 导出 / 导入 ---------- */
export function exportData() {
  return { app: 'learning-hub', v: 2, exportedAt: new Date().toISOString(), docs: Object.fromEntries(DOC_NAMES.map(n => [n, D[n]])) };
}
// 接受 v2 导出（含 M0 版的 progress/notes 字段），也接受 v1 导出的 {start, done, notes}。导入视为一次新的修改，覆盖本地。
export function importData(d) {
  if (!d || typeof d !== 'object') throw new Error('格式不对');
  let src;
  if (d.v === 2 && d.docs) src = Object.fromEntries(Object.entries(d.docs).map(([k, v]) => [k, (v && v.e) || {}]));
  else if (d.v === 2 && d.progress) src = { progress: d.progress.e || {}, notes: (d.notes && d.notes.e) || {} };
  else { const m = migrateV1({ start: d.start, done: d.done, notes: d.notes }, legacy); src = { progress: m.progress.e, notes: m.notes.e }; }
  const now = Date.now();
  for (const n of DOC_NAMES) {
    if (!src[n]) continue;
    const valid = validFor(n);
    for (const k of Object.keys(D[n].e)) if (!(k in src[n])) delKey(D[n], k, now);
    for (const [k, v] of Object.entries(src[n])) if (valid(k, v)) setKey(D[n], k, v, now);
    persist(n); emit(n);
  }
  if (!D.progress.e.start) { setKey(D.progress, 'start', new Date().toISOString().slice(0, 10), now); persist('progress'); }
}

/* ---------- 同步用 ---------- */
export const docs = () => D;
export function mergeRemote(name, remote) {
  if (!D[name]) return false;
  const changed = mergeDoc(D[name], remote, validFor(name));
  if (changed) { persist(name); emit('remote:' + name); }
  return changed;
}
export const legacyMap = () => legacy;
