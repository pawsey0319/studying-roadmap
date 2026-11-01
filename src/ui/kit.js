// 界面小工具：动作注册（事件委托）、提示条、通用片段。
import { $, esc, link } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';

/* ---------- 动作：<button data-act="名称" data-x="..."> ---------- */
const ACTS = {};
export const act = (name, fn) => { ACTS[name] = fn; };
export function bindActs(root = document) {
  root.addEventListener('click', e => {
    const el = e.target.closest('[data-act]');
    if (!el || el.disabled) return;
    const fn = ACTS[el.dataset.act];
    if (fn) { e.preventDefault(); fn(el, e); }
  });
}

/* ---------- 重画当前页面 ---------- */
let renderFn = () => {};
export const setRender = fn => { renderFn = fn; };
export function refresh() { M.invalidate(); renderFn({ keepScroll: true }); }

/* ---------- 提示条（可带撤销） ---------- */
let toastTimer;
export function toast(msg, undo) {
  let el = $('#toast');
  if (!el) { el = document.createElement('div'); el.id = 'toast'; el.className = 'toast'; el.setAttribute('role', 'status'); document.body.appendChild(el); }
  el.innerHTML = `<span>${esc(msg)}</span>${undo ? '<button type="button">撤销</button>' : ''}`;
  el.hidden = false;
  if (undo) el.querySelector('button').onclick = () => { el.hidden = true; undo(); };
  clearTimeout(toastTimer); toastTimer = setTimeout(() => { el.hidden = true; }, undo ? 6000 : 2600);
}

/* ---------- 通用片段 ---------- */
export const LVL = { A: '一手来源', B: '权威媒体', C: '社区讨论' };
const LVL_TIP = { A: '官方发布、论文原文、监管机构或项目仓库', B: '权威媒体、研究机构或知名研究者', C: '社区高票讨论，只代表关注度，内容未经核实' };
export const lvlTag = l => l ? `<span class="tag ${String(l).toLowerCase()}" title="${esc(LVL_TIP[l] || '')}">${esc(LVL[l] || l)}</span>` : '';
export const TYPES = { news: '资讯', paper: '论文', dir: '新方向', biz: '商机' };
export const trackTag = id => { const t = M.track(id); return t ? `<span class="tag" style="color:${t.color}">${esc(t.short || t.name)}</span>` : ''; };
export const routeTag = rid => `<a class="tag fr" href="#/r/${encodeURIComponent(rid)}">${esc(M.routeName(rid))}</a>`;

// 一条资讯。opts：showTrack 显示方向标签；compact 精简
export function newsRow(n, opts = {}) {
  const read = M.isRead(n.id) || !M.isFresh(n), later = !!store.get('later', n.id);
  const tags = [
    opts.showTrack ? n.k.map(trackTag).join('') : '',
    n.type ? `<span class="tag">${TYPES[n.type] || '资讯'}</span>` : '',
    lvlTag(n.lvl),
    ...(n.r || []).slice(0, 2).map(routeTag),
    M.related(n) ? '<span class="tag rel">和在学阶段相关</span>' : '',
    n.ai ? '<span class="tag ai" title="每周由免费模型整理，链接和日期已由程序核对">AI 整理</span>' : '',
    n.via ? `<span class="fnt">经 ${esc(n.via)}</span>` : ''
  ].join('');
  return `<li class="${read ? 'is-read' : ''}" data-nid="${n.id}"><span class="u" aria-label="${read ? '已读' : '未读'}"></span>
    <div><div class="tt"><a href="${esc(n.u)}" target="_blank" rel="noopener" data-act="read" data-id="${n.id}">${esc(n.t)}</a></div>
      ${n.s && !opts.compact ? `<div class="ts">${esc(n.s)}</div>` : ''}
      <div class="meta">${tags}<span>${esc(n.src || '')}${n.d ? ' · ' + esc(n.d.length > 5 ? n.d.slice(n.d.length === 10 ? 5 : 0) : n.d) : ''}</span></div></div>
    <div class="na">${M.isFresh(n) ? `<button type="button" data-act="toggle-read" data-id="${n.id}">${read ? '标为未读' : '标为已读'}</button>` : ''}
      ${opts.compact ? '' : `<button type="button" data-act="later" data-id="${n.id}">${later ? '已在待读' : '稍后读'}</button><button type="button" data-act="agent-news" data-id="${n.id}">问 Agent</button>`}
      ${n.ai && !opts.compact ? `<button type="button" data-act="mark-wrong" data-id="${n.id}" title="下周的自动整理会参考你的标记">分错了</button>` : ''}</div></li>`;
}

export const resLink = r => r.url ? link(r.name, r.url) : `${esc(r.name)}<span class="fnt small">（无链接，按名称查找）</span>`;
