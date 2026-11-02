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

/* ---------- 多选资讯（一键解析关联） ---------- */
export const PICK = { on: false, ids: [] };
export const MAX_PICK = 8;
export function pickBar() {
  let el = $('#pickBar');
  if (!PICK.on) { if (el) el.hidden = true; return; }
  if (!el) { el = document.createElement('div'); el.id = 'pickBar'; el.className = 'pickbar'; document.body.appendChild(el); }
  el.hidden = false;
  el.innerHTML = `<span>已选 <b>${PICK.ids.length}</b> / ${MAX_PICK} 条</span>
    <button class="btn sm gh" data-act="pick-cancel">取消</button>
    <button class="btn sm acc" data-act="pick-go"${PICK.ids.length >= 2 ? '' : ' disabled'}>一键解析关联</button>`;
}

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
  const picked = PICK.ids.includes(n.id);
  const lead = PICK.on ? `<input type="checkbox" class="pick" data-act="pick" data-id="${n.id}" aria-label="选择这条"${picked ? ' checked' : ''}>` : `<span class="u" aria-label="${read ? '已读' : '未读'}"></span>`;
  return `<li class="${read ? 'is-read' : ''}${picked ? ' picked' : ''}" data-nid="${n.id}">${lead}
    <div><div class="tt"><a href="${esc(n.u)}" target="_blank" rel="noopener" data-act="read" data-id="${n.id}">${esc(n.t)}</a></div>
      ${n.s && !opts.compact ? `<div class="ts">${esc(n.s)}</div>` : ''}
      <div class="meta">${tags}<span>${esc(n.src || '')}${n.d ? ' · ' + esc(n.d.length > 5 ? n.d.slice(n.d.length === 10 ? 5 : 0) : n.d) : ''}</span></div></div>
    <div class="na">${M.isFresh(n) ? `<button type="button" data-act="toggle-read" data-id="${n.id}">${read ? '标为未读' : '标为已读'}</button>` : ''}
      ${opts.compact ? `<button type="button" class="ex" data-act="agent-news" data-id="${n.id}">一键解析</button>` : `<button type="button" data-act="later" data-id="${n.id}">${later ? '已在待读' : '稍后读'}</button><button type="button" class="ex" data-act="agent-news" data-id="${n.id}" title="让学习 Agent 讲清楚这条讲了什么、为什么重要、和你在学的内容有什么关系">一键解析</button>`}
      ${n.ai && !opts.compact ? `<button type="button" data-act="mark-wrong" data-id="${n.id}" title="下周的自动整理会参考你的标记">分错了</button>` : ''}</div></li>`;
}

export const resLink = r => r.url ? link(r.name, r.url) : `${esc(r.name)}<span class="fnt small">（无链接，按名称查找）</span>`;
