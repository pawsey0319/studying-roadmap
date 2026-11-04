// 站内阅读面板：点资讯标题先在这里打开——摘要、读原文、接着读（相关资讯和论文）、和你的笔记与学习阶段的关系。
// 原文网站是别人的，没法在它旁边加东西；所以“接着读”放在这里，看完原文回来面板还在，直接点下一篇。
import { $, esc, iso } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { relatedTo, relatedMine } from '../core/related.js';
import { act, toast, refresh, lvlTag, trackTag, routeTag, TYPES } from './kit.js';
import { stageLabel } from './home.js';

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
  const el = panel(); el.hidden = false; document.body.classList.add('rd-open');
  el.scrollTop = 0;
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
      <h2 class="rd-t">${esc(x.t)}</h2>
      ${x.s ? `<p class="rd-s">${esc(x.s)}</p>` : '<p class="fnt small">没有摘要，读原文看完整内容。</p>'}
      ${(x.r || []).length ? `<div class="meta">前沿路线：${x.r.slice(0, 3).map(routeTag).join('')}</div>` : ''}
      <div class="sa"><a class="btn pri" href="${esc(x.u)}" target="_blank" rel="noopener">读原文 ↗</a>
        <button class="btn acc" data-act="agent-news" data-id="${x.id}">一键解析</button>
        ${M.news().some(n => n.id === x.id) ? `<button class="btn gh" data-act="later" data-id="${x.id}">${later ? '已在稍后读' : '稍后读'}</button>` : ''}
        <button class="btn gh" data-act="rd-note" data-id="${x.id}">记一笔</button></div>
      <div class="sh"><h3>接着读</h3><span class="fnt small">按内容、所属前沿路线和日期算出来的，不用 AI</span></div>
      ${groups.map(([h, L]) => `<div class="rd-g"><b>${h}</b><ul class="rd-l">${L.map(item).join('')}</ul></div>`).join('') || '<p class="fnt small">没有找到明显相关的内容。</p>'}
      ${mine.stages.length || mine.notes.length ? `<div class="sh"><h3>和你学的东西</h3></div>
        ${mine.stages.length ? `<div class="rd-g"><b>相关的学习阶段</b><ul class="rd-l">${mine.stages.map(s => `<li><a href="#/t/${s.id.split('.')[0]}?s=${encodeURIComponent(s.id)}">${esc(stageLabel(s.id))}</a></li>`).join('')}</ul></div>` : ''}
        ${mine.notes.length ? `<div class="rd-g"><b>你记过的笔记</b><ul class="rd-l">${mine.notes.map(n => `<li><a href="#/notes/${n.id}">${esc(n.t.split('\n')[0].slice(0, 60))}</a></li>`).join('')}</ul></div>` : ''}` : ''}
    </div>`;
}

act('rd-open', (el, e) => {
  // 按住 ⌘/Ctrl 或中键：照旧直接在新标签页打开原文
  if (e && (e.metaKey || e.ctrlKey || e.shiftKey || e.button === 1)) { markRead(el.dataset.id); return; }
  if (openReader(el.dataset.id)) e && e.preventDefault();
});
act('rd-go', el => openReader(el.dataset.id));
act('rd-back', () => { STACK.pop(); const id = STACK[STACK.length - 1]; if (id) openReader(id, { push: false }); });
act('rd-close', () => closeReader());
act('rd-note', el => {
  const x = M.findItem(el.dataset.id); if (!x) return;
  window.dispatchEvent(new CustomEvent('quick-note', { detail: { at: (x.r || [])[0] || null, text: `[${x.t}](${x.u})\n\n` } }));
});
document.addEventListener('keydown', e => { if (e.key === 'Escape' && readerOpen() && !document.querySelector('dialog[open]') && !document.body.classList.contains('dw-open')) closeReader(); });
window.addEventListener('hashchange', () => { if (readerOpen() && !/^#\/(t|r|search|later|$)/.test(location.hash || '#/')) closeReader(); });
export const _toast = toast;
