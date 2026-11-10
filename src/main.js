// 学习路线网站 v2 入口：路由、导航、全局动作、同步。
import { $, esc, iso } from './util.js';
import { loadContent, refreshLive } from './content.js';
import * as M from './model.js';
import * as store from './store/index.js';
import * as gist from './store/gist.js';
import * as cloud from './store/cloud.js';
import { setupFeedback } from './ai/feedback-client.js';
import { initNative, isNative, scheduleReminder } from './native.js';
import { checkUpdate } from './update.js';
import { initI18n, isEn, setLang } from './i18n.js';
import { addBoardButtons } from './ui/translate.js';
import { setupLive, loadOne } from './live.js';
import { act, bindActs, setRender, refresh, toast, pickBar } from './ui/kit.js';
import { renderHome } from './ui/home.js';
import { renderLearningSessions, afterLearningSessions } from './ui/learning-sessions.js';
import { renderTrack, afterTrack } from './ui/track.js';
import { renderRoute, renderBiz, renderSuggestions, renderLater, renderLibrary } from './ui/pages.js';
import { renderNotes, openQuick } from './ui/notes.js';
import { renderSettings, afterSettings, remindBody } from './ui/settings.js';
import { renderImport, afterImport } from './ui/importui.js';
import { renderSearch } from './ui/search.js';
import { renderMethod, beforeMethod } from './ui/method.js';
import { sweepSessions } from './ui/agentui.js';
import { openAgent, closeAgent } from './ui/agentui.js';
import { openOnboard } from './ui/onboard.js';
import './ui/suggest.js';
import './ui/dragask.js';
import './ui/export.js';
import './ui/reader.js';
import { renderPublic, beforePublic, reportDone, checkUpstream } from './ui/public.js';
import { renderMe } from './ui/me.js';
import './ui/routeedit.js';
import { renderChannels, loadUserNews, refreshChannels } from './ui/channels.js';
import { applyAppearance } from './ui/appearance.js';
import { stat } from './ui/me.js';
import { md } from './core/md.js';
// 隐私政策和用户协议：content/legal/*.md，用站内的安全 Markdown 渲染
async function renderLegal(name) {
  try { const r = await fetch(`content/legal/${name}.md`, { cache: 'no-cache' }); if (!r.ok) throw new Error(r.status); return `<div class="card" style="padding:16px 18px;margin-top:10px"><div class="md">${md(await r.text())}</div></div>`; }
  catch (e) { return '<p class="note">没有读到这份文件，请稍后再试。</p>'; }
}
import './ui/react.js';
import './ui/tabsort.js';
import './ui/floatwin.js';

/* ---------- 工作台里的工具：笔记、商机、稍后读等不再是侧栏的一级入口 ---------- */
const DESK_TABS = [['home', '概览'], ['notes', '笔记'], ['sessions', '学习记录'], ['later', '稍后读'], ['biz', '落地与商机'], ['suggestions', '待确认'], ['method', '学习方法'], ['library', '路线库'], ['import', '导入'], ['channels', '渠道']];
const DESK_PAGES = DESK_TABS.map(([k]) => k);
function deskBar(page) {
  return `<nav class="deskbar" aria-label="工作台工具"><span class="dk-t">工作台</span>${DESK_TABS.map(([k, n]) => `<a class="dk" href="${k === 'home' ? '#/' : '#/' + k}" aria-current="${page === k ? 'page' : 'false'}">${n}</a>`).join('')}</nav>`;
}

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
    else if (page === 'sessions') { html = await renderLearningSessions(); after = afterLearningSessions; }
    else if (page === 'biz') html = renderBiz(q);
    else if (page === 'later') html = renderLater();
    else if (page === 'library') html = renderLibrary();
    else if (page === 'tree') { location.replace('#/t/' + ((M.tracks()[0] || {}).id || '') + '/tree'); return; }
    else if (page === 'public') { await beforePublic(q); html = renderPublic(q); }
    else if (page === 'search') html = renderSearch(q);
    else if (page === 'method') { await beforeMethod(); html = renderMethod(q); if (q.g) after = () => { const el = document.getElementById('dg-' + q.g); if (el) el.scrollIntoView({ block: 'center' }); }; }
    else if (page === 'suggestions') { html = renderSuggestions(q); if (q.id) after = () => { const el = document.getElementById('sug-' + q.id); if (el) setTimeout(() => el.scrollIntoView({ block: 'center' }), 30); }; }
    else if (page === 'import') { html = renderImport(); after = afterImport; }
    else if (page === 'settings') { html = await renderSettings(); after = afterSettings; }
    else if (page === 'me' || page === 'more') html = renderMe();
    else if (page === 'channels') html = renderChannels();
    else if (page === 'legal' && seg.length === 2 && ['privacy', 'terms'].includes(seg[1])) html = await renderLegal(seg[1]);
    else html = '<p class="empty">没有这个页面。<a href="#/">回到工作台</a></p>';
  } catch (e) {
    console.error(e);
    html = `<p class="note">这个页面出错了：${esc(e.message)}。可以先回到<a href="#/">工作台</a>，或在设置里导出备份后刷新页面。</p>`;
  }
  document.body.dataset.page = page === 'more' ? 'me' : page;
  if (DESK_PAGES.includes(page)) html = deskBar(page) + html;
  $('#view').innerHTML = html;
  addBoardButtons($('#view'));
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
  const homeOn = ['home', ...DESK_PAGES].includes(page);
  $('#side').innerHTML = `<div class="brand"><i></i>我的学习路线</div>
    <a class="nav" href="#/" aria-current="${homeOn ? 'page' : 'false'}">工作台</a>
    <a class="nav" href="#/me" aria-current="${['me', 'more'].includes(page) ? 'page' : 'false'}">我的</a>
    <a class="nav" href="#/search" aria-current="${cur('search')}">搜索</a>
    ${cloud.supportsPublic() ? `<a class="nav" href="#/public" aria-current="${cur('public')}">公共区域</a>` : ''}
    <div class="gh">学习方向</div>
    ${M.tracks().map(t => { const st = M.state(t.id); return `<a class="nav" href="#/t/${t.id}" aria-current="${tid === t.id ? 'page' : 'false'}"><span class="dot" style="background:${t.color}"></span>${esc(t.name)}<span class="n">${st.doneStages}/${st.stages.length}</span></a>`; }).join('')}
    ${M.tracks().length ? '' : '<p class="fnt small" style="padding:2px 10px 6px">还没有方向</p>'}
    <a class="nav" href="#/library" aria-current="false" style="margin-top:4px"><span class="dot" style="background:none;border:1.5px dashed var(--faint)"></span>添加方向</a>
    <div class="ft"><button class="nav lang" data-act="lang" title="${isEn() ? '切换到中文' : 'Switch to English'}">${isEn() ? '中文' : 'English'}</button><a class="nav" href="#/settings" aria-current="${cur('settings')}">设置</a><p class="fnt small" id="syncState" style="padding:4px 10px"></p></div>`;
  const mt = page === 't' || page === 'r';
  const deskTitle = { home: '工作台', notes: '笔记', later: '稍后读', biz: '落地与商机', suggestions: '待确认', method: '学习方法', library: '路线库', import: '导入', channels: '资讯渠道' }[page];
  $('#mtop').innerHTML = mt ? `<div class="chips">${M.tracks().map(t => `<a class="chip" href="#/t/${t.id}" aria-pressed="${tid === t.id}" style="text-decoration:none${tid === t.id ? `;background:${t.color};border-color:${t.color};color:#fff` : ''}">${esc(t.short || t.name)}</a>`).join('')}</div>` : (deskTitle ? `<b>${deskTitle}</b>` : ({ search: '<b>搜索</b>' }[page] || ''));
  const ic = d => `<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${d}</svg>`;
  const domainHref = M.tracks().length ? '#/t/' + (tid && M.track(tid) ? tid : M.track(UI().lastTrack) ? UI().lastTrack : M.tracks()[0].id) : '#/library';
  const meOn = ['me', 'more', 'settings'].includes(page);
  $('#mnav').innerHTML = `<a href="#/" aria-current="${homeOn ? 'page' : 'false'}">${ic('<path d="M4 11 12 4l8 7"/><path d="M6 10v9h12v-9"/>')}<span>首页</span></a>
    <a href="${domainHref}" aria-current="${mt ? 'page' : 'false'}">${ic('<path d="M4 6h16M4 12h10M4 18h13"/><circle cx="19" cy="12" r="1.4" fill="currentColor"/>')}<span>领域</span></a>
    <button class="agent" data-act="agent-open" aria-label="学习 Agent">${ic('<path d="M12 3.5l1.9 4.6 4.6 1.9-4.6 1.9L12 16.5l-1.9-4.6L5.5 10l4.6-1.9z"/><path d="M18.5 15.5l.8 1.9 1.9.8-1.9.8-.8 1.9-.8-1.9-1.9-.8 1.9-.8z"/>')}</button>
    <a href="#/search" aria-current="${cur('search')}">${ic('<circle cx="11" cy="11" r="6"/><path d="m20 20-4.2-4.2"/>')}<span>搜索</span></a>
    <a href="#/me" aria-current="${meOn ? 'page' : 'false'}">${ic('<circle cx="12" cy="9" r="3.6"/><path d="M5 20c.8-3.6 3.6-5.4 7-5.4s6.2 1.8 7 5.4"/>')}<span>我的</span></a>`;
  if (tid) { UI().lastTrack = tid; store.saveUi(); }
  setSyncStatus();
}
const UI = () => store.ui();
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
act('lang', () => setLang(isEn() ? 'zh' : 'en'));
document.addEventListener('change', e => {
  const cb = e.target.closest && e.target.closest('input[data-done]');
  if (cb) { store.setDone(cb.dataset.done, cb.checked, iso(new Date())); if (cb.checked) stat('t'); M.invalidate(); setTimeout(() => refresh(), 120); }
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

const HOT_NAMES = [['cls', '财联社电报'], ['wallstreet', '华尔街见闻快讯'], ['jin10', '金十快讯'], ['xueqiu', '雪球热股']];

/* ---------- 启动 ---------- */
async function boot() {
  const stage = text => { window.__lhBootStage = text; };
  stage('读取公共内容与语言');
  let C;
  try { [C] = await Promise.all([loadContent(), initI18n()]); }
  catch (e) {
    $('#view').innerHTML = `<p class="note">内容没有加载出来：${esc(e.message)}。如果是直接双击打开的本地文件，请在仓库目录运行 <code>python3 -m http.server</code>，再打开 http://localhost:8000/ 。</p>`;
    return;
  }
  M.setContent(C);
  initNative();
  stage('打开本机学习数据库');
  await store.init({ legacyMap: C.legacy, defaultTab: C.tracks[0].id, today: iso(new Date()) });
  stage('初始化账号与渠道');
  applyAppearance();
  cloud.setup(C.config);
  setupFeedback(C.config);
  store.ensureAdopted(C.tracks.map(t => t.id));
  await loadUserNews(C);   // 自己添加的渠道上次读到的内容，先显示，后台再更新
  const linked = await cloud.consumeLink();
  setupLive(C, () => parse().seg[1]);
  // 云端的资讯和快讯：后台拉取，拿到后刷新（拉不到就用静态快照）
  cloud.pullPublic().then(r => {
    if (!r) return;
    if (Array.isArray(r.news) && r.news.length) C.cloudNews = r.news.map(x => ({ ...x, d: String(x.d).slice(0, 10) }));
    if (Array.isArray(r.hot) && r.hot.length) {
      const by = {};
      for (const x of r.hot) (by[x.source] = by[x.source] || []).push({ t: x.title, u: x.url, time: x.time });
      C.hot = { updated: String(r.hot[0].fetched_at).slice(0, 16).replace('T', ' '), sources: HOT_NAMES.map(([id, name]) => ({ id, name, items: by[id] || [] })), cloud: true };
    }
    const gh = Array.isArray(r.live) && r.live.find(x => x.k === 'github');
    if (gh && gh.data && (!C.github || gh.data.updated > C.github.updated)) C.github = gh.data;
    M.invalidate(); refresh();
  }).catch(() => {});
  bindActs();
  store.onChange(what => {
    M.invalidate();
    if (what.startsWith('remote:')) { store.ensureAdopted(C.tracks.map(t => t.id)); refresh(); }
    else { cloud.queueSync(); gist.queueSync(); if (what === 'progress') reportDone(); }
  });
  gist.onStatus(setSyncStatus); cloud.onStatus(setSyncStatus);
  window.addEventListener('hashchange', () => render());
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  stage('显示当前页面');
  await render();
  stage('完成');
  stat('o');
  // 直接打开“我的”时，统计行是在 stat('o') 之前渲染的；补一次刷新，今天才会算进“打开 N 天”
  if (parse().seg[0] === 'me' || parse().seg[0] === 'more') refresh();
  syncNow();
  // App：内容先用安装包里的，立刻显示；网站上有更新的在后台换上
  refreshLive(C).then(ch => { if (ch) { M.invalidate(); refresh(); } }).catch(() => {});
  refreshChannels(C).then(ch => { if (ch) { M.invalidate(); refresh(); } }).catch(() => {});
  // App：每次打开都按当前在学的阶段更新提醒内容
  // App：检查有没有新版本（6 小时最多查一次），有就弹出更新提示
  if (isNative()) setTimeout(() => checkUpdate().catch(() => {}), 2500);
  window.addEventListener('lh-toast', e => toast(e.detail));
  if (isNative()) store.localGet('remind').then(r => r && r.on && scheduleReminder(r, remindBody())).catch(() => {});
  if (linked) toast('已登录，正在同步');
  setTimeout(() => sweepSessions().catch(() => {}), 3000);
  setTimeout(() => checkUpstream().then(() => { if (Object.keys(store.ui().upstream || {}).length) refresh(); }).catch(() => {}), 4000);
  // 第一次使用：开局规划（可以跳过）
  if (!store.get('meta', 'onboarded') && !store.ui().obSeen && !location.hash.includes('settings') && new URLSearchParams(location.search).get('nostart') !== '1') setTimeout(() => openOnboard(), 400);
  if ('serviceWorker' in navigator && location.protocol === 'https:' && !isNative()) {
    // 旧版缓存规则会让发布后的第一次打开仍是旧代码：新的缓存程序接管时自动刷新一次
    const had = !!navigator.serviceWorker.controller;
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (had && !window.__swReloaded) { window.__swReloaded = true; location.reload(); } });
    navigator.serviceWorker.register('sw.js', { updateViaCache: 'none' }).then(r => r.update()).catch(() => {});
  }
}
boot();
export { closeAgent, openAgent };
