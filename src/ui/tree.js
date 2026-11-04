// 知识树视图（方向页的第三个标签）：补充线路图，不替代它。Cytoscape.js 只在打开这里时才加载。
// 电脑上默认整张图；手机上默认只看当前阶段一跳内的局部图。点节点看详情，双击进入它的局部图。
import { $, esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { buildGraph, neighborhood } from '../core/graph.js';
import { act, refresh } from './kit.js';

let cy = null, lib = null;
const COLOR = { done: '#2E8B57', mastered: '#7A8A99', now: '#E0662B', todo: '#C9D1DA', skip: '#E6E9ED' };
const SHAPE = { track: 'round-rectangle', stage: 'round-rectangle', item: 'ellipse', res: 'diamond', route: 'round-tag', news: 'ellipse', note: 'round-rectangle' };
const small = () => matchMedia('(max-width: 820px)').matches;
// 整张图用固定的列布局：左边是任务和资源，中间是阶段主干（从上往下），右边是前沿路线，再右边是资讯
const ROW = 26, XI = -250, XS = 0, XR = 250, XN = 430;
function columns(g, tid) {
  const kids = id => g.edges.filter(e => e.source === id).map(e => g.nodes.find(n => n.id === e.target));
  const pos = {}; let y = 0;
  const block = (parent, x) => {
    const side = kids(parent).filter(n => n.type === 'item' || n.type === 'res' || n.type === 'note');
    const rs = kids(parent).filter(n => n.type === 'route');
    const top = y; let ry = y;
    for (const r of rs) { const ns = kids(r.id).filter(n => n.type !== 'route'); pos[r.id] = { x: XR, y: ry + (Math.max(ns.length, 1) - 1) * ROW / 2 }; ns.forEach((n, i) => { pos[n.id] = { x: XN, y: ry + i * ROW }; }); ry += Math.max(ns.length, 1) * ROW + 10; }
    side.forEach((n, i) => { pos[n.id] = { x: XI, y: top + i * ROW }; });
    const h = Math.max(ry - top, side.length * ROW, 60);
    pos[parent] = { x, y: top + Math.max(0, h - ROW) / 2 }; y = top + h + 24;
  };
  block(tid, XS);
  for (const n of g.nodes.filter(n => n.type === 'stage')) block(n.id, XS);
  return pos;
}

export function treeHtml(t, q) {
  const U = store.ui(), full = !!U.treeItems, focus = q.f || (small() ? M.state(t.id).current || '' : '');
  return `<div class="sh" style="margin-top:14px"><span class="mut small">方向 → 阶段 → 任务和资源；前沿路线挂在分出它的阶段上，资讯挂在路线上。颜色是进度：<i class="lg" style="background:${COLOR.done}"></i>学完 <i class="lg" style="background:${COLOR.now}"></i>在学 <i class="lg" style="background:${COLOR.todo}"></i>未学 <i class="lg" style="background:${COLOR.mastered}"></i>你标为已掌握</span>
    <span class="r"><button class="chip" data-act="tree-items" aria-pressed="${full}">显示任务和资源</button>${focus ? `<a class="chip" href="#/t/${t.id}/tree" style="text-decoration:none">看整张图</a>` : ''}</span></div>
    <div class="tree-wrap"><div id="tree" class="card tree" aria-label="知识树"></div><aside id="treeInfo" class="card tree-info"><p class="fnt small">点一个节点看详情；双击只看它周围的节点。</p></aside></div>`;
}

export async function afterTree(t, q) {
  const box = $('#tree'); if (!box) return;
  try { lib = lib || (await import('../../vendor/cytoscape.esm.min.mjs')).default; }
  catch (e) { box.innerHTML = '<p class="note">知识树的绘图库没有加载出来，刷新页面再试。</p>'; return; }
  const st = M.state(t.id);
  let g = buildGraph({ track: t, st, routes: M.routes(t.id).filter(r => !r.stopped), newsOf: M.routeNews, cards: store.all('cards'), docs: store.all('notes'), done: store.done() }, { items: !!store.ui().treeItems || !!q.f, news: q.f ? 6 : 3 });
  const focus = q.f || (small() ? st.current : '');
  if (focus && g.nodes.some(n => n.id === focus)) g = neighborhood(g, focus);
  if (cy) cy.destroy();
  cy = lib({
    container: box, minZoom: 0.2, maxZoom: 2.5, wheelSensitivity: 0.3,
    elements: [...g.nodes.map(n => ({ data: { ...n, c: COLOR[n.st] || COLOR.todo, label: n.label + (n.type === 'route' && n.n ? ` · ${n.n}` : n.type === 'stage' ? `\n${n.n}${n.notes ? ` · 笔记 ${n.notes}` : ''}` : '') } })), ...g.edges.map(e => ({ data: e }))],
    style: [
      { selector: 'node', style: { label: 'data(label)', 'font-size': 11, 'text-wrap': 'wrap', 'text-max-width': 130, 'text-valign': 'bottom', 'text-margin-y': 4, color: '#1B2430', 'background-color': 'data(c)', width: 14, height: 14, 'font-family': 'system-ui, sans-serif' } },
      ...Object.entries(SHAPE).map(([k, v]) => ({ selector: `node[type="${k}"]`, style: { shape: v } })),
      { selector: 'node[type="track"]', style: { width: 120, height: 34, 'text-valign': 'center', 'text-margin-y': 0, color: '#fff', 'background-color': '#1B2430', 'font-size': 14, 'font-weight': 700 } },
      { selector: 'node[type="stage"]', style: { width: 150, height: 44, 'text-max-width': 140, 'text-valign': 'center', 'text-margin-y': 0, 'font-size': 12, 'font-weight': 600, color: '#fff' } },
      { selector: 'node[type="stage"][st="todo"]', style: { color: '#1B2430' } },
      { selector: 'node[type="route"]', style: { width: 18, height: 18, 'background-color': '#8C63C8' } },
      { selector: 'node[type="news"]', style: { width: 8, height: 8, 'background-color': '#F0B429', 'font-size': 10, color: '#5B6573', 'text-halign': 'right', 'text-valign': 'center', 'text-margin-x': 6, 'text-margin-y': 0, 'text-max-width': 220 } },
      { selector: 'node[type="item"], node[type="res"]', style: { 'text-halign': 'left', 'text-valign': 'center', 'text-margin-x': -6, 'text-margin-y': 0, 'font-size': 10.5, 'text-max-width': 200 } },
      { selector: 'node[type="route"]', style: { 'text-halign': 'center', 'text-valign': 'top', 'text-margin-y': -3, 'font-size': 11, color: '#5B3E8C', 'text-max-width': 160 } },
      { selector: 'node[type="note"]', style: { width: 12, height: 12, 'background-color': '#3C6E71' } },
      { selector: 'node[type="item"][?practice]', style: { 'border-width': 2, 'border-color': '#E0662B' } },
      { selector: 'edge', style: { width: 1.2, 'line-color': '#C9D1DA', 'curve-style': 'bezier' } },
      { selector: 'edge[k="next"]', style: { width: 4, 'line-color': '#1B2430', 'target-arrow-shape': 'triangle', 'target-arrow-color': '#1B2430' } },
      { selector: 'edge[k="route"]', style: { 'line-style': 'dashed', 'line-color': '#8C63C8' } },
      { selector: 'edge[k="news"]', style: { 'curve-style': 'straight', 'line-color': '#E9DCF7' } },
      { selector: ':selected', style: { 'border-width': 3, 'border-color': '#2557D6' } }
    ],
    layout: focus ? { name: 'breadthfirst', directed: true, roots: [focus], spacingFactor: 1.1, padding: 20, animate: false }
      : { name: 'preset', positions: (P => n => P[n.id()] || { x: 0, y: 0 })(columns(g, t.id)), fit: true, padding: 24 }
  });
  cy.on('tap', 'node', e => info(t, e.target.data()));
  cy.on('dbltap', 'node', e => { const d = e.target.data(); if (d.type === 'stage' || d.type === 'route') location.hash = `#/t/${t.id}/tree?f=${encodeURIComponent(d.id)}`; });
  if (focus) { const n = cy.getElementById(focus); if (n.nonempty()) { n.select(); info(t, n.data()); } }
}

function info(t, d) {
  const el = $('#treeInfo'); if (!el) return;
  const local = (d.type === 'stage' || d.type === 'route') ? `<a class="btn sm gh" href="#/t/${t.id}/tree?f=${encodeURIComponent(d.id)}">只看它周围</a>` : '';
  let body = '';
  if (d.type === 'stage') { const f = M.findStage(d.id); body = f ? `<p class="small">${esc(f.s.goal)}</p><p class="small">${d.n} 项完成${d.notes ? ` · ${d.notes} 篇笔记` : ''}</p>` : ''; }
  else if (d.type === 'route') { const r = M.route(d.id); body = r ? `<p class="small">${esc(r.desc)}</p><p class="small">${d.n} 条进展</p>` : ''; }
  else if (d.type === 'item') body = `<p class="small">${esc(d.full)}</p><p class="small">${d.st === 'done' ? '已完成' : d.st === 'skip' ? '已跳过' : '未完成'}${d.practice ? ' · 实践验证' : ''}</p>`;
  else if (d.type === 'news') body = `<p class="small">${esc(d.d || '')} ${esc(d.full)}</p>`;
  const open = d.href ? `<a class="btn sm" href="${esc(d.href)}">打开</a>` : d.url ? `<a class="btn sm" href="${esc(d.url)}" target="_blank" rel="noopener">看原文</a>` : '';
  el.innerHTML = `<b>${esc(d.full || d.label.split('\n')[0])}</b>${body}<div class="sa">${open}${local}</div>`;
}

act('tree-items', () => { const U = store.ui(); U.treeItems = !U.treeItems; store.saveUi(); refresh(); });
