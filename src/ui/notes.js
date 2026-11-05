// 笔记：卡片笔记（随手记）+ 每个阶段一篇长文档。两种都支持 Markdown，显示时做安全过滤。
import { $, esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { md } from '../core/md.js';
import { uid } from '../core/ids.js';
import { act, refresh, toast } from './kit.js';
import { stageLabel } from './home.js';
import { reactBar, refsHtml } from './react.js';

const cards = () => store.all('cards');
const isMobile = () => matchMedia('(max-width: 820px)').matches;

// 笔记可以挂到的位置：所有理论阶段 + 前沿路线，按方向分组
function attachOptions(sel) {
  return M.tracks().map(t => {
    const st = M.state(t.id);
    const opts = st.stages.map((s, i) => `<option value="${s.id}"${s.id === sel ? ' selected' : ''}>${i + 1}. ${esc(s.title)}</option>`).join('')
      + M.routes(t.id).map(r => `<option value="${r.id}"${r.id === sel ? ' selected' : ''}>前沿：${esc(r.title)}</option>`).join('');
    return `<optgroup label="${esc(t.name)}">${opts}</optgroup>`;
  }).join('');
}

// 当前上下文：在方向页 → 该方向当前阶段（或 URL 指定的阶段）；在前沿路线页 → 这条路线；否则第一个在学阶段
export function contextAttach() {
  const h = location.hash;
  let m = h.match(/^#\/r\/([^?]+)/); if (m) return decodeURIComponent(m[1]);
  m = h.match(/[?&]s=([^&]+)/); if (m) return decodeURIComponent(m[1]);
  m = h.match(/^#\/notes\/s\/([^?]+)/); if (m) return decodeURIComponent(m[1]);
  m = h.match(/^#\/t\/([^/?]+)/); if (m && M.track(m[1])) return M.state(m[1]).current || '';
  const d = M.doing()[0]; return d ? (d.kind === 'stage' ? d.s.id : d.r.id) : '';
}

/* ---------- 随手记弹窗 ---------- */
export function openQuick(at, text = '') {
  let el = $('#qn');
  if (!el) {
    el = document.createElement('section'); el.id = 'qn'; el.className = 'qn card'; el.setAttribute('aria-label', '随手记');
    document.body.appendChild(el);
  }
  at = at ?? contextAttach();
  el.innerHTML = `<div class="qn-h"><b>随手记</b><label class="sr" for="qnAt">挂到</label>
      <select id="qnAt"><option value="">不归类</option>${attachOptions(at)}</select>
      <button class="x" data-act="qn-close" aria-label="关闭">×</button></div>
    <textarea id="qnText" placeholder="想到什么就写下来，支持 Markdown。⌘/Ctrl + Enter 保存">${esc(text)}</textarea>
    <div class="qn-f"><span class="fnt small">自动保存草稿</span><button class="btn sm gh" data-act="qn-agent">发给 Agent</button><button class="btn sm pri" data-act="qn-save">保存</button></div>`;
  el.hidden = false; document.body.classList.add('qn-open');
  const ta = $('#qnText', el);
  if (!text) ta.value = store.ui().qnDraft || '';
  ta.addEventListener('input', () => { store.ui().qnDraft = ta.value; store.saveUi(); });
  ta.addEventListener('keydown', e => { if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') { e.preventDefault(); saveQuick(); } if (e.key === 'Escape') closeQuick(); });
  setTimeout(() => ta.focus(), 30);
}
export function closeQuick() { const el = $('#qn'); if (el) el.hidden = true; document.body.classList.remove('qn-open'); }
function saveQuick(thenAgent) {
  const t = $('#qnText').value.trim(); if (!t) { closeQuick(); return null; }
  const id = 'c' + uid('');
  store.put('cards', id, { t, at: $('#qnAt').value || null, c: Date.now() });
  store.ui().qnDraft = ''; store.saveUi();
  closeQuick(); refresh();
  if (!thenAgent) toast('已保存到笔记', () => { store.del('cards', id); refresh(); });
  return id;
}
act('qn-close', closeQuick);
act('qn-save', () => saveQuick());
act('qn-agent', () => { const id = saveQuick(true); if (id) window.dispatchEvent(new CustomEvent('agent:card', { detail: id })); });
act('quick-note', el => openQuick(el.dataset.id));
window.addEventListener('quick-note', e => openQuick(e.detail.at, e.detail.text));
document.addEventListener('keydown', e => {
  if ((e.metaKey || e.ctrlKey) && (e.key === 'j' || e.key === 'J')) { e.preventDefault(); openQuick(); }
});

/* ---------- 笔记页 ---------- */
// 路由：#/notes 全部；#/notes/<卡片 ID>；#/notes/s/<阶段或路线 ID>
export function renderNotes(arg, q) {
  document.documentElement.style.setProperty('--c', '#1B2430');
  const C = cards(), docs = store.all('notes');
  const term = (store.ui().noteQ || '').trim().toLowerCase();
  const hit = s => !term || String(s).toLowerCase().includes(term);
  // 左栏：按方向 → 阶段/路线分组
  const groups = new Map();
  const add = (at, entry) => { const k = at || ''; if (!groups.has(k)) groups.set(k, { doc: null, cards: [] }); const g = groups.get(k); entry.doc ? (g.doc = entry) : g.cards.push(entry); };
  for (const [k, v] of Object.entries(docs)) if (k !== 'start' && hit(v) ) add(k, { doc: true, text: v });
  for (const [id, c] of Object.entries(C)) if (hit(c.t)) add(c.at, { id, ...c });
  const byTrack = new Map();
  for (const [at, g] of groups) {
    const f = at ? M.findStage(at) : null, r = at && !f ? M.route(at) : null;
    const tid = f ? f.t.id : r ? r.track : '';
    if (!byTrack.has(tid)) byTrack.set(tid, []);
    byTrack.get(tid).push({ at, g, label: f ? f.s.title : r ? '前沿：' + M.routeName(at) : '没有归类', order: f ? M.state(f.t.id).stages.indexOf(f.s) : 99 });
  }
  const order = [...M.tracks().map(t => t.id), ''];
  const sel = arg && arg !== 's' ? arg : null, selStage = arg === 's' ? q.id : null;
  const left = order.filter(tid => byTrack.has(tid)).map(tid => {
    const t = M.track(tid);
    const rows = byTrack.get(tid).sort((a, b) => a.order - b.order).map(({ at, g, label }) => {
      const cur = selStage === at;
      const head = at ? `<a class="ni${cur ? ' on' : ''}" href="#/notes/s/${encodeURIComponent(at)}"><b>${esc(label)}</b><small>${g.doc ? '文档 + ' : ''}${g.cards.length} 张卡片</small></a>` : `<div class="ni"><b>${esc(label)}</b><small>${g.cards.length} 张卡片</small></div>`;
      const cs = !at || term ? g.cards.sort((a, b) => b.c - a.c).map(c => `<a class="ni sub${sel === c.id ? ' on' : ''}" href="#/notes/${c.id}">${esc(c.t.split('\n')[0].slice(0, 40))}</a>`).join('') : '';
      return head + cs;
    }).join('');
    return `<div class="ng">${esc(t ? t.name : '其他')}</div>${rows}`;
  }).join('');
  // 右栏
  let right;
  if (selStage) right = stageDoc(selStage, C, docs);
  else if (sel && C[sel]) right = cardView(sel, C[sel]);
  else right = `<div class="card" style="padding:18px 20px"><h2 style="font-size:19px">笔记</h2>
      <p class="mut" style="margin-top:6px">卡片笔记用来随手记，会挂到当时所在的阶段或前沿路线；每个阶段还有一篇长文档，用来整理。任何一条都可以发给学习 Agent 讨论，Agent 也能把卡片整理进长文档。</p>
      <div class="sa"><button class="btn sm pri" data-act="quick-note">＋ 新卡片</button><span class="fnt small">快捷键 ⌘J / Ctrl+J</span></div>
      <div class="sh"><h3>最近的卡片</h3></div><ul class="lst">${Object.entries(C).sort((a, b) => b[1].c - a[1].c).slice(0, 12).map(([id, c]) => `<li><a href="#/notes/${id}" style="text-decoration:none">${esc(c.t.slice(0, 120))}</a><div class="meta">${c.at ? esc(stageLabel(c.at)) : '没有归类'} · ${new Date(c.c).toLocaleString('zh-CN', { hour12: false })}</div></li>`).join('') || '<li class="fnt">还没有笔记。</li>'}</ul></div>`;
  return `<div class="ph"><h1>笔记</h1><span class="mut">${Object.keys(C).length} 张卡片 · ${Object.keys(docs).filter(k => k !== 'start').length} 篇阶段文档</span>
      <span class="r"><button class="btn pri" data-act="quick-note">＋ 新卡片</button></span></div>
    <div class="notes-l${sel || selStage ? ' has-sel' : ''}">
      <div class="card nside"><input class="nq" type="search" placeholder="搜索笔记" value="${esc(store.ui().noteQ || '')}" aria-label="搜索笔记">${left || '<p class="empty">没有符合的笔记。</p>'}</div>
      <div class="nmain">${right}</div></div>`;
}

function stageDoc(id, C, docs) {
  const f = M.findStage(id), r = f ? null : M.route(id);
  if (!f && !r) return '<p class="empty">这个阶段不存在了。</p>';
  const title = f ? f.s.title : '前沿：' + M.routeName(id);
  const text = docs[id] || '', editing = store.ui().noteEdit === id;
  const cs = Object.entries(C).filter(([, c]) => c.at === id).sort((a, b) => b[1].c - a[1].c);
  const href = f ? `#/t/${f.t.id}?s=${encodeURIComponent(id)}` : `#/r/${encodeURIComponent(id)}`;
  return `<div class="card ndoc"><a class="fnt small" href="#/notes" data-mobile-back>‹ 全部笔记</a>
    <h2>${esc(title)}</h2><div class="meta" style="margin:2px 0 12px">${esc(f ? f.t.name : (M.track(r.track) || {}).name || '')} · <a href="${href}">打开${f ? '阶段' : '路线'}</a></div>
    ${editing ? `<textarea class="ned" id="docEd" data-doc="${esc(id)}" placeholder="整理这个阶段学到的东西，支持 Markdown">${esc(text)}</textarea>
      <div class="sa"><button class="btn sm pri" data-act="doc-done">完成编辑</button><span class="fnt small">自动保存</span></div>`
    : `<div class="md nbody">${text ? md(text) : '<p class="fnt">这个阶段还没有整理文档。点“编辑”开始写，或者让 Agent 把下面的卡片整理进来。</p>'}</div>
      <div class="rx-row">${reactBar('stage', id)}</div>${refsHtml('stage', id)}
      <div class="sa"><button class="btn sm" data-act="doc-edit" data-id="${esc(id)}">编辑</button>
        <button class="btn sm acc" data-act="agent-doc" data-id="${esc(id)}">和 Agent 聊这篇</button>
        ${cs.length ? `<button class="btn sm" data-act="agent-organize" data-id="${esc(id)}">让 Agent 把 ${cs.length} 张卡片整理进来</button>` : ''}
        <button class="btn sm gh" data-act="quick-note" data-id="${esc(id)}">＋ 卡片</button>
        <button class="btn sm gh" data-act="export-open" data-at="${esc(id)}">导出给 AI</button></div>`}
    <div class="sh"><h3>这个阶段的卡片</h3></div>
    ${cs.map(([cid, c]) => `<div class="mini"><div class="md">${md(c.t)}</div><div class="meta">${new Date(c.c).toLocaleString('zh-CN', { hour12: false })}<span class="act"><a href="#/notes/${cid}">编辑</a><button data-act="agent-card" data-id="${cid}">问 Agent</button></span></div><div class="rx-row">${reactBar('card', cid)}</div></div>`).join('') || '<p class="fnt small">还没有卡片。</p>'}</div>`;
}

function cardView(id, c) {
  const editing = store.ui().noteEdit === id;
  return `<div class="card ndoc"><a class="fnt small" href="#/notes" data-mobile-back>‹ 全部笔记</a>
    <div class="meta" style="margin:4px 0 10px">${new Date(c.c).toLocaleString('zh-CN', { hour12: false })}${c.at ? ` · <a href="#/notes/s/${encodeURIComponent(c.at)}">${esc(stageLabel(c.at))}</a>` : ' · 没有归类'}</div>
    ${editing ? `<textarea class="ned" id="cardEd" data-card="${id}">${esc(c.t)}</textarea>
      <label class="field"><span>挂到</span><select id="cardAt" data-card="${id}"><option value="">不归类</option>${attachOptions(c.at)}</select></label>
      <div class="sa"><button class="btn sm pri" data-act="doc-done">完成编辑</button><button class="btn sm gh" data-act="card-del" data-id="${id}">删除这张卡片</button></div>`
    : `<div class="md nbody">${md(c.t)}</div>
      <div class="rx-row">${reactBar('card', id)}</div>${refsHtml('card', id)}
      <div class="sa"><button class="btn sm" data-act="doc-edit" data-id="${id}">编辑</button><button class="btn sm acc" data-act="agent-card" data-id="${id}">和 Agent 聊这条</button>
        <button class="btn sm gh" data-act="export-open" data-card="${id}">导出给 AI</button><button class="btn sm gh" data-act="card-del" data-id="${id}">删除</button></div>`}</div>`;
}

/* ---------- 动作 ---------- */
act('doc-edit', el => { store.ui().noteEdit = el.dataset.id; store.saveUi(); refresh(); setTimeout(() => { const t = $('#docEd') || $('#cardEd'); if (t) t.focus(); }, 30); });
act('doc-done', () => { store.ui().noteEdit = null; store.saveUi(); refresh(); });
act('card-del', el => {
  const id = el.dataset.id, before = store.get('cards', id);
  store.del('cards', id); store.ui().noteEdit = null; store.saveUi();
  location.hash = before && before.at ? '#/notes/s/' + encodeURIComponent(before.at) : '#/notes';
  toast('已删除', () => { store.put('cards', id, before); refresh(); });
});
let edTimer;
document.addEventListener('input', e => {
  const t = e.target;
  if (t.id === 'docEd') { clearTimeout(edTimer); edTimer = setTimeout(() => store.setNote(t.dataset.doc, t.value), 400); }
  if (t.id === 'cardEd') { clearTimeout(edTimer); edTimer = setTimeout(() => { const c = store.get('cards', t.dataset.card); if (c && t.value.trim()) store.put('cards', t.dataset.card, { ...c, t: t.value }); }, 400); }
  if (t.matches && t.matches('.nq')) { clearTimeout(edTimer); edTimer = setTimeout(() => { store.ui().noteQ = t.value; store.saveUi(); refresh(); setTimeout(() => { const n = $('.nq'); if (n) { n.focus(); n.setSelectionRange(n.value.length, n.value.length); } }, 0); }, 250); }
});
document.addEventListener('change', e => {
  if (e.target.id === 'cardAt') { const c = store.get('cards', e.target.dataset.card); if (c) store.put('cards', e.target.dataset.card, { ...c, at: e.target.value || null }); }
});
export const _isMobile = isMobile;
