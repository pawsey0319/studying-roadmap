// 数据层：界面只通过这里读写个人数据。
// 本地：IndexedDB（kv.js）。同步：私有 Gist（gist.js）或云端 Supabase（cloud.js），两者用同一套“文档合并”逻辑。
// 个人数据按用途分成多份可同步文档（见 core/schema.js），界面偏好 ui 和 AI 设置只存本地，不同步。
import { kvGet, kvSet } from './kv.js';
import { newDoc, setKey, delKey, mergeDoc, mergeDocKeepConflicts } from '../core/doc.js';
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
  skew = (await kvGet('_skew')) || 0;
  BASE = (await kvGet('_base')) || {};
  // 版本信息存在 _ver；M0 版本把它存在 meta 键里，和“meta”文档同名，这里兼容迁移
  let ver = await kvGet('_ver');
  if (!ver) { const old = await kvGet('meta'); if (old && old.v === 2 && !old.e) { ver = old; await kvSet('_ver', old); await kvSet('meta', newDoc()); } }
  if (ver && ver.v === 2) {
    for (const n of DOC_NAMES) { const d = await kvGet(n); D[n] = d && d.e && d.mt ? d : newDoc(); }
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
    await kvSet('_ver', { v: 2, migratedAt: Date.now(), fromV1: !!v1 });
  }
  if (!D.progress.e.start) setKey(D.progress, 'start', today, 1);
  if (!UI.readBase) { const d = new Date(Date.now() - 7 * 864e5); UI.readBase = d.toISOString().slice(0, 10); }
  UI = Object.assign({ tab: defaultTab, open: {}, filter: {}, snapLvl: {}, snapSrc: {}, snapMore: {} }, UI);
  await kvSet('ui', UI);
}

const persist = n => kvSet(n, D[n]);

/* ---------- 时间：用服务器对齐过的时钟给每一项打修改时间 ---------- */
// 同步时从云端拿到服务器时间，算出本机时钟偏差；之后所有修改时间都加上这个偏差。
// 这样某台设备时钟不准，也不会让旧修改覆盖新修改。
let skew = 0;
export const now = () => Date.now() + skew;
export function setSkew(ms) { if (Number.isFinite(ms) && Math.abs(ms - skew) > 1500 && Math.abs(ms) < 365 * 864e5) { skew = Math.round(ms); kvSet('_skew', skew); } }
export const clockSkew = () => skew;

/* ---------- 通用读写 ---------- */
export const get = (doc, k) => D[doc].e[k];
export const all = doc => D[doc].e;
export function put(doc, k, v) {
  if (v === undefined || v === null || v === '') delKey(D[doc], k, now()); else setKey(D[doc], k, v, now());
  persist(doc); emit(doc);
}
export function del(doc, k) { delKey(D[doc], k, now()); persist(doc); emit(doc); }

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
  const ts = now();
  for (const n of DOC_NAMES) {
    if (!src[n]) continue;
    const valid = validFor(n);
    for (const k of Object.keys(D[n].e)) if (!(k in src[n])) delKey(D[n], k, ts);
    for (const [k, v] of Object.entries(src[n])) if (valid(k, v)) setKey(D[n], k, v, ts);
    persist(n); emit(n);
  }
  if (!D.progress.e.start) { setKey(D.progress, 'start', new Date().toISOString().slice(0, 10), ts); persist('progress'); }
}

/* ---------- 同步用 ---------- */
export const docs = () => D;
// 阶段长文档两边都改过时，较旧的一份另存成卡片（“冲突副本”），不丢内容
const CONFLICT_DOCS = new Set(['notes']);
export function mergeRemote(name, remote) {
  if (!D[name]) return false;
  let changed;
  if (CONFLICT_DOCS.has(name)) {
    const r = mergeDocKeepConflicts(D[name], remote, BASE[name] || {}, validFor(name));
    changed = r.changed;
    for (const c of r.conflicts) {
      const id = 'c' + now().toString(36) + Math.random().toString(36).slice(2, 6);
      const when = new Date(c.ts).toLocaleString('zh-CN', { hour12: false });
      setKey(D.cards, id, { t: `**冲突副本**（${c.side === 'local' ? '这台设备' : '另一台设备'} ${when} 的版本，阶段文档已采用较新的那份；确认后可以删掉这张卡片）\n\n${String(c.value).slice(0, 19000)}`, at: c.k, c: now() }, now());
    }
    if (r.conflicts.length) { persist('cards'); emit('remote:cards'); conflictCount += r.conflicts.length; }
  } else changed = mergeDoc(D[name], remote, validFor(name));
  if (changed) { persist(name); emit('remote:' + name); }
  return changed;
}
// 上次同步成功时的修改时间，用来判断“两边都改过”
let BASE = {}, conflictCount = 0;
export const takeConflicts = () => { const n = conflictCount; conflictCount = 0; return n; };
export function markSynced() {
  for (const n of CONFLICT_DOCS) BASE[n] = { ...D[n].mt };
  kvSet('_base', BASE);
}
export const legacyMap = () => legacy;

/* ---------- 采用的学习方向 ---------- */
import { wasUsingBefore, adoptedList } from '../core/adopt.js';
// 老用户（改版前就有进度或笔记）第一次打开时，自动采用全部公共方向；新用户从空白开始
export function ensureAdopted(pubIds) {
  if (adoptedList(D)) return false;
  if (!wasUsingBefore(D)) return false;
  put('meta', 'adopted', pubIds.slice());
  return true;
}
export const adopted = () => adoptedList(D) || [];
export function setAdopted(id, on) {
  const cur = adopted().filter(x => x !== id);
  put('meta', 'adopted', on ? [...cur, id] : cur);
}
