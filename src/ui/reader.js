// 站内阅读面板：点资讯标题先在这里打开——摘要、读原文、接着读（相关资讯和论文）、和你的笔记与学习阶段的关系。
// 原文网站是别人的，没法在它旁边加东西；所以“接着读”放在这里，看完原文回来面板还在，直接点下一篇。
import { $, esc, iso } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { relatedTo, relatedMine } from '../core/related.js';
import { act, toast, refresh, lvlTag, trackTag, routeTag, TYPES } from './kit.js';
import { stageLabel } from './home.js';
import { addBoardButtons } from './translate.js';
import { md } from '../core/md.js';
import { newsId } from '../core/ids.js';
import { cachedSummary, summarize, clearSummary, BASIS } from '../ai/summary.js';
import { isEn } from '../i18n.js';

let STACK = [];   // 在面板里依次打开过的条目，用于“返回上一篇”
const panel = () => { let el = $('#rd'); if (!el) { el = document.createElement('aside'); el.id = 'rd'; el.className = 'rd'; el.setAttribute('aria-label', '阅读'); el.hidden = true; document.body.appendChild(el); } return el; };
export const readerOpen = () => !panel().hidden;

let dirty = false;
function markRead(id) {
  if (M.isRead(id) || !M.news().some(n => n.id === id)) return;
  store.put('read', id, iso(new Date())); dirty = true;
  document.querySelectorAll(`li[data-nid="${id}"]`).forEach(li => li.classList.add('is-read'));
}

export function openReader(id, { push = true } = {}) {
  const x = M.findItem(id); if (!x) return false;
  if (push && STACK[STACK.length - 1] !== id) STACK.push(id);
  STACK = STACK.slice(-20);
  markRead(id);
  render(x);
  addBoardButtons(panel());
  const el = panel(); el.hidden = false; document.body.classList.add('rd-open');
  el.scrollTop = 0;
  startSummary(x).catch(() => {});
  return true;
}
// 关面板时再刷新列表：读过的条目这时才移到“已读”，阅读过程中列表不跳动
export function closeReader() { panel().hidden = true; document.body.classList.remove('rd-open'); STACK = []; if (dirty) { dirty = false; refresh(); } }

function item(o) {
  const x = o.x, read = M.isRead(x.id);
  return `<li class="${read ? 'is-read' : ''}"><button class="rdl" data-act="rd-go" data-id="${x.id}">${esc(x.t)}</button>
    <div class="meta">${x.type === 'paper' ? '<span class="tag">论文</span>' : ''}${lvlTag(x.lvl)}<span>${esc(x.src || '')}${x.d ? ' · ' + esc(String(x.d).slice(5)) : ''}</span><span class="why">${esc(o.why)}</span></div></li>`;
}

function render(x) {
  const ix = M.relIndex(), rel = relatedTo(ix, x, { routeName: M.routeName, limit: 10 });
  const groups = [['same', '同一件事的其他报道'], ['deep', '更深入：论文和一手来源'], ['more', '相关资讯']]
    .map(([g, h]) => [h, rel.filter(o => o.group === g)]).filter(([, L]) => L.length);
  const stages = M.tracks().flatMap(t => M.state(t.id).stages.map(s => ({ id: s.id, title: s.title, text: s.goal + ' ' + s.items.map(i => i.text).join(' '), routes: M.routes(t.id).filter(r => r.from === s.id).map(r => r.id) })));
  const notes = Object.entries(store.all('cards')).map(([id, c]) => ({ id, t: c.t, at: c.at }));
  const mine = relatedMine(x, { notes, stages }, ix.idf);
  const later = !!store.get('later', x.id), back = STACK.length > 1;
  panel().innerHTML = `<div class="dw-h">${back ? '<button class="btn sm gh" data-act="rd-back" title="返回上一篇">‹ 上一篇</button>' : ''}<h3>阅读</h3><button class="x" data-act="rd-close" aria-label="关闭">×</button></div>
    <div class="rd-b">
      <div class="meta">${(x.k || []).map(trackTag).join('')}${x.type ? `<span class="tag">${TYPES[x.type] || '资讯'}</span>` : ''}${lvlTag(x.lvl)}<span>${esc(x.src || '')}${x.d ? ' · ' + esc(x.d) : ''}${x.via ? ' · 经 ' + esc(x.via) : ''}</span></div>
      <div class="sh" style="margin:0"><span class="r"></span></div><h2 class="rd-t">${esc(x.t)}</h2>
      <section class="rd-sum" id="rdSum" data-id="${x.id}" aria-live="polite"><p class="fnt small"><i class="spin"></i> 正在准备总结…</p></section>
      ${(x.r || []).length ? `<div class="meta">前沿路线：${x.r.slice(0, 3).map(routeTag).join('')}</div>` : ''}
      <div class="sa"><a class="btn pri" href="${esc(x.u)}" target="_blank" rel="noopener">读原文 ↗</a>
        <button class="btn acc" data-act="agent-news" data-id="${x.id}" title="让学习 Agent 深入解析：背景、论点和证据、影响、和你在学内容的关系">深度解析</button>
        ${M.news().some(n => n.id === x.id) ? `<button class="btn gh" data-act="later" data-id="${x.id}">${later ? '已在稍后读' : '稍后读'}</button>` : ''}
        <button class="btn gh" data-act="rd-note" data-id="${x.id}">记一笔</button></div>
      <div class="sh"><h3>接着读</h3><span class="fnt small">按内容、所属前沿路线和日期算出来的，不用 AI</span></div>
      ${groups.map(([h, L]) => `<div class="rd-g"><b>${h}</b><ul class="rd-l">${L.map(item).join('')}</ul></div>`).join('') || '<p class="fnt small">没有找到明显相关的内容。</p>'}
      ${mine.stages.length || mine.notes.length ? `<div class="sh"><h3>和你学的东西</h3></div>
        ${mine.stages.length ? `<div class="rd-g"><b>相关的学习阶段</b><ul class="rd-l">${mine.stages.map(s => `<li><a href="#/t/${s.id.split('.')[0]}?s=${encodeURIComponent(s.id)}">${esc(stageLabel(s.id))}</a></li>`).join('')}</ul></div>` : ''}
        ${mine.notes.length ? `<div class="rd-g"><b>你记过的笔记</b><ul class="rd-l">${mine.notes.map(n => `<li><a href="#/notes/${n.id}">${esc(n.t.split('\n')[0].slice(0, 60))}</a></li>`).join('')}</ul></div>` : ''}` : ''}
    </div>`;
}

/* ---------- 总结 ---------- */
// 点开就给：先显示标题和“讲了什么”。有缓存直接用；没有就用你的模型生成；没设置模型时显示来源给的摘要
const FLY = new Map();
const spot = id => { const el = document.getElementById('rdSum'); return el && el.dataset.id === id ? el : null; };
const paint = (id, html) => { const el = spot(id); if (el) el.innerHTML = html; };
const snippet = x => x.s ? `<p class="rd-s">${esc(x.s)}</p><p class="fnt small">以上是来源给的摘要。</p>` : '<p class="fnt small">来源没有给摘要。</p>';
const done = (x, c) => `<div class="rd-sumb md">${md(c.text)}</div><div class="rd-sumf"><span class="aitag">AI</span><span>总结 · ${esc(BASIS[c.basis] || '')}</span><button type="button" class="lnk" data-act="rd-resum" data-id="${x.id}">重新总结</button></div>`;
export async function startSummary(x, { force = false } = {}) {
  const ag = await import('./agentui.js');
  if (!force) { const c = await cachedSummary(x.id); if (c) return paint(x.id, done(x, c)); }
  const cfg = await ag.aiCfg(), block = ag.aiBlock(cfg);
  if (block) return paint(x.id, snippet(x) + `<p class="fnt small">${esc(block)}。<a href="#/settings">去设置</a>，设好之后点开资讯会自动生成总结。</p>`);
  const u = await ag.usage(), over = !!(cfg.budget && u.cny >= cfg.budget);
  if (!force && (store.ui().autoSum === false || over))
    return paint(x.id, snippet(x) + `<button type="button" class="btn sm acc" data-act="rd-resum" data-id="${x.id}">生成总结</button>${over ? '<span class="fnt small"> 本月花费已超过你设的上限，生成前会再确认一次。</span>' : ''}`);
  if (force && over && !confirm(`本月已经用了 ¥${u.cny.toFixed(2)}，超过你设的上限 ¥${cfg.budget}。还要继续调用吗？`)) return;
  paint(x.id, snippet(x) + '<p class="rd-wait"><i class="spin"></i> 正在总结…</p>');
  if (!FLY.has(x.id)) FLY.set(x.id, summarize(x, cfg, { en: isEn() }).then(async r => { await ag.addUsage(cfg, r.usage); return r; }).finally(() => FLY.delete(x.id)));
  try { paint(x.id, done(x, await FLY.get(x.id))); }
  catch (e) { paint(x.id, snippet(x) + `<p class="err small">总结失败：${esc(e.message || e)}</p><button type="button" class="btn sm" data-act="rd-resum" data-id="${x.id}">重试</button>`); }
}
act('rd-resum', async el => { const x = M.findItem(el.dataset.id); if (!x) return; await clearSummary(x.id); startSummary(x, { force: true }); });

act('rd-open', (el, e) => {
  // 按住 ⌘/Ctrl 或中键：照旧直接在新标签页打开原文
  if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) { markRead(el.dataset.id); return; }
  if (openReader(el.dataset.id)) e && e.preventDefault();
});
act('rd-go', el => openReader(el.dataset.id));
// 实时动态、财经快讯里的链接：不在资讯库里，临时登记后同样先在面板里看总结
act('rd-link', (el, e) => {
  if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) return;
  const u = el.getAttribute('href'), id = newsId(u);
  M.addAdhoc({ id, t: el.dataset.t || u, u, src: el.dataset.src || '', d: '', s: '', k: [], r: [], via: '' });
  if (openReader(id)) e && e.preventDefault();
});
// 点标题只会打开阅读面板：即使面板出错也不能让页面直接跳到原文（读原文要点面板里的按钮）
document.addEventListener('click', e => {
  const a = e.target.closest && e.target.closest('a[data-act=rd-open],a[data-act=rd-link]');
  if (a && !(e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) e.preventDefault();
}, true);
act('rd-back', () => { STACK.pop(); const id = STACK[STACK.length - 1]; if (id) openReader(id, { push: false }); });
act('rd-close', () => closeReader());
act('rd-note', el => {
  const x = M.findItem(el.dataset.id); if (!x) return;
  window.dispatchEvent(new CustomEvent('quick-note', { detail: { at: (x.r || [])[0] || null, text: `[${x.t}](${x.u})\n\n` } }));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && readerOpen() && !document.querySelector('dialog[open]') && !document.body.classList.contains('dw-open')) closeReader(); });
window.addEventListener('hashchange', () => { if (readerOpen() && !/^#\/(t|r|search|later|$)/.test(location.hash || '#/')) closeReader(); });
export const _toast = toast;
