// 学习路线网站 v2 入口：路由、导航、全局动作、同步。
import { $, esc, iso } from './util.js';
import { loadContent } from './content.js';
import * as M from './model.js';
import * as store from './store/index.js';
import * as gist from './store/gist.js';
import * as cloud from './store/cloud.js';
import { setupLive, loadOne } from './live.js';
import { act, bindActs, setRender, refresh, toast, pickBar } from './ui/kit.js';
import { renderHome } from './ui/home.js';
import { renderTrack, afterTrack } from './ui/track.js';
import { renderRoute, renderBiz, renderSuggestions, renderLater } from './ui/pages.js';
import { renderNotes, openQuick } from './ui/notes.js';
import { renderSettings, afterSettings } from './ui/settings.js';
import { renderImport, afterImport } from './ui/importui.js';
import { openAgent, closeAgent } from './ui/agentui.js';
import { openOnboard } from './ui/onboard.js';
import './ui/suggest.js';
import './ui/dragask.js';

/* ---------- 路由：#/  #/t/<方向>[/news][?s=阶段]  #/r/<路线>  #/notes[/<卡片>|/s/<阶段>]  #/biz  #/import  #/settings  #/later  #/suggestions ---------- */
function parse() {
  const h = location.hash.replace(/^#\/?/, '');
  const [path, qs] = h.split('?');
  const q = Object.fromEntries(new URLSearchParams(qs || ''));
  const seg = path.split('/').filter(Boolean).map(decodeURIComponent);
  return { seg, q };
}
async function render(opts = {}) {
  const { seg, q } = parse(), y = scrollY;
  const page = seg[0] || 'home';
  let html, after = () => {};
  document.documentElement.style.setProperty('--c', '#1B2430');
  try {
    if (page === 'home') html = renderHome();
    else if (page === 't') { html = renderTrack(seg[1], seg[2], q); after = () => afterTrack(seg[1], seg[2], q); }
    else if (page === 'r') html = renderRoute(seg.slice(1).join('/'));
    else if (page === 'notes') html = renderNotes(seg[1], { id: seg.slice(2).join('/') });
    else if (page === 'biz') html = renderBiz(q);
    else if (page === 'later') html = renderLater();
    else if (page === 'suggestions') { html = renderSuggestions(q); if (q.id) after = () => { const el = document.getElementById('sug-' + q.id); if (el) setTimeout(() => el.scrollIntoView({ block: 'center' }), 30); }; }
    else if (page === 'import') { html = renderImport(); after = afterImport; }
    else if (page === 'settings') { html = await renderSettings(); after = afterSettings; }
    else if (page === 'more') html = renderMore();
    else html = '<p class="empty">没有这个页面。<a href="#/">回到工作台</a></p>';
  } catch (e) {
    console.error(e);
    html = `<p class="note">这个页面出错了：${esc(e.message)}。可以先回到<a href="#/">工作台</a>，或在设置里导出备份后刷新页面。</p>`;
  }
  $('#view').innerHTML = html;
  renderNav(page, seg);
  after();
  pickBar();
  if (opts.keepScroll) scrollTo(0, y); else if (!q.s) scrollTo(0, 0);
}
setRender(render);

/* ---------- 导航 ---------- */
function renderNav(page, seg) {
  const tid = page === 't' ? seg[1] : page === 'r' ? (M.route(seg[1]) || {}).track : null;
  const cur = (p, id) => ((p === page && (!id || id === tid)) ? 'page' : 'false');
  $('#side').innerHTML = `<div class="brand"><i></i>我的学习路线</div>
    <a class="nav" href="#/" aria-current="${cur('home')}">工作台</a>
    <a class="nav" href="#/notes" aria-current="${cur('notes')}">笔记</a>
    <a class="nav" href="#/biz" aria-current="${cur('biz')}">落地与商机</a>
    <a class="nav" href="#/later" aria-current="${cur('later')}">稍后读<span class="n">${Object.keys(store.all('later')).filter(id => !M.isRead(id)).length || ''}</span></a>
    <div class="gh">学习方向</div>
    ${M.tracks().map(t => { const st = M.state(t.id); return `<a class="nav" href="#/t/${t.id}" aria-current="${tid === t.id ? 'page' : 'false'}"><span class="dot" style="background:${t.color}"></span>${esc(t.name)}<span class="n">${st.doneStages}/${st.stages.length}</span></a>`; }).join('')}
    <a class="nav" href="#/import" aria-current="${cur('import')}" style="margin-top:4px"><span class="dot" style="background:none;border:1.5px dashed var(--faint)"></span>导入文档</a>
    <div class="ft"><a class="nav" href="#/settings" aria-current="${cur('settings')}">设置</a><p class="fnt small" id="syncState" style="padding:4px 10px"></p></div>`;
  const mt = page === 't' || page === 'r';
  $('#mtop').innerHTML = mt ? `<div class="chips">${M.tracks().map(t => `<a class="chip" href="#/t/${t.id}" aria-pressed="${tid === t.id}" style="text-decoration:none${tid === t.id ? `;background:${t.color};border-color:${t.color}` : ''}">${esc(t.short || t.name)}</a>`).join('')}</div>` : ({ home: '<b>今天</b>', more: '<b>我的</b>' }[page] || '');
  $('#mnav').innerHTML = `<a href="#/" aria-current="${cur('home')}"><b>◉</b>今天</a>
    <a href="#/t/${tid || UI().lastTrack || M.tracks()[0].id}" aria-current="${mt ? 'page' : 'false'}"><b><svg width="18" height="18" viewBox="0 0 18 18" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" aria-hidden="true"><path d="M3 4h12M3 9h7M3 14h10"/><circle cx="13" cy="9" r="1.6" fill="currentColor"/></svg></b>方向</a>
    <button class="plus" data-act="quick-note" aria-label="随手记"><b>＋</b></button>
    <button data-act="agent-open"><b>✦</b>Agent</button>
    <a href="#/more" aria-current="${['more', 'notes', 'biz', 'later', 'settings', 'import'].includes(page) ? 'page' : 'false'}"><b>☰</b>我的</a>`;
  if (tid) { UI().lastTrack = tid; store.saveUi(); }
  setSyncStatus();
}
const UI = () => store.ui();
function renderMore() {
  const cards = Object.keys(store.all('cards')).length, docs = Object.keys(store.all('notes')).length;
  const later = Object.keys(store.all('later')).filter(id => !M.isRead(id)).length;
  const row = (href, t, n) => `<a class="mi" href="${href}" style="text-decoration:none;display:flex"><b>${t}</b><span class="n" style="margin-left:auto;color:var(--faint)">${n}</span></a>`;
  return `<div class="card" style="margin-top:8px">${row('#/notes', '笔记', `${cards} 张卡片 · ${docs} 篇文档`)}${row('#/later', '稍后在电脑上读', later)}${row('#/biz', '落地与商机', M.C.biz.items.length)}${row('#/suggestions', '等你确认', '')}${row('#/import', '导入文档', '')}</div>
    <div class="card" style="margin-top:10px">${row('#/settings', '设置', 'AI 服务、花费、同步、备份')}</div>
    <p class="fnt small" style="margin-top:10px">阶段长文档和导入在电脑上操作更方便。</p>`;
}

/* ---------- 全局动作 ---------- */
act('read', el => {
  const id = el.dataset.id; if (M.isRead(id)) return;
  store.put('read', id, iso(new Date()));
  const li = el.closest('li'); if (li) li.classList.add('is-read');
  const b = li && li.querySelector('[data-act=toggle-read]'); if (b) b.textContent = '标为未读';
});
act('toggle-read', el => { const id = el.dataset.id; store.put('read', id, M.isRead(id) ? null : iso(new Date())); refresh(); });
act('read-all', el => {
  const list = M.unread(el.dataset.id || null); if (!list.length) return;
  const d = iso(new Date()); list.forEach(n => store.put('read', n.id, d)); refresh();
  toast(`已把 ${list.length} 条标为已读`, () => { list.forEach(n => store.put('read', n.id, null)); refresh(); });
});
act('later', el => {
  const id = el.dataset.id;
  if (store.get('later', id)) { store.put('later', id, null); refresh(); return; }
  const n = M.news().find(x => x.id === id); if (!n) return;
  store.put('later', id, { t: n.t.slice(0, 400), u: n.u, at: Date.now() }); refresh(); toast('已加入稍后读');
});
act('mark-wrong', el => { store.put('marks', el.dataset.id, 'wrong'); toast('已记下，下周的自动整理会参考'); });
act('qn-open', () => openQuick());
document.addEventListener('change', e => {
  const cb = e.target.closest && e.target.closest('input[data-done]');
  if (cb) { store.setDone(cb.dataset.done, cb.checked, iso(new Date())); M.invalidate(); setTimeout(() => refresh(), 120); }
});
document.addEventListener('click', e => {
  const rl = e.target.closest('[data-reload]');
  if (rl) { const { seg } = parse(); const t = M.track(seg[1]); if (t) loadOne(t, rl.dataset.reload, true); }
});

/* ---------- 同步 ---------- */
function setSyncStatus(msg) {
  const el = $('#syncState'); if (!el) return;
  if (msg) { el.textContent = msg; return; }
  if (cloud.signedIn()) el.textContent = cloud.error ? '云端同步失败' : '已登录 · 云端同步';
  else if (gist.enabled()) el.textContent = gist.error ? 'Gist 同步失败' : 'Gist 同步已开启';
  else el.textContent = '只保存在这台设备';
}
const syncNow = () => cloud.signedIn() ? cloud.syncNow() : gist.syncNow();

/* ---------- 启动 ---------- */
async function boot() {
  let C;
  try { C = await loadContent(); }
  catch (e) {
    $('#view').innerHTML = `<p class="note">内容没有加载出来：${esc(e.message)}。如果是直接双击打开的本地文件，请在仓库目录运行 <code>python3 -m http.server</code>，再打开 http://localhost:8000/ 。</p>`;
    return;
  }
  M.setContent(C);
  await store.init({ legacyMap: C.legacy, defaultTab: C.tracks[0].id, today: iso(new Date()) });
  cloud.setup(C.config);
  const linked = await cloud.consumeLink();
  setupLive(C, () => parse().seg[1]);
  bindActs();
  store.onChange(what => {
    M.invalidate();
    if (what.startsWith('remote:')) refresh();
    else { cloud.queueSync(); gist.queueSync(); }
  });
  gist.onStatus(setSyncStatus); cloud.onStatus(setSyncStatus);
  window.addEventListener('hashchange', () => render());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  await render();
  syncNow();
  if (linked) toast('已登录，正在同步');
  // 第一次使用：开局规划（可以跳过）
  if (!store.get('meta', 'onboarded') && !store.ui().obSeen && !location.hash.includes('settings')) setTimeout(() => openOnboard(), 400);
  if ('serviceWorker' in navigator && location.protocol === 'https:') {
    // 旧版缓存规则会让发布后的第一次打开仍是旧代码：新的缓存程序接管时自动刷新一次
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !window.__swReloaded) { window.__swReloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  }
}
boot();
export { closeAgent, openAgent };
