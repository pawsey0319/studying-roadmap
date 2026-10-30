// 学习路线网站 v2 入口（M0：功能与 v1 相同，代码按“界面 / 数据 / 公共内容”分层）。
import { $, $$, esc, link, iso, todayStart } from './util.js';
import { WEEKS, stageItemIds, trackItemIds, pct, countDone, curWeek, stageAt } from './core/progress.js';
import { groupByAge, byDateDesc } from './core/feed.js';
import { loadContent } from './content.js';
import * as store from './store/index.js';
import * as sync from './store/gist.js';
import { setupLive, loadLive, loadOne, LIVE } from './live.js';

const today = todayStart();
let C, T;  // 公共内容、板块列表
const UI = () => store.ui();
const cur = () => T.find(x => x.id === UI().tab) || T[0];
const week = () => curWeek(store.start(), today);

/* ---------- 顶部 26 周总图 ---------- */
function renderGantt() {
  const w = week(), done = store.done();
  $('#weekLabel').textContent = w < 1 ? '尚未开始' : w > WEEKS ? `已走完 ${WEEKS} 周` : `第 ${w} 周 / ${WEEKS}`;
  $('#startDate').value = store.start();
  $('#ticks').innerHTML = Array.from({ length: WEEKS }, (_, i) => `<span>${(i + 1) % 2 === 1 || i === WEEKS - 1 ? i + 1 : ''}</span>`).join('');
  const rows = T.map(t => {
    const segs = t.stages.map(s => {
      const p = Math.round(pct(done, stageItemIds(s)) * 100), now = w >= s.weeks[0] && w <= s.weeks[1];
      return `<span class="seg${now ? ' now' : ''}" style="grid-column:${s.weeks[0]}/${s.weeks[1] + 1}" title="${esc(s.title)}：完成 ${p}%"><i style="width:${p}%"></i><b>${esc(s.title)}</b></span>`;
    }).join('');
    const p = Math.round(pct(done, trackItemIds(t)) * 100);
    return `<button class="g-row" data-tab="${t.id}" style="--rc:${t.color}" aria-current="${UI().tab === t.id}">
      <span class="g-name">${esc(t.name)}</span><span class="g-bar">${segs}</span><span class="g-pct">${p}%</span></button>`;
  }).join('');
  const needle = w >= 1 && w <= WEEKS ? `<div class="needle-wrap"><span class="needle" style="left:calc(${(w - 0.5) / WEEKS * 100}% - 1px)" aria-hidden="true"></span></div>` : '';
  $('#gBody').innerHTML = rows + needle;
  const all = T.flatMap(trackItemIds), doneN = countDone(done, all);
  const nowStages = T.map(t => { const s = stageAt(t, w); return s ? `${t.short}：${s.title}（${t.hours} 小时）` : ''; }).filter(Boolean);
  $('#gFoot').innerHTML = `<span><strong>总进度 ${doneN}/${all.length}</strong> 个任务</span>` + (nowStages.length ? `<span>本周：${nowStages.map(esc).join('，')}</span>` : '');
}

/* ---------- 板块切换 ---------- */
function renderTabs() {
  $('#tabs').innerHTML = T.map(t => `<button class="tab" role="tab" id="tab-${t.id}" data-tab="${t.id}" style="--tc:${t.color}" aria-selected="${UI().tab === t.id}" aria-controls="panel">${esc(t.name)}<small>每周 ${t.hours} 小时</small></button>`).join('');
}
function setTab(id, scroll) {
  UI().tab = id; store.saveUi();
  renderTabs(); renderGantt(); renderPanel();
  if (scroll) $('nav.tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
}

/* ---------- 阶段 ---------- */
function taskHtml(item) {
  const on = store.isDone(item.id);
  return `<label class="task${on ? ' on' : ''}"><input type="checkbox" data-k="${item.id}"${on ? ' checked' : ''}><span>${esc(item.text)}</span></label>`;
}
function stageHtml(s, w) {
  const ids = stageItemIds(s), done = store.done(), p = pct(done, ids), n = countDone(done, ids);
  const now = w >= s.weeks[0] && w <= s.weeks[1];
  const open = UI().open[s.id] ?? now;
  const res = s.resources.map(r => r.url ? `<li>${link(r.name, r.url)}</li>` : `<li class="nolink">${esc(r.name)}<em>（无链接，按名称查找）</em></li>`).join('');
  const tech = s.items.filter(i => i.kind === 'tech'), prod = s.items.filter(i => i.kind === 'prod');
  return `<li class="stage${p === 1 ? ' done' : ''}${now ? ' now' : ''}" data-open="${open}" data-sid="${s.id}">
    <div class="wk"><b>${s.weeks[0]}–${s.weeks[1]}</b>周</div>
    <div class="card">
      <button class="s-sum" data-open-key="${s.id}" aria-expanded="${open}">
        <h4>${esc(s.title)}</h4><span class="prog">${n}/${ids.length}${now ? ' · 进行中' : ''}</span><span class="chev" aria-hidden="true">›</span>
      </button>
      <div class="minibar"><i style="width:${p * 100}%"></i></div>
      <div class="s-body">
        <p class="s-goal">${esc(s.goal)}</p>
        <div class="cols">
          <div class="col"><h5>技术<span>${tech.length} 项</span></h5>${tech.map(taskHtml).join('')}</div>
          <div class="col"><h5>产品<span>${prod.length} 项</span></h5>${prod.map(taskHtml).join('')}</div>
        </div>
        <div class="res"><h5>学习资源</h5><ul>${res}</ul></div>
        <div class="out"><b>阶段产出</b>${esc(s.output)}</div>
        <div class="notes"><textarea data-note="${s.id}" placeholder="写下这一阶段的笔记、卡点或心得，自动保存">${esc(store.note(s.id))}</textarea></div>
      </div>
    </div></li>`;
}
const itemHtml = x => `<div class="card item"><h4>${esc(x.title)}</h4><p>${esc(x.desc)}</p>${x.links && x.links.length ? `<div class="links">${x.links.map(l => link(l.name, l.url)).join('')}</div>` : ''}</div>`;

/* ---------- 精选资讯 ---------- */
const TYPES = { news: '资讯', paper: '论文', dir: '新方向', biz: '商机' };
const LVL = { A: '一手来源', B: '权威媒体', C: '社区讨论' };
const LVL_TIP = { A: '官方发布、论文原文、监管机构或项目仓库', B: '权威媒体、研究机构或知名研究者', C: 'Reddit、Lobsters 等社区的高票讨论，只代表关注度，内容未经核实' };
const lvlBadge = l => l ? `<span class="lvl lvl-${String(l).toLowerCase()}" title="${esc(LVL_TIP[l] || '')}">${esc(LVL[l] || l)}</span>` : '';
const feedRow = x => `<li><time>${esc(x.d)}</time><div>
    <div class="ft"><span class="tag">${TYPES[x.type] || '资讯'}</span>${link(x.t, x.u)}</div>
    <div class="fs">${esc(x.s)}</div>
    <div class="fsrc">${lvlBadge(x.lvl)}<span>${esc(x.src || '')}</span></div></div></li>`;
function feedHtml(t) {
  const f = UI().filter[t.id] || 'all';
  const all = C.feed.items.filter(x => x.k === t.id);
  const items = all.filter(x => f === 'all' || x.type === f).sort(byDateDesc);
  const chips = ['all', ...Object.keys(TYPES)].map(k => {
    const n = k === 'all' ? all.length : all.filter(x => x.type === k).length;
    return `<button class="chip" data-filter="${k}" aria-pressed="${f === k}">${k === 'all' ? '全部' : TYPES[k]} ${n}</button>`;
  }).join('');
  if (!items.length) return `<div class="feedbar">${chips}</div><div class="feed-groups"><p class="fs">这个分类暂时没有条目。每周一的自动更新会补充新内容。</p></div>`;
  const groups = groupByAge(items, today).map(g => {
    const key = `${t.id}.${g.id}`, open = UI().open['feed.' + key] ?? g.open;
    return `<details class="fgroup" data-gkey="${key}"${open ? ' open' : ''}><summary><span>${g.name}</span><small>${g.items.length} 条</small></summary><ul class="feed">${g.items.map(feedRow).join('')}</ul></details>`;
  }).join('');
  return `<div class="feedbar">${chips}</div><div class="feed-groups">${groups}</div>`;
}

/* ---------- 官方博客、媒体与社区快照 ---------- */
function snapAll() {
  const a = (C.sources && C.sources.items) || [], c = (C.community && C.community.items) || [];
  const seen = new Set();
  return [...c, ...a].filter(x => !seen.has(x.u) && seen.add(x.u)).sort(byDateDesc);
}
function snapHtml(t) {
  const H = C.sources, CM = C.community, U = UI();
  if (!H && !CM) return `<p class="msg">还没有快照。推送到 GitHub 后每天自动生成；本地预览可在仓库目录运行 <code>python3 tools/fetch_sources.py</code>。</p>`;
  const lvF = U.snapLvl[t.id] || 'all', srcF = U.snapSrc[t.id] || 'all';
  const ALL = snapAll(), base = ALL.filter(x => x.k.includes(t.id));
  const its = base.filter(x => lvF === 'all' || x.lvl === lvF);
  const names = [...new Set(its.map(x => x.src))];
  const shown = its.filter(x => srcF === 'all' || x.src === srcF);
  const limit = U.snapMore[t.id] ? 60 : 12;
  const sel = `<select data-snapsrc aria-label="按来源筛选"><option value="all">全部来源（${its.length}）</option>${names.map(n =>
    `<option value="${esc(n)}"${n === srcF ? ' selected' : ''}>${esc(n)}（${its.filter(x => x.src === n).length}）</option>`).join('')}</select>`;
  const rows = shown.slice(0, limit).map(x => `<li><time>${esc(x.d.slice(5))}</time><div>${lvlBadge(x.lvl)}<span class="ssrc">${esc(x.src)}</span>${link(x.t, x.u)}</div></li>`).join('');
  const more = shown.length > limit ? `<button class="btn" data-snapmore>显示更多（共 ${shown.length} 条）</button>` : (limit > 12 && shown.length > 12 ? `<button class="btn" data-snapmore>收起</button>` : '');
  const lvls = ['all', 'A', 'B', 'C'].map(l => `<button class="chip" data-snaplvl="${l}" aria-pressed="${lvF === l}">${l === 'all' ? '全部' : LVL[l]} ${l === 'all' ? base.length : base.filter(x => x.lvl === l).length}</button>`).join('');
  return `<div class="snapbar">${lvls}${sel}<span class="msg">${H ? `官方与媒体快照 ${esc(H.updated)}（每天自动）` : ''}${CM ? `；Reddit 与 Hacker News ${esc(CM.updated)}（每周更新时抓取）` : '；Reddit 与 Hacker News 将在下次每周更新时加入'}</span></div>
    ${rows ? `<ul class="snap">${rows}</ul>` : `<p class="msg snapempty">${lvF === 'C' ? '这一周没有抓到与本板块相关的社区讨论。Reddit 和 Hacker News 在每周资讯更新时由 AI 助手抓取（Reddit 会拦截 GitHub 的云服务器）。' : '这个来源近期没有与本板块相关的内容。'}</p>`}${more}`;
}

/* ---------- 板块正文 ---------- */
function renderPanel() {
  const t = cur(), w = week();
  document.documentElement.style.setProperty('--c', t.color);
  $('#panel').setAttribute('aria-labelledby', 'tab-' + t.id);
  const p = Math.round(pct(store.done(), trackItemIds(t)) * 100);
  $('#panel').innerHTML = `
    <div class="panel-head"><div><h2>${esc(t.name)}</h2><p>${esc(t.goal)}</p></div><div class="stat"><b>${p}%</b>本板块完成度</div></div>
    ${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}
    <div class="jump"><a href="#b-route">学习路线</a><a href="#b-live">实时动态</a><a href="#b-feed">精选资讯与论文</a><a href="#b-front">前沿方向</a><a href="#b-biz">落地与商机</a></div>
    <section class="blk" id="b-route"><h3>学习路线</h3><p class="sub">每个阶段分技术和产品两列任务，勾选即记录进度；当前周所在阶段会自动展开。</p>
      <ol class="stages">${t.stages.map(s => stageHtml(s, w)).join('')}</ol></section>
    <section class="blk" id="b-live"><h3>实时动态</h3><p class="sub">上面 6 个渠道在打开页面时直接从公开接口拉取（1 小时内用缓存），下面的快照里，官方博客、权威媒体、量化研究博客由 GitHub 每天北京时间 8 点抓取；Reddit 和 Hacker News 的高票讨论在每周资讯更新时由 AI 助手抓取（Reddit 会拦截 GitHub 的云服务器）。标签说明来源类型：一手来源指官方或项目原始发布；社区讨论和社区热度只代表关注度，内容未经核实。</p>
      <div class="live">${LIVE.map(c => `<div class="card"><h4><span>${esc(c.name)}<em class="kind">${esc(c.kind)}</em></span><button data-reload="${c.id}" aria-label="刷新${esc(c.name)}">刷新</button></h4><div id="live-${c.id}" class="msg">加载中…</div></div>`).join('')}</div>
      <div class="card snapcard"><h4 class="snaph">官方博客、权威媒体与社区讨论</h4><div id="snap">${snapHtml(t)}</div></div></section>
    <section class="blk" id="b-feed"><h3>精选资讯与论文</h3><p class="sub">逐条打开原文核对过日期和内容，只收一手来源和权威媒体。最近 30 天默认展开，更早的折叠起来。最后更新：${esc(C.feed.updated)}。</p>${feedHtml(t)}</section>
    <section class="blk" id="b-front"><h3>前沿方向</h3><p class="sub">学完路线后值得继续深入的方向。</p><div class="grid2">${t.frontier.map(itemHtml).join('')}</div></section>
    <section class="blk" id="b-biz"><h3>落地与商机</h3><p class="sub">AI 真正落地的机会：新出现的商机，以及老业务怎么用 AI 改造。</p>
      <div class="biz"><div><h4 class="cap">新商机</h4>${t.biz.fresh.map(itemHtml).join('')}</div><div><h4 class="cap">老商机改造</h4>${t.biz.old.map(itemHtml).join('')}</div></div></section>`;
  loadLive(t, false);
}
const renderSnap = () => { const el = $('#snap'); if (el) el.innerHTML = snapHtml(cur()); };
function renderFeedOnly() {
  const sec = $('#b-feed');
  sec.querySelector('.feedbar').remove(); sec.querySelector('.feed-groups').remove();
  sec.insertAdjacentHTML('beforeend', feedHtml(cur()));
}
function refreshCounts() {
  const t = cur(), done = store.done();
  $$('#panel .stage').forEach(li => {
    const s = t.stages.find(x => x.id === li.dataset.sid), ids = stageItemIds(s), n = countDone(done, ids);
    li.querySelector('.minibar i').style.width = (n / ids.length * 100) + '%';
    li.querySelector('.prog').firstChild.textContent = `${n}/${ids.length}${li.classList.contains('now') ? ' · 进行中' : ''}`;
    li.classList.toggle('done', n === ids.length);
  });
  $('#panel .stat b').textContent = Math.round(pct(done, trackItemIds(t)) * 100) + '%';
  renderGantt();
}
/* ---------- 交互 ---------- */
function bindEvents() {
  document.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) return setTab(tab.dataset.tab, tab.classList.contains('g-row'));
    const sum = e.target.closest('[data-open-key]');
    if (sum) {
      const li = sum.closest('.stage'), open = li.dataset.open !== 'true';
      li.dataset.open = open; sum.setAttribute('aria-expanded', open);
      UI().open[sum.dataset.openKey] = open; store.saveUi(); return;
    }
    const ch = e.target.closest('[data-filter]');
    if (ch) { UI().filter[UI().tab] = ch.dataset.filter; store.saveUi(); renderFeedOnly(); return; }
    const rl = e.target.closest('[data-reload]');
    if (rl) { loadOne(cur(), rl.dataset.reload, true); return; }
    const sl = e.target.closest('[data-snaplvl]');
    if (sl) { UI().snapLvl[UI().tab] = sl.dataset.snaplvl; UI().snapSrc[UI().tab] = 'all'; store.saveUi(); renderSnap(); return; }
    if (e.target.closest('[data-snapmore]')) { UI().snapMore[UI().tab] = !UI().snapMore[UI().tab]; store.saveUi(); renderSnap(); }
  });
  // 记住每个资讯时间分组的展开/折叠
  document.addEventListener('toggle', e => {
    const d = e.target;
    if (d.matches && d.matches('details[data-gkey]')) { UI().open['feed.' + d.dataset.gkey] = d.open; store.saveUi(); }
  }, true);
  document.addEventListener('change', e => {
    const cb = e.target.closest('input[data-k]');
    if (cb) {
      store.setDone(cb.dataset.k, cb.checked, iso(new Date()));
      cb.closest('.task').classList.toggle('on', cb.checked);
      refreshCounts(); return;
    }
    if (e.target.matches('select[data-snapsrc]')) { UI().snapSrc[UI().tab] = e.target.value; UI().snapMore[UI().tab] = false; store.saveUi(); renderSnap(); return; }
    if (e.target.id === 'startDate' && e.target.value) { store.setStart(e.target.value); renderGantt(); renderPanel(); }
  });
  let noteTimer;
  document.addEventListener('input', e => {
    const ta = e.target.closest('textarea[data-note]');
    if (!ta) return;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => store.setNote(ta.dataset.note, ta.value), 300);
  });

  /* 导出 / 导入 */
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify(store.exportData(), null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `学习进度-${iso(new Date())}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try { store.importData(JSON.parse(await f.text())); renderGantt(); renderPanel(); alert('已导入进度和笔记。'); }
    catch (err) { alert('导入失败：请选择本页面导出的 JSON 文件。'); }
    e.target.value = '';
  });

  /* 多设备同步 */
  $('#syncBtn').addEventListener('click', () => $('#syncDlg').showModal());
  $('#syncForm').addEventListener('submit', async e => {
    e.preventDefault();
    const act = e.submitter && e.submitter.value;
    if (act === 'off') { sync.disable(); $('#syncDlg').close(); return; }
    if (act !== 'save') { $('#syncDlg').close(); return; }
    const tok = $('#syncToken').value.trim();
    if (!sync.TOKEN_RE.test(tok)) { $('#syncHint').textContent = '令牌格式不对：应以 github_pat_ 或 ghp_ 开头。'; return; }
    sync.setToken(tok); $('#syncToken').value = ''; $('#syncHint').textContent = '';
    $('#syncDlg').close(); await sync.syncNow();
  });
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') sync.syncNow(); });
}
function setSyncStatus(msg) {
  const el = $('#syncState'); if (!el) return;
  if (msg) el.textContent = msg;
  else if (!sync.enabled()) el.textContent = '进度只保存在这台设备。设置同步后，其他设备打开网站会看到同样的进度和笔记。';
  else if (sync.error) el.textContent = '同步失败：' + sync.error;
  else el.textContent = sync.lastSync() ? `已同步，最后一次 ${new Date(sync.lastSync()).toLocaleString('zh-CN', { hour12: false })}` : '已开启同步';
  $('#syncBtn').textContent = sync.enabled() ? '同步设置' : '设置多设备同步';
}

/* ---------- 启动 ---------- */
async function boot() {
  try { C = await loadContent(); }
  catch (e) {
    $('#panel').innerHTML = `<p class="note">内容没有加载出来：${esc(e.message)}。如果是直接双击打开的本地文件，请在仓库目录运行 <code>python3 -m http.server</code>，再打开 http://localhost:8000/ 。</p>`;
    return;
  }
  T = C.tracks;
  await store.init({ legacyMap: C.legacy, defaultTab: T[0].id, today: iso(today) });
  setupLive(C, () => UI().tab);
  bindEvents();
  // 本地修改 → 排队同步；同步拉到其他设备的修改 → 重画页面
  store.onChange(what => { if (what.startsWith('remote:')) { renderGantt(); renderPanel(); } else sync.queueSync(); });
  sync.onStatus(msg => setSyncStatus(msg));
  $('#feedInfo').textContent = `精选资讯更新于 ${C.feed.updated}，共 ${C.feed.items.length} 条` + (C.sources ? `；官方与媒体快照更新于 ${C.sources.updated}` : '') + '。';
  renderTabs(); renderGantt(); renderPanel();
  setSyncStatus();
  sync.syncNow();
}
boot();
