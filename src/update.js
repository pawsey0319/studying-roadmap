// App 内更新（只在安卓 App 里起作用）：
// 打开 App 时读 GitHub Releases 里最新一版的 version.json，比当前版本新就弹出更新提示（版本号、更新内容、大小）。
// 点“立即更新”在 App 里下载安装包（显示进度，核对 SHA-256），下载完交给系统安装器覆盖安装，数据都保留。
// 选“稍后”的话，同一个版本 24 小时内不再弹；设置页里随时可以“检查更新”。
import { $, esc } from './util.js';
import { isNative } from './native.js';
import { t } from './i18n.js';

export const VERSION_URL = 'https://github.com/pawsey0319/studying-roadmap/releases/latest/download/version.json';
const KEY = 'lh.update';
const plugin = name => { const c = window.Capacitor; return c && ((c.Plugins && c.Plugins[name]) || (c.registerPlugin && c.registerPlugin(name))); };
const memo = () => { try { return JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { return {}; } };
const save = v => { try { localStorage.setItem(KEY, JSON.stringify(v)); } catch (e) {} };

// 新版本信息是否可信、比当前新
export function isNewer(info, current) {
  return !!(info && Number.isInteger(info.versionCode) && info.versionCode > (current || 0) && /^https:\/\/github\.com\/[^/]+\/[^/]+\/releases\/download\//.test(info.url || '') && /^[0-9a-f]{64}$/i.test(info.sha256 || ''));
}
export async function currentVersion() {
  const app = plugin('App'); if (!app) return { code: 0, name: '' };
  try { const i = await app.getInfo(); return { code: parseInt(i.build, 10) || 0, name: i.version || '' }; } catch (e) { return { code: 0, name: '' }; }
}
async function latest() {
  const up = plugin('AppUpdate');
  const txt = up ? (await up.fetchText({ url: VERSION_URL + '?t=' + Date.now() })).text : await (await fetch(VERSION_URL, { cache: 'no-store' })).text();
  return JSON.parse(txt);
}

// 打开 App 时调用；manual 为 true 时（设置页“检查更新”）没有新版本也给个提示
export async function checkUpdate({ manual = false } = {}) {
  if (!isNative()) return null;
  const m = memo();
  if (!manual && m.checked && Date.now() - m.checked < 6 * 3600e3 && !m.pending) return null;   // 6 小时内检查过就不再请求
  let info, cur;
  try { [info, cur] = await Promise.all([latest(), currentVersion()]); }
  catch (e) { if (manual) toastMsg(t('检查更新失败：') + (e.message || e)); return null; }
  save({ ...m, checked: Date.now(), pending: isNewer(info, cur.code) ? info : null });
  if (!isNewer(info, cur.code)) { if (manual) toastMsg(t('已经是最新版本') + (cur.name ? ' ' + cur.name : '')); return null; }
  if (!manual && m.later && m.later.code === info.versionCode && Date.now() - m.later.t < 24 * 3600e3) return info;
  // 别的弹窗（开局规划等）开着时，等它关了再弹
  const wait = () => [...document.querySelectorAll('dialog[open]')].some(d => d.id !== 'upDlg');
  if (!manual && wait()) { const iv = setInterval(() => { if (!wait()) { clearInterval(iv); showDialog(info, cur); } }, 1000); return info; }
  showDialog(info, cur);
  return info;
}

let DL = null;
function dlg() { let d = $('#upDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'upDlg'; d.className = 'updlg'; document.body.appendChild(d); } return d; }
const mb = n => (n / 1048576).toFixed(1) + ' MB';
function showDialog(info, cur) {
  const d = dlg();
  d.innerHTML = `<div class="up"><h3>${esc(t('发现新版本'))} ${esc(info.versionName || '')}</h3>
    <p class="fnt small">${esc(t('当前版本'))} ${esc(cur.name || '')} · ${esc(info.date || '')} · ${mb(info.size || 0)}</p>
    ${info.notes ? `<div class="up-n">${esc(info.notes).replace(/\n/g, '<br>')}</div>` : ''}
    <div class="up-p" hidden><div class="up-bar"><i></i></div><span class="fnt small" id="upPct"></span></div>
    <p class="err small" id="upErr" hidden></p>
    <div class="up-f"><button class="btn gh" id="upLater">${esc(t('稍后'))}</button><button class="btn pri" id="upGo">${esc(t('立即更新'))}</button></div>
    <p class="fnt small">${esc(t('更新会覆盖安装，进度、笔记和设置都保留。'))}</p></div>`;
  d.querySelector('#upLater').onclick = async () => {
    if (DL) { const up = plugin('AppUpdate'); if (up) await up.cancel().catch(() => {}); }
    save({ ...memo(), later: { code: info.versionCode, t: Date.now() } }); d.close();
  };
  d.querySelector('#upGo').onclick = () => go(info);
  if (!d.open) d.showModal();
}

async function go(info) {
  const d = dlg(), up = plugin('AppUpdate'), btn = d.querySelector('#upGo'), err = d.querySelector('#upErr'), bar = d.querySelector('.up-p');
  err.hidden = true;
  if (!up) { window.open(info.url, '_system'); return; }   // 老版本 App 没有更新插件：用浏览器下载
  // 已经下载好的直接装
  const m = memo();
  if (m.file && m.file.code === info.versionCode) return install(m.file.path);
  btn.disabled = true; btn.textContent = t('正在下载…'); bar.hidden = false;
  const pct = d.querySelector('#upPct'), fill = d.querySelector('.up-bar i');
  const h = await up.addListener('progress', p => { const r = p.total > 0 ? p.loaded / p.total : 0; fill.style.width = Math.round(r * 100) + '%'; pct.textContent = `${mb(p.loaded)} / ${mb(p.total || info.size || 0)}`; });
  try {
    DL = up.download({ url: info.url, sha256: info.sha256, size: info.size });
    const r = await DL;
    fill.style.width = '100%'; pct.textContent = t('下载完成');
    save({ ...memo(), file: { code: info.versionCode, path: r.path } });
    btn.disabled = false; btn.textContent = t('安装');
    btn.onclick = () => install(r.path);
    await install(r.path);
  } catch (e) {
    err.textContent = t('下载失败：') + (e.message || e); err.hidden = false;
    btn.disabled = false; btn.textContent = t('重试'); bar.hidden = true;
  } finally { DL = null; h && h.remove && h.remove(); }
}

async function install(path) {
  const up = plugin('AppUpdate'), d = dlg(), err = d.querySelector('#upErr'), btn = d.querySelector('#upGo');
  try {
    const r = await up.install({ path });
    if (r.needPermission) {
      // 第一次：系统打开“安装未知应用”设置页，打开开关后回到 App，再点“安装”
      err.textContent = t('请在打开的设置页里允许“安装未知应用”，然后返回这里点“安装”。'); err.hidden = false;
      btn.textContent = t('安装'); btn.disabled = false; btn.onclick = () => install(path);
      const app = plugin('App');
      if (app) { const once = await app.addListener('resume', async () => { once.remove && once.remove(); const c = await up.canInstall().catch(() => ({ value: false })); if (c.value) install(path); }); }
    }
  } catch (e) { err.textContent = t('打开安装程序失败：') + (e.message || e); err.hidden = false; }
}

function toastMsg(m) { window.dispatchEvent(new CustomEvent('lh-toast', { detail: m })); }
