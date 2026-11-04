// 云端同步：账号登录 + 个人数据同步。后端（CloudBase 或 Supabase）由 backend.js 适配，这里只管流程。
// 数据：每个用户每份文档一行（表 docs）。合并在浏览器里做（每一项按修改时间取新），数据库只负责按用户隔离地存取。
// v3 补的三处：
//   1. 修改时间由服务端给：CloudBase 的触发器给每行写服务器时间和版本号；本机按服务器时间校准时钟，增量拉取按服务器时间。
//   2. 阶段长文档两边都改过时，较旧的一份另存为“冲突副本”卡片（store.mergeRemote）。
//   3. 公共区域不走这里，直接读写服务端（public.js）。
import * as store from './index.js';
import { DOC_NAMES } from '../core/schema.js';
import { sameDoc } from '../core/doc.js';
import { makeBackend, http } from './backend.js';

const SKEY = 'learning-hub.cloud';
let B = null, S = {}, timer = null, syncing = false, HOSTED = false;
export let error = '';
const statusFns = new Set();
export const onStatus = fn => statusFns.add(fn);
const status = m => statusFns.forEach(fn => fn(m));
try { S = JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { S = {}; }
const save = () => { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch (e) {} };

export function setup(config) {
  B = makeBackend(config);
  HOSTED = !!(B && B.kind === 'supabase' && config.hostedAI === true);
  // 换了后端（例如从 Supabase 搬到 CloudBase）：旧的登录凭证作废，需要重新登录
  if (B && S.kind && S.kind !== B.kind) { S = { kind: B.kind, migrated: true }; save(); }
  if (B && !S.kind) { S.kind = B.kind; save(); }
}
// config.json 里写了 "hostedAI": true 才提供“内测提供”的模型（需要先部署 supabase/functions/ai，只支持 Supabase）
export const hostedAI = () => HOSTED;
export const available = () => !!B;
export const backendName = () => (B ? B.label : '');
export const supportsPublic = () => !!(B && B.publicArea);
export const signedIn = () => !!(B && S.access);
export const email = () => S.email || '';
export const uid = () => S.uid || '';
export const lastSync = () => S.last || 0;
export const pendingEmail = () => (S.pending && S.pending.email) || '';
export const justMigrated = () => !!S.migrated;

// 1. 发验证码
export async function sendCode(addr) {
  if (!B) throw new Error('这个网站还没有接云端');
  S.pending = await B.sendCode(String(addr).trim()); save();
  return S.pending;
}
// 2. 用验证码登录（CloudBase：没有账号时自动注册）
export async function verify(code) {
  const s = await B.verify(code, S.pending);
  const wasMigrated = S.migrated;
  S = { ...s, kind: B.kind, pending: null, first: true, migrated: wasMigrated };
  save();
}
// 3. Supabase 的登录链接（邮件里只有链接时）：跳回网站后地址 # 后面带着凭证
export async function consumeLink() {
  if (!B || B.kind !== 'supabase') return false;
  const h = location.hash.replace(/^#\/?/, '');
  if (!/(^|&)(access_token|error_description)=/.test(h)) return false;
  const q = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + location.search + '#/settings');
  if (q.get('error_description')) { error = '登录链接无效或已过期：' + q.get('error_description'); status(); return false; }
  try {
    const access = q.get('access_token'), u = await B.user(access);
    S = { kind: B.kind, access, refresh: q.get('refresh_token'), exp: Date.now() + (+q.get('expires_in') || 3600) * 1000, uid: u.id, email: u.email, first: true };
    save(); return true;
  } catch (e) { S = { kind: B.kind }; save(); error = '登录失败：' + e.message; status(); return false; }
}
export function signOut() { S = { kind: B && B.kind }; save(); status(); }

export async function ensureToken() {
  if (!S.refresh) throw new Error('没有登录');
  if (Date.now() < (S.exp || 0) - 120000) return S.access;
  try { S = { ...S, ...(await B.refresh(S)) }; save(); }
  catch (e) { S = { kind: B.kind, email: S.email }; save(); throw new Error('登录已过期，请重新登录'); }
  return S.access;
}

/* ---------- 通用 REST（公共区域等也用这个） ---------- */
export async function rest(path, opt = {}) {
  const access = signedIn() ? await ensureToken() : null;
  const r = await http(B.rest + path, { ...opt, headers: { ...B.restHeaders(access), ...(opt.headers || {}) } });
  if (Number.isFinite(r.serverTime)) store.setSkew(r.serverTime - Date.now());
  return r.data;
}

/* ---------- 公共数据：云端的资讯和快讯（不用登录也能读） ---------- */
export async function pullPublic() {
  if (!B || B.kind !== 'cloudbase') return null;
  const since = new Date(Date.now() - 10 * 864e5).toISOString().slice(0, 10);
  const [news, hot] = await Promise.all([
    rest(`/news_items?select=d,src,lvl,k,t,s,u,via&d=gte.${since}&order=d.desc&limit=600`).catch(() => null),
    rest('/hot_items?select=source,title,url,time,rank,fetched_at&order=fetched_at.desc,rank.asc&limit=240').catch(() => null)
  ]);
  return { news, hot };
}

/* ---------- 同步 ---------- */
export async function syncNow() {
  if (!signedIn() || syncing) return;
  syncing = true; status('正在同步…');
  try {
    await ensureToken();
    // 增量拉取：只要上次以后在服务器上变过的文档（CloudBase 的 updated_at 由数据库给，不受设备时钟影响）
    const since = S.cursor && B.versioned ? `&updated_at=gt.${encodeURIComponent(S.cursor)}` : '';
    const rows = await rest(`/docs?select=name,data,updated_at${B.versioned ? ',rev' : ''}${B.kind === 'supabase' ? '&user_id=eq.' + S.uid : ''}${since}`) || [];
    const remote = Object.fromEntries(rows.map(r => [r.name, r.data]));
    for (const n of DOC_NAMES) if (remote[n]) store.mergeRemote(n, remote[n]);
    // 上传：增量拉取时没拉到的文档，用上次记下的内容指纹判断远端是否已经一样
    const mine = store.docs(), up = [], fp = S.fp || {};
    for (const n of DOC_NAMES) {
      const empty = !Object.keys(mine[n].mt).length;
      const same = remote[n] ? sameDoc(mine[n], remote[n]) : (since && fp[n] === finger(mine[n]));
      if (!empty && !same) up.push(B.versioned ? { name: n, data: mine[n] } : { user_id: S.uid, name: n, data: mine[n], updated_at: new Date().toISOString() });
    }
    let saved = [];
    if (up.length) saved = await rest('/docs?on_conflict=user_id,name', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=representation' }, body: JSON.stringify(up) }) || [];
    const stamps = rows.concat(saved || []).map(r => r.updated_at).filter(Boolean).sort();
    if (stamps.length) S.cursor = stamps[stamps.length - 1];
    for (const n of DOC_NAMES) fp[n] = finger(mine[n]);
    S.fp = fp; S.last = Date.now(); S.first = false; S.migrated = false; error = ''; save();
    store.markSynced();
    const c = store.takeConflicts();
    if (c) status(`有 ${c} 篇阶段文档在两台设备上都改过，较旧的版本已另存为“冲突副本”卡片`);
  } catch (e) { error = e.message || String(e); }
  syncing = false; status();
}
const finger = d => { const s = JSON.stringify(d.mt); let h = 0; for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0; return s.length + ':' + h; };
export function queueSync() { if (!signedIn()) return; clearTimeout(timer); timer = setTimeout(syncNow, 1500); }

/* ---------- 内测模型代理（只在 Supabase + hostedAI 时可用，见 supabase/functions/ai） ---------- */
export async function aiEndpoint() {
  if (!HOSTED) throw new Error('这个网站没有提供内测模型');
  if (!S.refresh) throw new Error('内测模型需要先登录：设置 → 账号与云端同步');
  await ensureToken();
  return { url: B.base + '/functions/v1/ai', headers: B.restHeaders(S.access) };
}
export async function aiInfo() {
  const ep = await aiEndpoint();
  const r = await fetch(ep.url, { headers: ep.headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('内测模型不可用（' + r.status + '）'));
  return j;
}
