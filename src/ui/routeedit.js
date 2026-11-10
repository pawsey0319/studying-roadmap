// 路线编辑：在自己已有的方向里增删阶段，不用重新规划整条路线。
// 公共方向只改个人层（ext.<方向>）：新增追加、删除只是隐藏，恢复原版随时能回来。
import { $, esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { uid } from '../core/ids.js';
import { makeStage, stageIds, addOwnStage, removeOwnStage, addExtStage, hideExtStage, unhideExtStage } from '../core/routeedit.js';
import { act, refresh, toast } from './kit.js';

const PALETTE = ['#3C6E71', '#B5446E', '#5B7F1F', '#AF6E1A', '#2E6FA7', '#7A4E9C'];

const dlg = () => {
  let d = $('#reDlg');
  if (!d) { d = document.createElement('dialog'); d.id = 'reDlg'; d.setAttribute('aria-label', '编辑路线'); document.body.appendChild(d); }
  return d;
};
const extOf = trackId => store.get('tracks', 'ext.' + trackId) || {};

function stageRow(s, i, own) {
  return `<li class="re-row"><div class="re-no">${i + 1}</div><div class="re-info"><b>${esc(s.title)}</b>
      <small>${esc(s.goal || '没有写目标')} · ${s.items.length} 项任务</small></div>
    <div class="re-ops">${own
      ? `<button class="btn sm gh" data-act="re-del-stage" data-id="${esc(s.id)}">删除</button>`
      : `<button class="btn sm gh" data-act="re-hide-stage" data-id="${esc(s.id)}">隐藏</button>`}</div></li>`;
}

function render(trackId) {
  const t = M.track(trackId);
  if (!t) return;
  const own = !!t.mine, ext = own ? null : extOf(trackId), hidden = new Set((ext && ext.hidden) || []);
  const visible = t.stages.filter(s => !hidden.has(s.id));
  // M.track 已经把隐藏的滤掉了；恢复列表要用公共路线的原版阶段
  const baseStages = own ? t.stages : ((M.library().find(x => x.id === trackId) || {}).stages || []);
  const hiddenRows = own ? [] : baseStages.filter(s => hidden.has(s.id));
  dlg().dataset.track = trackId;
  dlg().innerHTML = `<div class="dlg re"><div class="re-h"><div><h3>编辑路线</h3><p class="fnt small">${esc(t.name)}${own ? ' · 你自己的方向' : ' · 公共方向，只改你的副本'}</p></div><button class="x" data-act="re-close" aria-label="关闭">×</button></div>
    <p class="hint">${own ? '增删会直接改这条方向。' : '新增的阶段只加给你；删除公共阶段只是隐藏，随时能恢复原版。'}已有路线不会因此重新生成。</p>
    <ol class="re-list">${visible.map((s, i) => stageRow(s, i, own)).join('') || '<li class="empty">还没有阶段。</li>'}</ol>
    ${hiddenRows.length ? `<details class="re-hidden"><summary>已隐藏 ${hiddenRows.length} 个阶段</summary><ul>${hiddenRows.map(s => `<li><span>${esc(s.title)}</span><button class="btn sm gh" data-act="re-unhide-stage" data-id="${esc(s.id)}">恢复</button></li>`).join('')}</ul></details>` : ''}
    <form class="re-add" id="reAddForm"><h4>添加一个阶段</h4>
      <label class="field"><span>阶段名</span><input name="title" maxlength="120" placeholder="例如：把 RAG 接进自己的笔记" required></label>
      <label class="field"><span>目标（可以不填）</span><input name="goal" maxlength="600" placeholder="学完能做什么"></label>
      <label class="field"><span>任务（一行一条）</span><textarea name="items" rows="3" placeholder="读一遍文档&#10;写一个最小 demo"></textarea></label>
      <div class="re-f"><button type="button" class="btn gh" data-act="re-close">取消</button><button class="btn pri">添加阶段</button></div>
    </form>
    ${own ? `<div class="re-danger"><button class="btn sm gh" data-act="track-remove" data-id="${esc(trackId)}">删除这个方向</button><span class="fnt small">只删除你导入或新建的方向，进度和笔记会一起移除。</span></div>` : ''}
  </div>`;
  const f = $('#reAddForm');
  if (f) f.onsubmit = e => {
    e.preventDefault();
    const st = makeStage(trackId, stageIds(visible), { title: f.title.value, goal: f.goal.value, items: f.items.value });
    if (own) store.put('tracks', trackId, addOwnStage({ ...M.track(trackId) }, st));
    else store.put('tracks', 'ext.' + trackId, addExtStage(extOf(trackId), st));
    M.invalidate(); toast(`已添加阶段“${st.title}”`); render(trackId); refresh();
  };
}

export function openRouteEditor(trackId) {
  if (!M.track(trackId)) { toast('找不到这个方向'); return; }
  render(trackId);
  const d = dlg(); if (!d.open) d.showModal();
}

act('re-close', () => { const d = $('#reDlg'); if (d) d.close(); refresh(); });
act('re-del-stage', el => {
  const id = el.dataset.id;
  const trackId = dlg().dataset.track || currentTrack();
  const before = JSON.parse(JSON.stringify(M.track(trackId)));
  store.put('tracks', trackId, removeOwnStage(before, id)); M.invalidate(); refresh(); render(trackId);
  toast('已删除阶段', () => { store.put('tracks', trackId, before); M.invalidate(); refresh(); render(trackId); });
});
act('re-hide-stage', el => {
  const trackId = dlg().dataset.track || currentTrack();
  store.put('tracks', 'ext.' + trackId, hideExtStage(extOf(trackId), el.dataset.id)); M.invalidate(); refresh(); render(trackId);
  toast('已隐藏这个阶段，可在“已隐藏”里恢复');
});
act('re-unhide-stage', el => {
  const trackId = dlg().dataset.track || currentTrack();
  store.put('tracks', 'ext.' + trackId, unhideExtStage(extOf(trackId), el.dataset.id)); M.invalidate(); refresh(); render(trackId);
});
act('track-edit', el => openRouteEditor(el.dataset.id));
act('track-remove', el => {
  const t = M.track(el.dataset.id); if (!t) return;
  if (!confirm(`删除方向“${t.name}”？这条方向会从列表移除；已经写下的笔记和进度会保留。`)) return;
  const d = $('#reDlg'); if (d && d.open) d.close();
  if (t.mine) {
    const id = t.id, before = JSON.parse(JSON.stringify(store.get('tracks', id)));
    store.del('tracks', id); M.invalidate(); location.hash = '#/library'; refresh();
    toast('已删除方向', () => { store.put('tracks', id, before); M.invalidate(); refresh(); });
  } else {
    store.setAdopted(t.id, false); M.invalidate(); location.hash = '#/library'; refresh();
    toast('已移出我的方向。进度和笔记都保留，重新加入就能恢复', () => { store.setAdopted(t.id, true); M.invalidate(); refresh(); });
  }
});
act('new-track', () => {
  const name = prompt('新方向叫什么？');
  if (name === null) return;
  const n = String(name).trim().slice(0, 40); if (!n) return;
  const id = 'u' + uid('').slice(0, 10), k = Object.keys(store.all('tracks')).filter(x => x.startsWith('u')).length;
  store.put('tracks', id, { id, domain: 'mine', name: n, short: n.slice(0, 8), color: PALETTE[k % PALETTE.length], goal: '', source: '自己新建', stages: [] });
  M.invalidate(); location.hash = '#/t/' + id; refresh();
  setTimeout(() => openRouteEditor(id), 60);
});

let currentTrack = () => (location.hash.match(/^#\/t\/([^/?]+)/) || [])[1] || '';
