// 云端同步（Supabase，内测用）。不依赖 SDK，直接调它的 REST 接口。
// 公开配置在仓库根目录的 config.json：{ "supabaseUrl": "...", "supabaseAnonKey": "..." }（anon key 本来就是公开的，权限由行级安全规则控制）。
// 登录：邮箱验证码。数据：每个用户每份文档一行（表 docs，见 supabase/schema.sql），合并规则和 Gist 一样按修改时间取新。
import * as store from './index.js';
import { DOC_NAMES } from '../core/schema.js';
import { sameDoc } from '../core/doc.js';

const SKEY = 'learning-hub.cloud';
let CFG = null, S = {}, timer = null, syncing = false;
export let error = '';
const statusFns = new Set();
export const onStatus = fn => statusFns.add(fn);
const status = m => statusFns.forEach(fn => fn(m));
try { S = JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { S = {}; }
const save = () => { try { localStorage.setItem(SKEY, JSON.stringify(S)); } catch (e) {} };

export function setup(config) { CFG = config && config.supabaseUrl && config.supabaseAnonKey ? { url: config.supabaseUrl.trim().replace(/\/+$/, '').replace(/\/(rest|auth|functions)\/v1$/, ''), key: config.supabaseAnonKey, hosted: config.hostedAI === true } : null; }
// config.json 里写了 "hostedAI": true 才提供“内测提供”的模型（需要先部署 supabase/functions/ai）
export const hostedAI = () => !!(CFG && CFG.hosted);
export const available = () => !!CFG;
export const signedIn = () => !!(CFG && S.access);
export const email = () => S.email || '';
export const lastSync = () => S.last || 0;

async function call(path, opt = {}, auth = true) {
  const headers = { apikey: CFG.key, 'content-type': 'application/json', ...(opt.headers || {}) };
  if (auth && S.access) headers.authorization = 'Bearer ' + S.access;
  const r = await fetch(CFG.url + path, { ...opt, headers });
  const text = await r.text(); let j = null; try { j = text ? JSON.parse(text) : null; } catch (e) {}
  if (!r.ok) { const m = (j && (j.msg || j.message || j.error_description || j.error)) || text || r.status; const e = new Error(String(m)); e.status = r.status; throw e; }
  return j;
}

// 1. 发验证码。create_user:false = 只有被邀请过的邮箱能登录（内测邀请制）
export async function sendCode(addr) {
  await call('/auth/v1/otp?redirect_to=' + encodeURIComponent(location.origin + location.pathname), { method: 'POST', body: JSON.stringify({ email: addr, create_user: false }) }, false)
    .catch(e => { throw new Error(/signup|not allowed|not found/i.test(e.message) ? '这个邮箱还没有被邀请。内测期间需要管理员先在后台邀请。' : '发送失败：' + e.message); });
  S.pending = addr; save();
}
// 2. 用验证码换登录凭证
export async function verify(code) {
  const j = await call('/auth/v1/verify', { method: 'POST', body: JSON.stringify({ type: 'email', email: S.pending, token: String(code).trim() }) }, false)
    .catch(e => { throw new Error('验证码不对或已过期：' + e.message); });
  S = { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000, uid: j.user && j.user.id, email: j.user && j.user.email };
  save();
}
// 3. 邮件里点的是登录链接（默认模板只有链接、没有验证码）时，Supabase 会跳回网站并在地址 # 后面带上凭证
export async function consumeLink() {
  if (!CFG) return false;
  const h = location.hash.replace(/^#\/?/, '');
  if (!/(^|&)(access_token|error_description)=/.test(h)) return false;
  const q = new URLSearchParams(h);
  history.replaceState(null, '', location.pathname + location.search + '#/settings');
  if (q.get('error_description')) { error = '登录链接无效或已过期：' + q.get('error_description'); status(); return false; }
  S = { access: q.get('access_token'), refresh: q.get('refresh_token'), exp: Date.now() + (+q.get('expires_in') || 3600) * 1000 };
  try { const u = await call('/auth/v1/user'); S.uid = u.id; S.email = u.email; save(); return true; }
  catch (e) { S = {}; save(); error = '登录失败：' + e.message; status(); return false; }
}
// 内测模型代理（supabase/functions/ai）：用登录凭证调用，管理员的 Key 不经过浏览器
export async function aiEndpoint() {
  if (!CFG) throw new Error('这个网站没有接云端，不能用内测模型');
  if (!S.refresh) throw new Error('内测模型需要先登录：设置 → 账号与云端同步');
  await ensureToken();
  return { url: CFG.url + '/functions/v1/ai', headers: { apikey: CFG.key, authorization: 'Bearer ' + S.access } };
}
export async function aiInfo() {
  const ep = await aiEndpoint();
  const r = await fetch(ep.url, { headers: ep.headers });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) throw new Error(j.error || ('内测模型不可用（' + r.status + '）'));
  return j;
}
export function signOut() { S = {}; save(); status(); }

async function ensureToken() {
  if (!S.refresh) throw new Error('没有登录');
  if (Date.now() < (S.exp || 0) - 60000) return;
  const j = await call('/auth/v1/token?grant_type=refresh_token', { method: 'POST', body: JSON.stringify({ refresh_token: S.refresh }) }, false)
    .catch(e => { S = {}; save(); throw new Error('登录已过期，请重新登录'); });
  Object.assign(S, { access: j.access_token, refresh: j.refresh_token, exp: Date.now() + (j.expires_in || 3600) * 1000 }); save();
}

export async function syncNow() {
  if (!signedIn() || syncing) return;
  syncing = true; status('正在同步…');
  try {
    await ensureToken();
    const rows = await call(`/rest/v1/docs?select=name,data&user_id=eq.${S.uid}`);
    const remote = Object.fromEntries((rows || []).map(r => [r.name, r.data]));
    for (const n of DOC_NAMES) if (remote[n]) store.mergeRemote(n, remote[n]);
    const mine = store.docs(), up = [];
    for (const n of DOC_NAMES) {
      const empty = !Object.keys(mine[n].mt).length;
      if ((!remote[n] && !empty) || (remote[n] && !sameDoc(mine[n], remote[n]))) up.push({ user_id: S.uid, name: n, data: mine[n], updated_at: new Date().toISOString() });
    }
    if (up.length) await call('/rest/v1/docs?on_conflict=user_id,name', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify(up) });
    S.last = Date.now(); error = ''; save();
  } catch (e) { error = e.message || String(e); }
  syncing = false; status();
}
export function queueSync() { if (!signedIn()) return; clearTimeout(timer); timer = setTimeout(syncNow, 1500); }
