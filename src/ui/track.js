// 方向页：“路线”标签（理论路线 + 前沿路线并排）和“资讯动态”标签（实时动态 / 官方媒体与社区 / 精选资讯）
import { esc, iso } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { stageStatus } from '../core/progress.js';
import { groupByAge } from '../core/feed.js';
import { uid } from '../core/ids.js';
import { act, refresh, toast, newsRow, resLink, TYPES, LVL, lvlTag, PICK } from './kit.js';
import { applyToStage } from './suggest.js';
import { LIVE, loadLive } from '../live.js';

/* ---------- 理论阶段 ---------- */
function itemRow(i, s) {
  const on = store.isDone(i.id) || s.mastered;
  const cls = ['it', on && !i.skipped ? 'on' : '', i.skipped ? 'skip' : ''].join(' ');
  const badge = i.added ? `<span class="tag ${i.ai ? 'ai' : 'mine'}">${i.ai ? 'Agent 加的' : '你加的'}</span> ` : i.edited ? '<span class="tag mine">已改写</span> ' : '';
  return `<div class="${cls}"><input type="checkbox" data-done="${i.id}"${on ? ' checked' : ''}${i.skipped || s.mastered ? ' disabled' : ''} aria-label="完成">
    <span class="tx">${badge}${esc(i.text)}</span>
    <span class="ops">${i.skipped ? `<button data-act="unskip" data-s="${s.id}" data-id="${i.id}">恢复</button>`
      : `<button data-act="skip" data-s="${s.id}" data-id="${i.id}" title="这一项你已经会了，不计入进度；随时可以恢复">跳过</button>`}
      ${i.added ? `<button data-act="remove-item" data-s="${s.id}" data-id="${i.id}">删除</button>` : ''}</span></div>`;
}

export function stageCard(t, s, idx, cur, openId) {
  const k = stageStatus(s, cur), open = store.ui().open[s.id] ?? (s.id === openId || k === 'now');
  const theory = s.items.filter(i => i.mode !== 'practice'), prac = s.items.filter(i => i.mode === 'practice');
  const skipped = s.items.filter(i => i.skipped).length;
  const notes = Object.values(store.all('cards')).filter(c => c.at === s.id).length + (store.note(s.id) ? 1 : 0);
  const pg = k === 'mastered' ? '你标为已掌握' : k === 'done' ? '已学完' : `${s.prog.n}/${s.prog.total}${k === 'now' ? ' · 在学' : ''}`;
  return `<li class="stg ${k}" data-open="${open}" data-sid="${s.id}" id="st-${s.id.replace(/\./g, '-')}">
    <span class="no" aria-hidden="true">${idx}</span>
    <div class="card"><button class="hd" data-act="toggle-stage" data-id="${s.id}" aria-expanded="${open}">
        <h4>${esc(s.title)}</h4>${s.personalized ? '<span class="tag ai">已个性化</span>' : ''}${s.imported ? '<span class="tag mine">导入</span>' : ''}<span class="pg">${pg}</span><span class="chev">›</span></button>
      <div class="bar"><i style="width:${Math.round(s.prog.pct * 100)}%"></i></div>
      <div class="bd">
        ${s.mastered ? `<div class="pbar"><b>你标为已掌握</b><span>这个阶段不计入待学，所有任务按完成计算。</span><span class="sp"><button class="btn sm" data-act="unmaster" data-id="${s.id}">恢复为未掌握</button></span></div>` : ''}
        ${s.personalized && !s.mastered ? `<div class="pbar"><b>已个性化</b><span>${skipped ? `跳过了 ${skipped} 项` : ''}${s.goalEdited ? ' 目标已调整' : ''}</span><span class="sp"><button class="btn sm gh" data-act="reset-stage" data-id="${s.id}">恢复原版</button></span></div>` : ''}
        <p class="goal">${s.goalEdited ? `<span class="was">${esc(M.track(t.id).stages.find(x => x.id === s.id)?.goal || '')}</span>` : ''}${esc(s.goal)}</p>
        <div class="items">${theory.map(i => itemRow(i, s)).join('')}</div>
        ${prac.length ? `<div class="prac"><b>实践验证</b>${prac.map(i => itemRow(i, s)).join('')}</div>` : ''}
        <form class="addit" data-addfor="${s.id}"><input name="t" placeholder="加一项自己的任务（以“写、做、搭、跑通…”开头会归到实践验证）" aria-label="新增任务"><button class="btn sm">添加</button></form>
        ${s.resources.length ? `<div class="res"><b>学习资源</b><ul>${s.resources.map(r => `<li class="${r.url ? '' : 'nolink'}">${resLink(r)}${r.ai ? ' <span class="tag ai">AI 推荐，未核实</span>' : r.added ? ' <span class="tag mine">你加的</span>' : ''}</li>`).join('')}</ul></div>` : ''}
        ${s.output ? `<div class="out"><b>阶段产出</b>${esc(s.output)}</div>` : ''}
        <div class="sa"><button class="btn sm acc" data-act="agent-adjust" data-id="${s.id}">和 Agent 调整这个阶段</button>
          <button class="btn sm" data-act="agent-check" data-id="${s.id}">根据笔记检查</button>
          <a class="btn sm gh" href="#/notes/s/${encodeURIComponent(s.id)}">笔记 ${notes}</a>
          <button class="btn sm gh" data-act="quick-note" data-id="${s.id}">随手记</button>
          ${s.mastered ? '' : `<button class="btn sm gh" data-act="master" data-id="${s.id}">标为已掌握</button>`}</div>
      </div></div></li>`;
}

export function routeCard(r) {
  const n = M.routeNews(r.id), nw = M.routeHasNew(r.id), from = M.findStage(r.from);
  const last = n[0] ? n[0].d : '';
  const dots = Array.from({ length: Math.min(n.length, 6) }, (_, i) => `<i class="${i === Math.min(n.length, 6) - 1 ? 'h' : ''}"></i>`).join('');
  return `<a class="card fr${r.stopped ? ' stopped' : ''}" href="#/r/${encodeURIComponent(r.id)}">
    <h4>${esc(r.title)} ${nw ? '<span class="newp">新</span>' : ''}${r.follow ? '<span class="tag fr">跟踪学习中</span>' : ''}${r.stopped ? '<span class="tag">已停止跟踪</span>' : ''}</h4>
    <p>${esc(r.desc)}</p>
    <div class="tl">${dots}<span>${n.length} 条进展${last ? ' · 最近 ' + esc(last.slice(5) || last) : ''}${from ? ' · 从理论阶段 ' + (M.state(r.track).stages.indexOf(from.s) + 1) + ' 分出' : ''}</span></div></a>`;
}

function routeTab(t, q) {
  const st = M.state(t.id), rs = M.routes(t.id);
  rs.sort((a, b) => (a.stopped - b.stopped) || (M.routeHasNew(b.id) - M.routeHasNew(a.id)) || (M.routeNews(b.id).length - M.routeNews(a.id).length));
  return `<div class="dual">
    <div><div class="colh"><b>理论路线</b>按内容的先后顺序排列，基础打牢后基本不变</div>
      <ol class="stages">${st.stages.map((s, i) => stageCard(t, s, i + 1, st.current, q.s)).join('')}</ol></div>
    <div><div class="colh"><b>前沿路线</b>根据资讯自动整理，持续更新</div>
      ${rs.map(routeCard).join('') || '<div class="card empty">这个方向还没有整理出前沿路线。</div>'}
      <p class="fnt small">每天按关键词把新资讯归到路线上，每周一由 AI 合并、命名、拆分。进展少于 2 条的话题先不成路线。</p></div></div>`;
}

/* ---------- 资讯动态 ---------- */
function newsTab(t) {
  const U = store.ui();
  const all = M.news().filter(n => n.k.includes(t.id) && !M.isHidden(n.id));
  const curated = all.filter(n => n.kind === 'curated');
  const snap = all.filter(n => n.kind === 'snap');
  // 官方、媒体与社区
  const lvF = U.snapLvl[t.id] || 'all', srcF = U.snapSrc[t.id] || 'all', onlyU = U.onlyUnread && U.onlyUnread[t.id];
  const sBase = snap.filter(n => !onlyU || !M.isRead(n.id));
  const sLv = sBase.filter(n => lvF === 'all' || n.lvl === lvF), names = [...new Set(sLv.map(n => n.src))];
  const sShown = sLv.filter(n => srcF === 'all' || n.src === srcF), limit = U.snapMore[t.id] ? 80 : 12;
  const H = M.C.sources, CM = M.C.community;
  // 精选
  const f = U.filter[t.id] || 'all';
  const cItems = curated.filter(n => (f === 'all' || n.type === f) && (!onlyU || !M.isRead(n.id)));
  const groups = groupByAge(cItems, M.today).map(g => {
    const key = `${t.id}.${g.id}`, open = U.open['feed.' + key] ?? g.open;
    return `<details class="fgroup" data-gkey="${key}"${open ? ' open' : ''}><summary>${g.name}<small>${g.items.length} 条</small></summary><ul class="nlist">${g.items.map(n => newsRow(n)).join('')}</ul></details>`;
  }).join('');
  return `<div class="sh" style="margin-top:14px"><span class="mut small">标题前有黄点的是未读，点开标题或点“标为已读”后变灰；属于某条前沿路线的会标出路线名。</span>
      <span class="r"><button class="chip" data-act="${PICK.on ? 'pick-cancel' : 'pick-start'}" aria-pressed="${PICK.on}" title="勾选几条你觉得有关联的资讯，让 Agent 讲清楚它们之间的关系">${PICK.on ? '退出多选' : '多选解析'}</button><button class="chip" data-act="only-unread" data-id="${t.id}" aria-pressed="${!!onlyU}">只看未读</button><button class="btn sm gh" data-act="read-all" data-id="${t.id}">本方向全部标为已读</button></span></div>
    ${t.live ? `<div class="sh"><h3>实时动态</h3><span class="fnt small">打开页面时从公开接口直接拉取，1 小时内用缓存</span></div>
    <div class="live">${LIVE.map(c => `<div class="card"><h4><span>${esc(c.name)}<em>${esc(c.kind)}</em></span><button data-reload="${c.id}" aria-label="刷新${esc(c.name)}">刷新</button></h4><div id="live-${c.id}" class="msg">加载中…</div></div>`).join('')}</div>` : ''}
    <div class="sh"><h3>官方博客、权威媒体与社区讨论</h3><span class="fnt small">${H ? `每天 8 点更新（${esc(H.updated)}）` : '每天 8 点由 GitHub 自动抓取'}${CM ? `；Reddit 与 Hacker News 每周更新（${esc(CM.updated)}）` : ''}</span></div>
    <div class="snapbar">${['all', 'A', 'B', 'C'].map(l => `<button class="chip" data-act="snap-lvl" data-id="${l}" aria-pressed="${lvF === l}">${l === 'all' ? '全部' : LVL[l]} ${l === 'all' ? sBase.length : sBase.filter(n => n.lvl === l).length}</button>`).join('')}
      <select data-snapsrc aria-label="按来源筛选"><option value="all">全部来源（${sLv.length}）</option>${names.map(nm => `<option value="${esc(nm)}"${nm === srcF ? ' selected' : ''}>${esc(nm)}（${sLv.filter(n => n.src === nm).length}）</option>`).join('')}</select></div>
    <div class="card"><ul class="nlist">${sShown.slice(0, limit).map(n => newsRow(n, {})).join('') || `<li><span></span><div class="fnt">${H || CM ? '这个筛选下没有内容。' : '还没有快照。推送到 GitHub 后每天自动生成。'}</div><span></span></li>`}</ul>
      ${sShown.length > limit ? `<button class="btn gh" style="margin:6px 10px" data-act="snap-more">显示更多（共 ${sShown.length} 条）</button>` : limit > 12 && sShown.length > 12 ? '<button class="btn gh" style="margin:6px 10px" data-act="snap-more">收起</button>' : ''}</div>
    <div class="sh"><h3>精选资讯与论文</h3><span class="fnt small">一手来源和权威媒体，逐条核对过链接和日期；标“AI 整理”的由每周自动任务整理。最后更新 ${esc(M.C.feed.updated)}</span></div>
    <div class="chips" style="margin-bottom:6px">${['all', ...Object.keys(TYPES)].map(k => `<button class="chip" data-act="feed-filter" data-id="${k}" aria-pressed="${f === k}">${k === 'all' ? '全部' : TYPES[k]} ${k === 'all' ? curated.length : curated.filter(n => n.type === k).length}</button>`).join('')}</div>
    <div>${groups || '<p class="empty">这个分类暂时没有条目。</p>'}</div>`;
}

export function renderTrack(id, sub, q) {
  const t = M.track(id);
  if (!t) return `<p class="empty">没有这个方向。<a href="#/">回到工作台</a></p>`;
  document.documentElement.style.setProperty('--c', t.color);
  const st = M.state(id), rs = M.routes(id);
  const html = `<div class="ph"><span class="sign"><b>${esc(t.name)}</b></span>
      <span class="mut">理论 ${st.doneStages}/${st.stages.length} · 前沿路线 ${rs.filter(r => !r.stopped).length} 条，${rs.filter(r => M.routeHasNew(r.id)).length} 条有新进展</span>
      <span class="r"><button class="btn" data-act="agent-track" data-id="${t.id}">和 Agent 规划这个方向</button></span></div>
    ${t.goal ? `<p class="lede">${esc(t.goal)}</p>` : ''}${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}
    <nav class="tabs" aria-label="方向内容"><a href="#/t/${id}" aria-current="${sub !== 'news' ? 'page' : 'false'}">路线</a><a href="#/t/${id}/news" aria-current="${sub === 'news' ? 'page' : 'false'}">资讯动态</a></nav>
    ${sub === 'news' ? newsTab(t) : routeTab(t, q)}`;
  return html;
}
export function afterTrack(id, sub, q) {
  if (sub === 'news' && M.track(id).live) loadLive(M.track(id), false);
  if (q.s) { const el = document.getElementById('st-' + q.s.replace(/\./g, '-')); if (el) el.scrollIntoView({ block: 'center' }); }
}

/* ---------- 动作 ---------- */
// 在阶段里操作后保持它展开，免得当前阶段变化时卡片突然收起
const keepOpen = id => { store.ui().open[id] = true; store.saveUi(); };
const curTrack = () => (location.hash.match(/^#\/t\/([^/?]+)/) || [])[1];
act('toggle-stage', el => {
  const li = el.closest('.stg'), open = li.dataset.open !== 'true';
  li.dataset.open = open; el.setAttribute('aria-expanded', open);
  store.ui().open[el.dataset.id] = open; store.saveUi();
});
act('skip', el => { keepOpen(el.dataset.s); const undo = applyToStage(el.dataset.s, [{ op: 'skip', id: el.dataset.id }]); refresh(); toast('已跳过，不计入进度', undo); });
act('unskip', el => { keepOpen(el.dataset.s); applyToStage(el.dataset.s, [{ op: 'unskip', id: el.dataset.id }]); refresh(); toast('已恢复'); });
act('remove-item', el => { keepOpen(el.dataset.s); const undo = applyToStage(el.dataset.s, [{ op: 'remove', id: el.dataset.id }]); refresh(); toast('已删除', undo); });
act('master', el => { keepOpen(el.dataset.id); const undo = applyToStage(el.dataset.id, [{ op: 'mastered' }]); refresh(); toast('已标为已掌握', undo); });
act('unmaster', el => { keepOpen(el.dataset.id); applyToStage(el.dataset.id, [{ op: 'unmastered' }]); refresh(); toast('已恢复为未掌握'); });
act('reset-stage', el => { keepOpen(el.dataset.id);
  const before = store.get('overlay', el.dataset.id);
  store.put('overlay', el.dataset.id, null); refresh();
  toast('已恢复原版', () => { store.put('overlay', el.dataset.id, before); refresh(); });
});
act('snap-lvl', el => { const t = curTrack(); const U = store.ui(); U.snapLvl[t] = el.dataset.id; U.snapSrc[t] = 'all'; store.saveUi(); refresh(); });
act('snap-more', () => { const t = curTrack(); const U = store.ui(); U.snapMore[t] = !U.snapMore[t]; store.saveUi(); refresh(); });
act('feed-filter', el => { store.ui().filter[curTrack()] = el.dataset.id; store.saveUi(); refresh(); });
act('only-unread', el => { const U = store.ui(); U.onlyUnread = U.onlyUnread || {}; U.onlyUnread[el.dataset.id] = !U.onlyUnread[el.dataset.id]; store.saveUi(); refresh(); });

document.addEventListener('submit', e => {
  const f = e.target.closest('form[data-addfor]'); if (!f) return;
  e.preventDefault();
  const text = f.t.value.trim(); if (!text) return;
  keepOpen(f.dataset.addfor);
  applyToStage(f.dataset.addfor, [{ op: 'add', text }]); refresh(); toast('已添加');
});
document.addEventListener('change', e => {
  if (e.target.matches('select[data-snapsrc]')) { const t = curTrack(); const U = store.ui(); U.snapSrc[t] = e.target.value; U.snapMore[t] = false; store.saveUi(); refresh(); }
});
document.addEventListener('toggle', e => {
  const d = e.target;
  if (d.matches && d.matches('details[data-gkey]')) { store.ui().open['feed.' + d.dataset.gkey] = d.open; store.saveUi(); }
}, true);
export const _iso = iso; export const _uid = uid;
