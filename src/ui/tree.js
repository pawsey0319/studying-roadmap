// 知识树：主干是领域下的各个方向，往下是子方向、再细的子方向。
// “扩散”一次多显示一层；已经到底时，让 AI 把最外一层再细分一层，你勾选确认后存进自己的树。“收缩”回到上一步。
// 树画成横向展开的动态树状图；节点上只有名字和数量，点开才在旁边显示挂在它上面的资讯、论文、你的笔记、相关的学习阶段和前沿路线。
// 知识树只在各个方向页里（方向页的“知识树”标签），根是这个方向。
import { $, esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { buildTree, visible, maxDepth, frontier, attach, pathOf, expandPrompt, cleanKids } from '../core/taxonomy.js';
import { looseJSON } from '../ai/agent.js';
import { chat } from '../ai/providers.js';
import { aiCfg, aiBlock } from './agentui.js';
import { openReader } from './reader.js';
import { uid } from '../core/ids.js';
import { act, refresh, toast } from './kit.js';
import { stageLabel } from './home.js';
import { addBoardButtons } from './translate.js';

const MAX_AI = 8;   // 一次最多让 AI 细分几个节点
let busy = false, PREVIEW = null;
const tax = () => M.C.taxonomy || { tracks: {} };
const keyOf = root => 'tree:' + root;
function state(root) {
  const U = store.ui(); U.tree = U.tree || {};
  return (U.tree[keyOf(root)] = U.tree[keyOf(root)] || { depth: root === 'domain' ? 1 : 1, hist: [], open: {}, focus: '' });
}
function makeTree(root) {
  return buildTree({ tax: tax(), tracks: M.tracks().map(t => ({ id: t.id, name: t.name })), mine: store.all('tree'), root, domainName: '我的学习领域' });
}
let CACHE = null;
function data(root) {
  const tree = makeTree(root); if (!tree) return null;
  const sig = root + '|' + M.readingPool().length + '|' + Object.keys(store.all('cards')).length + '|' + Object.keys(store.all('tree')).length;
  if (!CACHE || CACHE.sig !== sig) CACHE = { sig, att: attach(tree, M.readingPool(), store.all('cards')) };
  return { tree, att: CACHE.att };
}

export function treeHtml(t, q = {}) { return render(t.id, q); }

// 页面上只放工具栏和画布；树本身由 drawTree 画（节点是 HTML 方块，连线是 SVG），扩散和收缩时节点从原位置平滑移动到新位置
function render(root, q) {
  const D = data(root); if (!D) return '<p class="empty">没有这个方向。</p>';
  if (q.f && D.tree.byId.has(q.f)) state(root).focus = q.f;
  return `<div class="tr-bar" id="trBar" data-root="${root}">${barHtml(root, D)}</div>
    ${PREVIEW && PREVIEW.root === root ? previewHtml() : ''}
    <div class="tr-stage"><div class="card tr-wrap"><div class="tr-canvas" id="trCanvas" data-root="${root}"></div></div>
      <aside class="card tr-info" id="trInfo"><p class="fnt small">点树上的一个节点，这里显示挂在它上面的资讯、论文、笔记、学习阶段和前沿路线。</p></aside></div>
    <p class="fnt small">前两层是整理好的分类，更细的由 AI 按你的需要生成（虚线框）。资讯和论文按关键词、前沿路线自动挂到最细的那一层，上层节点的数字包含它下面的全部内容。</p>`;
}
function barHtml(root, D) {
  const S = state(root), focus = S.focus && D.tree.byId.has(S.focus) ? S.focus : '';
  const depth = Math.max(0, S.depth), deepest = maxDepth(D.tree, focus);
  const crumbs = focus ? pathOf(D.tree, focus).map(n => n.id === focus ? `<b>${esc(n.name)}</b>` : `<button class="lnk" data-act="tree-focus" data-root="${root}" data-id="${n.id === D.tree.root.id ? '' : n.id}">${esc(n.name)}</button>`).join(' › ') : '';
  return `<button class="btn pri" data-act="tree-expand" data-root="${root}"${busy ? ' disabled' : ''} title="多显示一层；已经到底时让 AI 再细分一层">${busy ? '正在细分…' : '扩散'}</button>
    <button class="btn" data-act="tree-shrink" data-root="${root}"${S.hist.length || depth > 0 ? '' : ' disabled'} title="回到上一步的树">收缩</button>
    <span class="fnt small">现在显示 ${depth} 层${deepest > depth ? `，往下还有 ${deepest - depth} 层` : '，再扩散会让 AI 细分'}</span>
    ${focus ? `<span class="tr-crumb">只看：${crumbs} <button class="lnk" data-act="tree-focus" data-root="${root}" data-id="">看全部</button></span>` : ''}`;
}

/* ---------- 画树：横向展开，根在左，子方向往右 ---------- */
const COLW = 214, ROWH = 62, NW = 178, NH = 48, PAD = 18;
let LAST = { root: null, pos: new Map() }, anim = 0;
function layout(D, S) {
  const focus = S.focus && D.tree.byId.has(S.focus) ? S.focus : '';
  const start = focus ? D.tree.byId.get(focus) : D.tree.root, shown = new Set(visible(D.tree, Math.max(0, S.depth), focus).map(n => n.id));
  const pos = new Map(), edges = []; let row = 0;
  const walk = n => {
    const kids = n.kids.filter(k => shown.has(k.id));
    let y;
    if (!kids.length) y = row++ * ROWH;
    else { const ys = kids.map(k => { edges.push([n.id, k.id]); return walk(k); }); y = (ys[0] + ys[ys.length - 1]) / 2; }
    pos.set(n.id, { x: (n.depth - start.depth) * COLW, y, n, hidden: n.kids.length - kids.length });
    return y;
  };
  walk(start);
  return { pos, edges, start };
}
export function drawTree(root) {
  const box = $('#trCanvas'); if (!box || box.dataset.root !== root) return;
  const D = data(root), S = state(root), L = layout(D, S);
  const from = LAST.root === root ? LAST.pos : new Map();
  const W = Math.max(...[...L.pos.values()].map(p => p.x)) + NW + PAD * 2, H = Math.max(...[...L.pos.values()].map(p => p.y)) + NH + PAD * 2;
  // 新出现的节点从父节点原来的位置长出来；消失的节点缩回父节点
  const parentPos = id => { let n = D.tree.byId.get(id); while (n && n.parent) { n = D.tree.byId.get(n.parent); if (n && from.has(n.id)) return from.get(n.id); if (n && L.pos.has(n.id)) return L.pos.get(n.id); } return { x: 0, y: L.pos.get(L.start.id).y }; };
  const gone = [...from.keys()].filter(id => !L.pos.has(id) && D.tree.byId.has(id));
  const target = id => L.pos.get(id) || (() => { let n = D.tree.byId.get(id); while (n && n.parent && !L.pos.has(n.parent)) n = D.tree.byId.get(n.parent); return n && n.parent ? L.pos.get(n.parent) : L.pos.get(L.start.id); })();
  const ids = [...L.pos.keys(), ...gone];
  const sel = S.sel && L.pos.has(S.sel) ? S.sel : '';
  box.style.width = Math.max(W, box.offsetWidth ? 0 : 0) + 'px'; box.style.height = H + 'px';
  box.innerHTML = `<svg class="tr-svg" width="${W}" height="${H}"></svg>` + ids.map(id => {
    const n = D.tree.byId.get(id), a = D.att.get(id), p = L.pos.get(id), hidden = p ? p.hidden : 0;
    const cnt = [a.news.size && `${a.news.size} 资讯`, a.papers.size && `${a.papers.size} 论文`, a.notes.size && `${a.notes.size} 笔记`].filter(Boolean).join(' · ') || '暂无内容';
    return `<button class="tn d${Math.min(n.depth - L.start.depth, 3)}${n.ai ? ' ai' : ''}${id === sel ? ' on' : ''}" data-act="tree-sel" data-root="${root}" data-id="${id}" title="${esc(n.name)}${n.en ? ' · ' + esc(n.en) : ''}">
      <span class="tn-name">${esc(n.name)}</span><span class="tn-c">${cnt}</span>${hidden ? `<span class="tn-more" title="还有 ${hidden} 个子方向，点“扩散”展开">+${hidden}</span>` : ''}</button>`;
  }).join('');
  const els = new Map([...box.querySelectorAll('.tn')].map(e => [e.dataset.id, e])), svg = box.querySelector('svg');
  const st = new Map(ids.map(id => [id, from.get(id) || parentPos(id)])), en = new Map(ids.map(id => [id, target(id)]));
  const edgePairs = [...L.edges, ...gone.map(id => [D.tree.byId.get(id).parent, id]).filter(([p]) => from.has(p) || L.pos.has(p))];
  const path = (a, b) => { const x1 = a.x + NW + PAD, y1 = a.y + NH / 2 + PAD, x2 = b.x + PAD, y2 = b.y + NH / 2 + PAD, mx = (x1 + x2) / 2; return `M${x1},${y1} C${mx},${y1} ${mx},${y2} ${x2},${y2}`; };
  svg.innerHTML = edgePairs.map(([a, b]) => `<path data-e="${a}>${b}" class="${gone.includes(b) ? 'go' : ''}"/>`).join('');
  const paths = [...svg.querySelectorAll('path')];
  const T0 = performance.now(), DUR = from.size ? 380 : 520, me = ++anim;
  const ease = t => 1 - Math.pow(1 - t, 3);
  const frame = now => {
    if (me !== anim) return;
    const k = ease(Math.min(1, (now - T0) / DUR)), at = id => { const a = st.get(id), b = en.get(id); return { x: a.x + (b.x - a.x) * k, y: a.y + (b.y - a.y) * k }; };
    for (const [id, e] of els) { const p = at(id); e.style.transform = `translate(${p.x + PAD}px,${p.y + PAD}px)`; e.style.opacity = gone.includes(id) ? 1 - k : from.has(id) ? 1 : k; }
    paths.forEach((el, i) => { const [a, b] = edgePairs[i]; el.setAttribute('d', path(at(a), at(b))); if (gone.includes(b) || !from.has(b)) el.style.opacity = gone.includes(b) ? 1 - k : k; });
    if (k < 1) requestAnimationFrame(frame);
    else { gone.forEach(id => els.get(id) && els.get(id).remove()); paths.forEach((el, i) => gone.includes(edgePairs[i][1]) && el.remove()); }
  };
  requestAnimationFrame(frame);
  LAST = { root, pos: new Map([...L.pos].map(([id, p]) => [id, { x: p.x, y: p.y }])) };
  if (sel) showInfo(root, sel); else $('#trInfo').innerHTML = '<p class="fnt small">点树上的一个节点，这里显示挂在它上面的资讯、论文、笔记、学习阶段和前沿路线。</p>';
}
function showInfo(root, id) {
  const D = data(root), n = D.tree.byId.get(id), el = $('#trInfo'); if (!n || !el) return;
  el.innerHTML = `<div class="tr-ih"><b>${esc(n.name)}</b><button class="x" data-act="tree-sel" data-root="${root}" data-id="${id}" aria-label="收起">×</button></div>` + panel(root, n, D.att.get(id));
  addBoardButtons && addBoardButtons(el);
}
// 不重画整页，只更新工具栏和树（这样才有动画）
function redraw(root) {
  const bar = $('#trBar'); if (!bar || bar.dataset.root !== root) { refresh(); return; }
  bar.innerHTML = barHtml(root, data(root));
  drawTree(root);
}
export function afterTree(t) { LAST = { root: null, pos: new Map() }; drawTree(t.id); }

function panel(root, n, a) {
  const pool = M.readingPool(), byId = new Map(pool.map(x => [x.id, x]));
  const list = (set, max) => [...set].map(id => byId.get(id)).filter(Boolean).sort((x, y) => (x.d < y.d ? 1 : -1)).slice(0, max);
  const row = x => `<li class="${M.isRead(x.id) ? 'is-read' : ''}"><button class="rdl" data-act="rd-go" data-id="${x.id}">${esc(x.t)}</button><span class="fnt small"> ${esc(x.src || '')}${x.d ? ' · ' + esc(String(x.d).slice(5)) : ''}</span></li>`;
  const news = list(a.news, 6), papers = list(a.papers, 4), cards = store.all('cards');
  const notes = [...a.notes].filter(id => cards[id]).slice(0, 5);
  const stages = [...a.stages].filter(id => M.findStage(id)).slice(0, 4), routes = [...a.routes].filter(id => M.route(id)).slice(0, 4);
  const sec = (h, n2, body) => body ? `<div class="tr-sec"><b>${h}${n2 > 0 ? ` <span class="fnt">${n2}</span>` : ''}</b>${body}</div>` : '';
  return `<div class="tr-p">
    ${n.en ? `<div class="fnt small">${esc(n.en)}</div>` : ''}
    ${sec('资讯', a.news.size, news.length ? `<ul class="rd-l">${news.map(row).join('')}</ul>` : '')}
    ${sec('论文', a.papers.size, papers.length ? `<ul class="rd-l">${papers.map(row).join('')}</ul>` : '')}
    ${sec('我的笔记', a.notes.size, notes.length ? `<ul class="rd-l">${notes.map(id => `<li><a href="#/notes/${id}">${esc(cards[id].t.split('\n')[0].slice(0, 60))}</a></li>`).join('')}</ul>` : '')}
    ${sec('学习阶段', 0, stages.length ? `<div class="chips">${stages.map(id => `<a class="chip" href="#/t/${id.split('.')[0]}?s=${encodeURIComponent(id)}">${esc(stageLabel(id))}</a>`).join('')}</div>` : '')}
    ${sec('前沿路线', 0, routes.length ? `<div class="chips">${routes.map(id => `<a class="chip" href="#/r/${encodeURIComponent(id)}">${esc(M.routeName(id))}</a>`).join('')}</div>` : '')}
    ${!news.length && !papers.length && !notes.length ? '<p class="fnt small">还没有挂上内容。资讯每天更新，命中这个方向的关键词后会出现在这里。</p>' : ''}
    <div class="sa">${n.kids.length ? `<button class="btn sm gh" data-act="tree-focus" data-root="${root}" data-id="${n.id}">只看这一支</button>` : ''}
      ${n.id !== 'domain' ? `<button class="btn sm gh" data-act="tree-split" data-root="${root}" data-id="${n.id}"${busy ? ' disabled' : ''}>让 AI 细分这个</button>` : ''}
      ${n.ai ? `<button class="btn sm gh" data-act="tree-del" data-root="${root}" data-id="${n.id}">删掉这个子方向</button>` : ''}</div></div>`;
}

function previewHtml() {
  const P = PREVIEW, T = makeTree(P.root);
  return `<div class="card tr-prev"><b>AI 给出的细分</b><span class="fnt small">勾选要保留的，确认后加进你的树（只存在你的数据里）</span>
    ${Object.entries(P.kids).map(([pid, L]) => `<div class="tr-pg"><div class="small"><b>${esc((T.byId.get(pid) || {}).name || pid)}</b> →</div>
      ${L.map((k, i) => `<label class="exi"><input type="checkbox" data-trk="${esc(pid)}|${i}" checked><span>${esc(k.name)}${k.en ? ` <small>${esc(k.en)}</small>` : ''}<small>关键词：${esc(k.kw.join('、'))}</small></span><span></span></label>`).join('')}</div>`).join('')}
    <div class="sa"><button class="btn sm gh" data-act="tree-prev-drop">都不要</button><button class="btn sm pri" data-act="tree-prev-ok">加进我的树</button></div></div>`;
}

async function aiSplit(root, nodes) {
  const cfg = await aiCfg(), block = aiBlock(cfg);
  if (block) { toast(block); return; }
  const T = makeTree(root);
  busy = true; refresh();
  try {
    const res = await chat(cfg, [{ role: 'user', content: expandPrompt(T, nodes) }], { maxTokens: 2500, temperature: 0.3 });
    const m = res.text.match(/```(?:json)?\s*([\s\S]*?)```/), kids = cleanKids(looseJSON(m ? m[1] : res.text), new Set(nodes.map(n => n.id)));
    if (!Object.keys(kids).length) toast('AI 没有给出可用的细分，换个模型或稍后再试');
    else PREVIEW = { root, kids };
  } catch (e) { toast('细分失败：' + (e.message || e)); }
  busy = false; refresh();
}

// 点节点：在旁边展开它的内容；再点一次收起
act('tree-sel', el => {
  const root = el.dataset.root, S = state(root), id = el.dataset.id;
  S.sel = S.sel === id ? '' : id; store.saveUi();
  document.querySelectorAll('#trCanvas .tn').forEach(e => e.classList.toggle('on', e.dataset.id === S.sel));
  if (S.sel) { showInfo(root, id); if (matchMedia('(max-width: 820px)').matches) $('#trInfo').scrollIntoView({ behavior: 'smooth', block: 'start' }); }
  else $('#trInfo').innerHTML = '<p class="fnt small">点树上的一个节点，这里显示挂在它上面的资讯、论文、笔记、学习阶段和前沿路线。</p>';
});
act('tree-focus', el => { const S = state(el.dataset.root); S.hist.push({ depth: S.depth, focus: S.focus }); S.focus = el.dataset.id; S.depth = Math.max(1, Math.min(S.depth, 2)); store.saveUi(); redraw(el.dataset.root); });
act('tree-shrink', el => {
  const S = state(el.dataset.root), h = S.hist.pop();
  if (h) { S.depth = h.depth; S.focus = h.focus; } else S.depth = Math.max(0, S.depth - 1);
  if (PREVIEW) { PREVIEW = null; store.saveUi(); refresh(); return; }
  store.saveUi(); redraw(el.dataset.root);
});
act('tree-expand', async el => {
  const root = el.dataset.root, S = state(root), D = data(root), focus = S.focus && D.tree.byId.has(S.focus) ? S.focus : '';
  if (maxDepth(D.tree, focus) > S.depth) { S.hist.push({ depth: S.depth, focus: S.focus }); S.depth++; store.saveUi(); redraw(root); return; }
  const F = frontier(D.tree, S.depth, focus);
  if (!F.length) { toast('已经没有可以再细分的节点'); return; }
  // 节点太多时，先细分挂内容最多的几个；想细分别的，点开节点用“让 AI 细分这个”
  const pick = F.sort((a, b) => (D.att.get(b.id).news.size + D.att.get(b.id).papers.size) - (D.att.get(a.id).news.size + D.att.get(a.id).papers.size)).slice(0, MAX_AI);
  if (F.length > MAX_AI) toast(`最外一层有 ${F.length} 个节点，先细分内容最多的 ${MAX_AI} 个`);
  await aiSplit(root, pick);
});
act('tree-split', el => { const T = makeTree(el.dataset.root), n = T.byId.get(el.dataset.id); if (n) aiSplit(el.dataset.root, [n]); });
act('tree-prev-drop', () => { PREVIEW = null; refresh(); });
act('tree-prev-ok', () => {
  const P = PREVIEW; if (!P) return;
  const keep = new Set([...document.querySelectorAll('input[data-trk]')].filter(i => i.checked).map(i => i.dataset.trk));
  let n = 0;
  for (const [pid, L] of Object.entries(P.kids)) {
    const add = L.filter((_, i) => keep.has(pid + '|' + i)).map(k => ({ k: 'x' + uid('').slice(-6), ...k }));
    if (!add.length) continue;
    const cur = store.get('tree', pid) || { kids: [] };
    store.put('tree', pid, { kids: [...cur.kids, ...add].slice(0, 8), u: Date.now() }); n += add.length;
  }
  const S = state(P.root); S.hist.push({ depth: S.depth, focus: S.focus }); S.depth++; store.saveUi();
  PREVIEW = null; refresh(); toast(n ? `加了 ${n} 个子方向` : '没有勾选任何一项');
});
act('tree-del', el => {
  const id = el.dataset.id, pid = id.slice(0, id.lastIndexOf('.')), k = id.slice(id.lastIndexOf('.') + 1), cur = store.get('tree', pid);
  if (!cur) return;
  const before = JSON.parse(JSON.stringify(cur)), kids = cur.kids.filter(x => x.k !== k);
  // 它下面 AI 生成的子方向一起删掉
  for (const key of Object.keys(store.all('tree'))) if (key.startsWith(id + '.') || key === id) store.del('tree', key);
  store.put('tree', pid, kids.length ? { kids, u: Date.now() } : null); refresh();
  toast('已删掉', () => { store.put('tree', pid, before); refresh(); });
});
export const _openReader = openReader;
