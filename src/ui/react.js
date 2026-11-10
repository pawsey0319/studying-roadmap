// 点赞与引用的界面：一行标记 + 引用选择弹窗 + 被引用 / 引用了什么
import { $, esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { uid } from '../core/ids.js';
import { likeKey, isLiked, refIndex, citedBy, citesOf, makeRef, quoteMd, refStatus } from '../core/marks.js';
import { act, refresh, toast } from './kit.js';
import { applyToStage } from './suggest.js';
import { copyTrack } from '../core/public.js';

const PALETTE = ['#3C6E71', '#B5446E', '#5B7F1F', '#AF6E1A', '#2E6FA7', '#7A4E9C'];

const HEART = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linejoin="round" aria-hidden="true"><path d="M8 13.6S2.2 10.2 2.2 6.1A3 3 0 0 1 8 5a3 3 0 0 1 5.8 1.1C13.8 10.2 8 13.6 8 13.6Z"/></svg>';
const QUOTE = '<svg width="15" height="15" viewBox="0 0 16 16" fill="none" stroke="currentColor" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3 11.5V8.2C3 6 4.2 4.6 6.2 4.2M9 11.5V8.2c0-2.2 1.2-3.6 3.2-4"/><path d="M3 11.5h3v-3H3M9 11.5h3v-3H9"/></svg>';

// 一个对象的标题和正文：卡片、阶段（或前沿路线）、方向
export function describe(k, id) {
  if (k === 'card') { const c = store.get('cards', id); return c ? { title: c.t.split('\n')[0].replace(/^>\s*/, '').slice(0, 60), text: c.t, at: c.at || null } : null; }
  if (k === 'stage') {
    const f = M.findStage(id);
    if (f) return { title: f.s.title, text: f.s.goal + '\n' + f.s.items.map(i => i.text).join('\n'), at: id };
    const r = M.route(id); return r ? { title: M.routeName(id), text: r.desc || '', at: id } : null;
  }
  const t = M.track(id); return t ? { title: t.name, text: t.goal || '', at: null } : null;
}
const hrefOf = (k, id) => k === 'card' ? `#/notes/${id}` : k === 'track' ? `#/t/${id}` : M.findStage(id) ? `#/t/${M.findStage(id).t.id}?s=${encodeURIComponent(id)}` : `#/r/${encodeURIComponent(id)}`;
const KNAME = { card: '笔记', stage: '阶段', track: '路线' };

// 点赞 / 引用 / 被引用次数
export function reactBar(k, id) {
  const on = isLiked(store.all('likes'), k, id), n = citedBy(refIndex(store.all('refs')), k, id).length;
  return `<span class="rx-bar"><button type="button" class="rx" data-act="like-toggle" data-k="${k}" data-id="${esc(id)}" aria-pressed="${on}" aria-label="${on ? '取消点赞' : '点赞'}">${HEART}<span>${on ? '已赞' : '点赞'}</span></button>`
    + `<button type="button" class="rx" data-act="cite-open" data-k="${k}" data-id="${esc(id)}" aria-label="引用">${QUOTE}<span>引用</span></button>${n ? `<span class="rx-n" title="在你的笔记或路线里被引用的次数">被引用 ${n} 次</span>` : ''}</span>`;
}

// 一条内容下面的引用关系
export function refsHtml(k, id) {
  const ix = refIndex(store.all('refs')), out = citesOf(ix, k, id), inc = citedBy(ix, k, id);
  if (!out.length && !inc.length) return '';
  const row = (r, side) => {
    const e = side === 'out' ? r.to : r.from, d = describe(e.k, e.id);
    const st = side === 'out' ? refStatus(r, d ? d.text : null) : 'same';
    return `<li><span class="tag">${KNAME[e.k]}</span> ${d ? `<a href="${hrefOf(e.k, e.id)}">${esc(d.title)}</a>` : '<span class="fnt">已删除</span>'}${side === 'out' && st === 'changed' ? ' <span class="tag rel" title="原内容在你引用之后改过，这里保留的是引用时的文字">原内容已更新</span>' : ''}${side === 'out' && st === 'gone' ? ' <span class="tag">原内容已删除，引用处保留了文字</span>' : ''}<button type="button" class="lnk" data-act="ref-del" data-id="${r.qid}">取消引用</button></li>`;
  };
  return `<div class="refs">${out.length ? `<b>引用了</b><ul>${out.map(r => row(r, 'out')).join('')}</ul>` : ''}${inc.length ? `<b>被引用于</b><ul>${inc.map(r => row(r, 'in')).join('')}</ul>` : ''}</div>`;
}

act('like-toggle', el => {
  const { k, id } = el.dataset, key = likeKey(k, id), on = !store.get('likes', key);
  store.put('likes', key, on ? store.now() : null);
  document.querySelectorAll('.rx[data-act=like-toggle]').forEach(b => {
    if (b.dataset.k !== k || b.dataset.id !== id) return;
    b.setAttribute('aria-pressed', on); b.setAttribute('aria-label', on ? '取消点赞' : '点赞'); b.querySelector('span').textContent = on ? '已赞' : '点赞';
  });
});
act('ref-del', el => { const id = el.dataset.id, before = store.get('refs', id); store.del('refs', id); refresh(); toast('已取消引用', () => { store.put('refs', id, before); refresh(); }); });

/* ---------- 引用弹窗 ---------- */
let SRC = null;
function dlg() { let d = $('#citeDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'citeDlg'; d.setAttribute('aria-label', '引用'); document.body.appendChild(d); } return d; }
act('cite-open', el => {
  const { k, id } = el.dataset, d = describe(k, id); if (!d) return;
  SRC = { k, id, ...d };
  const cards = Object.entries(store.all('cards')).filter(([cid]) => !(k === 'card' && cid === id)).sort((a, b) => b[1].c - a[1].c).slice(0, 12);
  const stages = M.tracks().flatMap(t => M.state(t.id).stages.map((s, i) => ({ t, s, i }))).filter(x => !(k === 'stage' && x.s.id === id));
  const dd = dlg();
  dd.innerHTML = `<div class="dlg"><h3>引用</h3><p class="small mut">${KNAME[k]}「${esc(d.title)}」</p>
    <label class="field"><span>放到哪里</span><select id="citeTo">
      ${k === 'track' && M.track(id) ? '<option value="copy">复制成我的一条新路线（整条引用）</option>' : ''}
      <option value="new">新的笔记卡片</option>
      ${cards.length ? `<optgroup label="追加到已有笔记">${cards.map(([cid, c]) => `<option value="card:${cid}">${esc(c.t.split('\n')[0].slice(0, 36))}</option>`).join('')}</optgroup>` : ''}
      ${stages.length ? M.tracks().map(t => `<optgroup label="加一项参考任务：${esc(t.name)}">${stages.filter(x => x.t.id === t.id).map(x => `<option value="stage:${x.s.id}">${x.i + 1}. ${esc(x.s.title)}</option>`).join('')}</optgroup>`).join('') : ''}</select></label>
    <p class="hint">会保存引用当时的文字。原内容之后改了，引用处会提示“原内容已更新”，但仍保留当时的文字。</p>
    <div class="ft"><button type="button" class="btn gh" data-act="cite-close">取消</button><button type="button" class="btn pri" data-act="cite-do">引用</button></div></div>`;
  dd.showModal();
});
act('cite-close', () => dlg().close());
act('cite-do', () => {
  if (!SRC) return;
  const v = $('#citeTo').value, now = Date.now(), refId = 'q' + uid('');
  let from, msg = '已引用';
  if (v === 'copy') {
    const t = M.track(SRC.id); if (!t) return;
    const tid = 'u' + uid('').slice(0, 10), n = Object.keys(store.all('tracks')).length;
    // 先给“（我的版本）”留出位置，免得原名较长时后缀被 40 字上限截掉
    const suffix = '（我的版本）', name = (String(t.name || '').slice(0, 40 - suffix.length) + suffix).slice(0, 40);
    store.put('tracks', tid, { ...copyTrack(t, store.all('overlay'), { tid, color: PALETTE[n % PALETTE.length] }), name, short: name.slice(0, 8) });
    from = { k: 'track', id: tid }; msg = '已复制成新路线，原路线不变';
    try { const [id, r] = makeRef({ from, to: { k: 'track', id: t.id }, text: t.goal || t.name, id: refId, now }); store.put('refs', id, r); } catch (e) { /* 引用记录失败不影响复制 */ }
    dlg().close(); refresh(); toast(msg, () => { store.del('tracks', tid); store.del('refs', refId); refresh(); });
    location.hash = '#/t/' + tid; return;
  }
  if (v === 'new') {
    const cid = 'c' + uid('');
    store.put('cards', cid, { t: quoteMd(SRC.title, SRC.text) + '\n\n', at: SRC.at, c: now });
    from = { k: 'card', id: cid }; msg = '已引用到新笔记';
  } else if (v.startsWith('card:')) {
    const cid = v.slice(5), c = store.get('cards', cid); if (!c) return;
    store.put('cards', cid, { ...c, t: c.t.replace(/\s+$/, '') + '\n\n' + quoteMd(SRC.title, SRC.text) });
    from = { k: 'card', id: cid }; msg = '已追加到那条笔记';
  } else {
    const sid = v.slice(6);
    applyToStage(sid, [{ op: 'add', text: `参考：${SRC.title}` }]);
    store.ui().open[sid] = true; store.saveUi();
    from = { k: 'stage', id: sid }; msg = '已加为参考任务';
  }
  try { const [id, r] = makeRef({ from, to: { k: SRC.k, id: SRC.id }, text: SRC.text, id: refId, now }); store.put('refs', id, r); }
  catch (e) { toast(e.message); return; }
  dlg().close(); refresh(); toast(msg);
});
