// 搜索：站内资讯（精选、每日快照、社区）+ 你的笔记（卡片、阶段文档）+ 对话纪要 + 导入的资料
import { esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { tokens, matches, snippet, highlight } from '../core/search.js';
import { newsRow } from './kit.js';
import { stageLabel } from './home.js';

const MAX = 60;

export function renderSearch(q = {}) {
  document.documentElement.style.setProperty('--c', '#1B2430');
  const term = String(q.q || '').slice(0, 100), scope = q.in || 'all', toks = tokens(term);
  const notes = [], news = [];
  if (toks.length) {
    for (const [id, c] of Object.entries(store.all('cards'))) if (matches(c.t, toks)) notes.push({ kind: '卡片', title: c.t.split('\n')[0].slice(0, 80), body: c.t, at: c.at, href: `#/notes/${id}`, time: c.c });
    for (const [id, t] of Object.entries(store.all('notes'))) if (id !== 'start' && matches(t, toks)) notes.push({ kind: '阶段文档', title: stageLabel(id), body: t, at: id, href: `#/notes/s/${encodeURIComponent(id)}`, time: 0 });
    for (const [, g] of Object.entries(store.all('digests'))) if (matches(g.title + ' ' + g.t, toks)) notes.push({ kind: '对话纪要', title: g.title, body: g.t, at: g.at, href: '#/method?tab=digests', time: g.c });
    for (const [, d] of Object.entries(store.all('library'))) if (matches(d.title + ' ' + d.text, toks)) notes.push({ kind: '导入的资料', title: d.title, body: d.text, at: d.at, href: '#/import', time: d.added || 0 });
    notes.sort((a, b) => b.time - a.time);
    const mine = new Set(M.tracks().map(t => t.id));
    for (const n of M.news()) if (matches(`${n.t} ${n.s || ''} ${n.src || ''}`, toks)) news.push({ ...n, mine: n.k.some(k => mine.has(k)) });
    news.sort((a, b) => (b.mine - a.mine) || (a.d < b.d ? 1 : -1));
  }
  const tab = (id, label, n) => `<a class="chip" href="#/search?q=${encodeURIComponent(term)}&in=${id}" aria-pressed="${scope === id}" style="text-decoration:none">${label}${toks.length ? ' ' + n : ''}</a>`;
  const noteHtml = notes.slice(0, MAX).map(x => `<li><a href="${x.href}" style="text-decoration:none"><b>${highlight(x.title, toks)}</b></a>
      <div class="ts small">${highlight(snippet(x.body, toks), toks)}</div>
      <div class="meta"><span class="tag">${x.kind}</span>${x.at ? esc(stageLabel(x.at)) : ''}${x.time ? ' · ' + new Date(x.time).toLocaleDateString('zh-CN') : ''}</div></li>`).join('');
  const show = k => scope === 'all' || scope === k;
  return `<div class="ph"><h1>搜索</h1><span class="mut">网站里的资讯和你自己的笔记、对话纪要、导入的资料</span></div>
    <form class="srch" data-search><input name="q" type="search" value="${esc(term)}" placeholder="输入关键词，多个词用空格分开" aria-label="搜索"><button class="btn pri">搜索</button></form>
    <div class="chips" style="margin:10px 0">${tab('all', '全部', notes.length + news.length)}${tab('notes', '我的笔记', notes.length)}${tab('news', '资讯', news.length)}</div>
    ${!toks.length ? '<p class="empty">输入关键词开始搜索。笔记里的内容只在这台设备上搜索，不会发出去。</p>' : ''}
    ${toks.length && show('notes') ? `<div class="sh"><h3>我的笔记</h3><span class="fnt small">${notes.length} 条${notes.length > MAX ? `，只显示最近 ${MAX} 条` : ''}</span></div>
      <div class="card"><ul class="lst">${noteHtml || '<li class="fnt">笔记里没有找到。</li>'}</ul></div>` : ''}
    ${toks.length && show('news') ? `<div class="sh"><h3>资讯</h3><span class="fnt small">${news.length} 条${news.length > MAX ? `，只显示前 ${MAX} 条` : ''}，你在学的方向排在前面</span></div>
      <div class="card"><ul class="nlist">${news.slice(0, MAX).map(n => newsRow(n, { showTrack: true })).join('') || '<li><span></span><div class="fnt">资讯里没有找到。</div><span></span></li>'}</ul></div>` : ''}`;
}

document.addEventListener('submit', e => {
  const f = e.target.closest && e.target.closest('form[data-search]');
  if (!f) return;
  e.preventDefault();
  const v = f.q.value.trim(), cur = new URLSearchParams(location.hash.split('?')[1] || '');
  location.hash = '#/search?q=' + encodeURIComponent(v) + (cur.get('in') && f.closest('#view') ? '&in=' + cur.get('in') : '');
});
