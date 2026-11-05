// 把资讯交给学习 Agent 的两种方式（电脑端）：
// 1. 拖拽：任何资讯（精选、快照、实时动态、前沿路线时间线）拖到 Agent 窗口或右下角“学习 Agent”按钮上，对话框里显示标题。
// 2. 右键：在资讯上点右键，弹出“问 Agent”小框，输入问题点“询问”就自动打开 Agent 开始分析。按住 Shift 右键仍是浏览器自己的菜单。
import { $, esc } from '../util.js';
import * as M from '../model.js';
import { attach, askWith } from './agentui.js';

const MIME = 'application/x-lh-news';

// 从页面元素里认出一条资讯
function newsFrom(el) {
  if (!el || !el.closest) return null;
  const row = el.closest('[data-nid], .tline li, .live li');
  const a = (el.closest('a[href^="http"]')) || (row && row.querySelector('a[href^="http"]'));
  if (!a || !a.closest('#view')) return null;
  const id = (row && row.dataset.nid) || a.dataset.id || '';
  const n = id && M.news().find(x => x.id === id);
  if (n) return { id: n.id, t: n.t, u: n.u, src: n.src || '' };
  const card = a.closest('.card');
  const src = card && card.querySelector('h4 span') ? card.querySelector('h4 span').firstChild.textContent.trim() : '';
  return { t: a.textContent.trim(), u: a.href, src: src ? '实时动态 · ' + src : '实时动态' };
}
// 外部拖进来的链接：能在站内资讯里找到就用标题
function newsFromUrl(u) {
  const n = M.news().find(x => x.u === u);
  return n ? { id: n.id, t: n.t, u: n.u, src: n.src || '' } : { t: u, u, src: '外部链接' };
}

/* ---------- 拖拽 ---------- */
document.addEventListener('dragstart', e => {
  const x = newsFrom(e.target);
  if (!x) return;
  e.dataTransfer.setData(MIME, JSON.stringify(x));
  e.dataTransfer.setData('text/plain', x.t);   // 拖到别的输入框里也是标题
  e.dataTransfer.effectAllowed = 'copy';
  document.body.classList.add('dragging-news');
});
document.addEventListener('dragend', () => document.body.classList.remove('dragging-news', 'drop-over'));

const isTarget = el => el && el.closest && el.closest('#dw, .fab [data-act=agent-open], #dropAgent');
document.addEventListener('dragover', e => {
  if (!isTarget(e.target)) return;
  const types = [...(e.dataTransfer.types || [])];
  if (!types.includes(MIME) && !types.includes('text/uri-list')) return;
  e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  document.body.classList.add('drop-over');
}, true);
document.addEventListener('dragleave', e => { if (isTarget(e.target) && !isTarget(e.relatedTarget)) document.body.classList.remove('drop-over'); });
document.addEventListener('drop', e => {
  if (!isTarget(e.target)) return;
  e.preventDefault();   // 不让浏览器把网址塞进输入框
  document.body.classList.remove('dragging-news', 'drop-over');
  let x = null;
  try { x = JSON.parse(e.dataTransfer.getData(MIME) || 'null'); } catch (err) {}
  if (!x) { const u = (e.dataTransfer.getData('text/uri-list') || '').split('\n').find(l => /^https?:\/\//.test(l.trim())); if (u) x = newsFromUrl(u.trim()); }
  if (x) attach([x]);
}, true);

/* ---------- 右键“问 Agent” ---------- */
let menu = null, cur = null, openedAt = 0;
function closeMenu() { if (menu) menu.hidden = true; cur = null; }
document.addEventListener('contextmenu', e => {
  if (e.shiftKey || !matchMedia('(pointer: fine)').matches) return;
  const x = newsFrom(e.target);
  if (!x) return;
  e.preventDefault();
  const sel = String(getSelection() || '').trim();
  cur = sel && sel.length > 4 && sel.length < 3000 ? { ...x, quote: sel } : x;
  if (!menu) {
    menu = document.createElement('div'); menu.className = 'askm card'; menu.setAttribute('role', 'dialog'); document.body.appendChild(menu);
    menu.addEventListener('submit', ev => { ev.preventDefault(); go(menu.querySelector('input').value.trim()); });
    menu.addEventListener('click', ev => { const b = ev.target.closest('[data-q]'); if (b) go(b.dataset.q); });
    menu.addEventListener('keydown', ev => { if (ev.key === 'Escape') closeMenu(); });
  }
  menu.innerHTML = `<div class="askm-h">问学习 Agent</div>
    <div class="askm-t">${cur.quote ? '选中的文字：“' + esc(cur.quote.slice(0, 60)) + (cur.quote.length > 60 ? '…' : '') + '”' : esc(cur.t)}</div>
    <form><input placeholder="想问什么？例如：这和 MCP 有什么关系" aria-label="问题"><button class="btn sm acc">询问</button></form>
    <div class="askm-q"><button type="button" class="btn sm gh" data-q="">深度解析</button><button type="button" class="btn sm gh" data-q="这对产品和落地意味着什么？">对产品意味着什么</button><button type="button" class="btn sm gh" data-q="__attach">先放进对话框</button></div>
    <p class="fnt small">按住 Shift 再右键是浏览器原来的菜单</p>`;
  menu.hidden = false; openedAt = Date.now();
  const w = 340, h = 190;
  menu.style.left = Math.min(e.clientX, innerWidth - w - 12) + 'px';
  menu.style.top = Math.min(e.clientY, innerHeight - h - 12) + 'px';
  setTimeout(() => menu.querySelector('input').focus({ preventScroll: true }), 0);
});
function go(q) {
  const x = cur; closeMenu(); if (!x) return;
  if (q === '__attach') attach([x]); else askWith([x], q);
}
document.addEventListener('mousedown', e => { if (menu && !menu.hidden && !menu.contains(e.target)) closeMenu(); });
addEventListener('scroll', () => { if (Date.now() - openedAt > 400) closeMenu(); }, { passive: true });
addEventListener('hashchange', () => closeMenu());
