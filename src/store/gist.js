// 私有 GitHub Gist 同步。令牌只存在本设备，只发给 api.github.com。
// v2 把个人数据分成多个文件，避免单个文件过大被截断：
//   lh2-progress.json（进度）、lh2-notes.json（笔记）。
// 如果 Gist 里只有 v1 的 learning-hub-progress.json，会先迁移再合并，v1 文件原样保留。
import * as store from './index.js';
import { migrateV1 } from './migrate.js';
import { sameDoc } from '../core/doc.js';

const SKEY = 'learning-hub.sync';
const V1_FILE = 'learning-hub-progress.json';
const FILES = { progress: 'lh2-progress.json', notes: 'lh2-notes.json' };

let Y;
try { Y = JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { Y = {}; }
const saveY = () => { try { localStorage.setItem(SKEY, JSON.stringify(Y)); } catch (e) {} };

export const enabled = () => !!Y.token;
export const lastSync = () => Y.last || 0;
export let error = '';
let syncing = false, timer = null;
const statusFns = new Set();
export const onStatus = fn => statusFns.add(fn);
const status = msg => statusFns.forEach(fn => fn(msg));

export const TOKEN_RE = /^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/;
export function setToken(tok) { Y = { token: tok }; saveY(); error = ''; }
export function disable() { Y = {}; saveY(); error = ''; status(); }

const gh = (path, opt = {}) => fetch('https://api.github.com' + path, Object.assign({}, opt, {
  headers: { Authorization: 'Bearer ' + Y.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }
})).then(async r => {
  if (r.status === 401) throw new Error('令牌无效或已过期，请重新设置');
  if (r.status === 403 || r.status === 404) throw new Error('令牌没有 Gist 读写权限，或同步文件已被删除');
  if (!r.ok) throw new Error('GitHub 返回 ' + r.status);
  return r.json();
});
const readFile = async f => !f ? null : JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);

export async function syncNow() {
  if (!Y.token || syncing) return;
  syncing = true; status('正在同步…');
  try {
    if (!Y.gist) {  // 第一次：先找已有的同步 Gist（其他设备或 v1 可能已经建过），找不到再新建
      const list = await gh('/gists?per_page=100');
      const g = list.find(x => x.files && (x.files[FILES.progress] || x.files[V1_FILE]));
      Y.gist = g ? g.id : (await gh('/gists', { method: 'POST', body: JSON.stringify({
        description: '学习路线网站的进度与笔记（自动同步，勿手改）', public: false,
        files: Object.fromEntries(Object.entries(FILES).map(([k, f]) => [f, { content: JSON.stringify(store.docs()[k]) }]))
      }) })).id;
      saveY();
    }
    const g = await gh('/gists/' + Y.gist);
    const files = g.files || {};
    const remote = {};
    for (const [k, f] of Object.entries(FILES)) remote[k] = await readFile(files[f]);
    if (!remote.progress && files[V1_FILE]) {  // 只有 v1 文件：迁移后当作远端数据合并
      const m = migrateV1(await readFile(files[V1_FILE]), store.legacyMap());
      remote.progress = m.progress; remote.notes = m.notes;
    }
    for (const k of Object.keys(FILES)) if (remote[k]) store.mergeRemote(k, remote[k]);
    const upd = {};
    const mine = store.docs();
    for (const [k, f] of Object.entries(FILES)) if (!files[f] || !sameDoc(mine[k], remote[k])) upd[f] = { content: JSON.stringify(mine[k]) };
    if (Object.keys(upd).length) await gh('/gists/' + Y.gist, { method: 'PATCH', body: JSON.stringify({ files: upd }) });
    Y.last = Date.now(); error = ''; saveY();
  } catch (e) { error = e.message || String(e); }
  syncing = false; status();
}

export function queueSync() { if (!Y.token) return; clearTimeout(timer); timer = setTimeout(syncNow, 1500); }
