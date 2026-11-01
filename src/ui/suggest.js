// 修改方案与“等你确认”：每周自动更新的建议（content/suggestions.json）+ 学习 Agent 生成后你选择“稍后决定”的方案。
// 方案 = { id, from: 'weekly'|'agent', title, why, track, stage, route?, ops: [...] }，ops 见 core/overlay.js。
import { esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { applyOps, needsManualConfirm } from '../core/overlay.js';
import { uid } from '../core/ids.js';
import { act, refresh, toast } from './kit.js';

export function pendingSuggestions() {
  const done = store.all('sugs'), local = store.ui().pending || [];
  const weekly = (M.C.suggestions.items || []).map(s => ({ ...s, from: 'weekly' }));
  return [...local, ...weekly].filter(s => !done[s.id] && (!s.stage || M.findStage(s.stage)));
}
export const findSug = id => pendingSuggestions().find(s => s.id === id);

export function savePending(s) {
  const u = store.ui();
  u.pending = [{ ...s, id: s.id || 'a' + uid(''), from: s.from || 'agent' }, ...(u.pending || [])].slice(0, 30);
  store.saveUi(); refresh();
}

// 应用到个人层；返回撤销函数
export function applyToStage(stageId, ops) {
  const before = store.get('overlay', stageId);
  const f = M.findStage(stageId);
  const prefix = (f ? f.s.id : stageId) + '.u';
  const next = applyOps(before, ops, () => uid(prefix));
  store.put('overlay', stageId, Object.keys(next).length ? { ...next, at: Date.now() } : null);
  return () => { store.put('overlay', stageId, before || null); refresh(); };
}

const OPN = { goal: '改目标', skip: '建议跳过', unskip: '恢复', add: '新增', edit: '改写', res: '加资源', mastered: '建议标为已掌握', unmastered: '取消已掌握' };
const OPC = { goal: 'c', skip: 's', unskip: 'a', add: 'a', edit: 'c', res: 'a', mastered: 's', unmastered: 'a' };
function opText(op, stage) {
  const it = id => { const x = stage && stage.items.find(i => i.id === id); return x ? x.text : id; };
  switch (op.op) {
    case 'goal': return op.text;
    case 'skip': case 'unskip': return it(op.id);
    case 'edit': return `${it(op.id)} → ${op.text}`;
    case 'add': return `${op.mode === 'practice' ? '实践验证：' : ''}${op.text}`;
    case 'res': return `${op.name}${op.url ? ` <span class="tag ai">AI 推荐，未核实</span>` : ''}`;
    default: return '';
  }
}

// 对比卡：每条可勾选；跳过和已掌握默认不勾，必须你手动勾上
export function planCard(plan, opts = {}) {
  const f = plan.stage ? M.findStage(plan.stage) : null;
  const rows = (plan.ops || []).map((op, i) => `<label class="drow"><input type="checkbox" data-op="${i}"${needsManualConfirm(op) ? '' : ' checked'}>
    <div><span class="op ${OPC[op.op] || 'c'}">${OPN[op.op] || op.op}</span>${op.op === 'res' ? opText(op, f && f.s) : esc(opText(op, f && f.s))}
    ${op.why ? `<span class="why">${esc(op.why)}</span>` : ''}${needsManualConfirm(op) ? '<span class="why">跳过只能由你决定，需要的话勾上这一项</span>' : ''}</div></label>`).join('');
  return `<div class="plan" data-plan="${esc(plan.id)}"><div class="ph2">修改方案 · ${esc(f ? f.s.title : plan.title)}<span>${plan.ops.length} 项</span></div>
    ${rows || '<p class="empty">这份方案没有具体修改。</p>'}
    <div class="pf">${opts.later ? `<button class="btn sm gh" data-act="plan-later" data-id="${esc(plan.id)}">稍后决定</button>` : ''}
      <button class="btn sm gh" data-act="plan-drop" data-id="${esc(plan.id)}">放弃</button>
      <button class="btn sm acc" data-act="plan-apply" data-id="${esc(plan.id)}">应用勾选的</button></div></div>`;
}

// 方案对象的临时登记（对比卡按 id 找回）
const PLANS = new Map();
export const registerPlan = p => { PLANS.set(p.id, p); return p; };
export const getPlan = id => PLANS.get(id) || findSug(id);

function applyPlan(plan, picked) {
  const ops = picked ? plan.ops.filter((_, i) => picked.includes(i)) : plan.ops;
  if (!ops.length) { toast('没有勾选任何一项'); return; }
  if (plan.kind === 'route') { // 新前沿路线候选：开始跟踪
    store.put('routes', plan.route, { ...(store.get('routes', plan.route) || {}), follow: true });
  } else {
    const undo = applyToStage(plan.stage, ops);
    toast(`已应用 ${ops.length} 项修改`, undo);
  }
  if (plan.from) store.put('sugs', plan.id, 'applied');
  const u = store.ui(); u.pending = (u.pending || []).filter(x => x.id !== plan.id); store.saveUi();
  refresh();
}

act('plan-apply', el => {
  const plan = getPlan(el.dataset.id); if (!plan) return;
  const box = el.closest('.plan');
  const picked = box ? [...box.querySelectorAll('input[data-op]')].filter(i => i.checked).map(i => +i.dataset.op) : null;
  applyPlan(plan, picked);
  if (box) box.outerHTML = `<p class="small mut">已应用。阶段卡片上会显示“已个性化”，可以随时恢复原版。</p>`;
});
act('plan-drop', el => {
  const plan = getPlan(el.dataset.id); if (!plan) return;
  if (plan.from) store.put('sugs', plan.id, 'dropped');
  const u = store.ui(); u.pending = (u.pending || []).filter(x => x.id !== plan.id); store.saveUi();
  const box = el.closest('.plan'); if (box) box.outerHTML = '<p class="small fnt">已放弃这份方案。</p>';
  refresh();
});
act('plan-later', el => {
  const plan = getPlan(el.dataset.id); if (!plan) return;
  savePending(plan);
  const box = el.closest('.plan'); if (box) box.outerHTML = '<p class="small mut">已放进工作台的“等你确认”。</p>';
});
act('sug-apply', el => { const s = findSug(el.dataset.id); if (s) applyPlan(s, s.ops.map((op, i) => needsManualConfirm(op) ? -1 : i).filter(i => i >= 0)); });
act('sug-drop', el => { const s = findSug(el.dataset.id); if (!s) return; store.put('sugs', s.id, 'dropped'); const u = store.ui(); u.pending = (u.pending || []).filter(x => x.id !== s.id); store.saveUi(); refresh(); });
