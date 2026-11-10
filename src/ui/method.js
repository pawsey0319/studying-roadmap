// 我的学习方法：学习 Agent 从每段对话里沉淀出的“你怎么学”，以及对话纪要。
// 档案从一张白纸开始，每整理一段对话就自动增删改几条；前期变化快、后期变化慢。你随时可以改、删、自己加；
// 你改过的条目 AI 不会再改写文字，也不会自动删掉。
import { $, esc, iso } from '../util.js';
import * as store from '../store/index.js';
import { md } from '../core/md.js';
import { uid } from '../core/ids.js';
import { DIMS, ACTIVE, rate, MAX_TOTAL, undoOps } from '../core/method.js';
import { dropDigest } from '../ai/embed.js';
import { act, refresh, toast } from './kit.js';
import { stageLabel } from './home.js';
import { idleHours } from './agentui.js';
import { agentSkill } from '../core/ctxpack.js';
import { activeMethod } from '../core/method.js';
import { saveFile } from '../native.js';
import * as M from '../model.js';

const pct = w => Math.round(w * 100);
const level = w => w >= 0.7 ? '很有把握' : w >= ACTIVE ? '较有把握，会用来调整讲法' : '待观察，还不会用';

let LOG = [];
export async function beforeMethod() { LOG = (await store.localGet('methodLog')) || []; }
const OPW = { add: '新增', reinforce: '印证', revise: '改写', weaken: '削弱', delete: '删除' };
function logHtml() {
  if (!LOG.length) return '';
  const row = (h, i) => {
    const ch = h.log.map(l => !l.before ? `新增：${esc(l.after.t)}` : !l.after ? `删除：${esc(l.before.t)}` : l.before.t !== l.after.t ? `改写：${esc(l.before.t)} → ${esc(l.after.t)}` : `${l.after.w >= l.before.w ? '印证' : '削弱'}：${esc(l.after.t)}`);
    const rj = (h.rejected || []).map(r => `<span class="fnt">没采纳（${esc(r.why)}）：${esc(r.t)}</span>`);
    return `<li><div class="meta">${new Date(h.t).toLocaleString('zh-CN', { hour12: false })} · 整理“${esc(h.title || '')}”时${h.undone ? ' · <b>已撤销</b>' : ''}
      ${h.undone || !h.log.length ? '' : `<span class="act"><button data-act="method-undo" data-i="${i}">撤销这次修改</button></span>`}</div>
      <div class="small">${[...ch, ...rj].join('<br>') || '没有修改'}</div></li>`;
  };
  return `<h3 style="margin-top:16px">最近的修改</h3><ul class="lst">${LOG.slice(0, 10).map(row).join('')}</ul>`;
}
export function renderMethod(q = {}) {
  document.documentElement.style.setProperty('--c', '#1B2430');
  const tab = q.tab === 'digests' ? 'digests' : 'method';
  const E = Object.entries(store.all('method')), n = store.get('meta', 'methodN') || 0;
  const head = `<div class="ph"><h1>我的学习方法</h1><span class="mut">学习 Agent 从你们的每段对话里，慢慢总结出你适合怎么学</span>
    <span class="r"><button class="btn sm gh" data-act="skill-export" title="导出成 SKILL.md，放进支持 Agent Skills 的个人 Agent 里用">导出我的学习 Agent</button><button class="btn sm gh" data-act="anki" title="自测题和卡片笔记（第一行当正面），重复导入只更新不新建">导出 Anki</button></span></div>
    <nav class="tabs" style="margin-top:10px"><a href="#/method" aria-current="${tab === 'method' ? 'page' : 'false'}">学习方法档案</a><a href="#/method?tab=digests" aria-current="${tab === 'digests' ? 'page' : 'false'}">对话纪要 ${Object.keys(store.all('digests')).length || ''}</a></nav>`;
  if (tab === 'digests') return head + digestsHtml();
  const edit = store.ui().methodEdit;
  const row = ([id, x]) => edit === id
    ? `<li class="mrow"><form data-method-edit="${id}" class="addit"><select name="d">${DIMS.map(d => `<option${d === x.d ? ' selected' : ''}>${d}</option>`).join('')}</select><input name="t" value="${esc(x.t)}" maxlength="240"><button class="btn sm pri">保存</button><button type="button" class="btn sm gh" data-act="method-cancel">取消</button></form></li>`
    : `<li class="mrow"><div class="mw" title="${level(x.w)}"><i style="width:${pct(x.w)}%;opacity:${x.w >= ACTIVE ? 1 : 0.45}"></i></div>
      <div><div>${esc(x.t)}${x.by === 'user' ? ' <span class="tag">你改过</span>' : ''}</div>
        <div class="meta">${level(x.w)} · 印证 ${x.n || 1} 次 · ${new Date(x.u || x.c).toLocaleDateString('zh-CN')} 更新${(x.src || []).length ? ` · <a href="#/method?tab=digests&g=${x.src[x.src.length - 1]}">来源</a>` : ''}
        <span class="act"><button data-act="method-edit" data-id="${id}">改</button><button data-act="method-del" data-id="${id}">删除</button></span></div></div></li>`;
  const groups = DIMS.map(d => [d, E.filter(([, x]) => x.d === d).sort((a, b) => b[1].w - a[1].w)]).filter(([, xs]) => xs.length);
  return head + `<div class="g2" style="margin-top:14px;align-items:start">
    <div>${groups.length ? groups.map(([d, xs]) => `<div class="sh"><h3>${d}</h3></div><div class="card"><ul class="lst">${xs.map(row).join('')}</ul></div>`).join('')
      : `<div class="card" style="padding:18px 20px"><p class="lede" style="margin:0">还是一张白纸。</p><p class="mut small">和学习 Agent 聊几次后，这里会自动出现它观察到的东西，比如“先给类比再讲公式时你理解更快”“容易把 A 和 B 混淆”。前几段对话变化最快，之后会越来越稳定。</p></div>`}
      <form data-method-add class="addit" style="margin-top:12px"><select name="d" aria-label="维度">${DIMS.map(d => `<option>${d}</option>`).join('')}</select><input name="t" placeholder="自己补一条，例如：我需要先动手跑通再看原理" maxlength="240"><button class="btn sm">添加</button></form></div>
    <div><div class="card set"><h3>它是怎么形成的</h3>
      <p class="small">每段对话结束时，Agent 把对话整理成一份纪要，并对这份档案做最多 3 处小修改：新增一条观察、再次印证已有的、修正描述不准的、削弱和这次表现相反的。</p>
      <p class="small">已经整理了 <b>${n}</b> 段对话。现在每次修改的幅度是 <b>${pct(rate(n))}%</b>（从 100% 开始，随对话增多降到 15%），所以越往后越稳定。把握程度达到“较有把握”的条目，才会带进对话，用来调整讲法和出题方式。</p>
      <p class="small">你改过或自己加的条目，Agent 只会印证或削弱它，不会改写文字，也不会自动删掉。</p>
      <p class="small">为了少一些空话和误判：关于偏好的条目（呈现偏好、节奏、动手偏好）必须引用你说过的原话，程序会核对；不用“总是、完全”这类绝对的词；档案最多 ${MAX_TOTAL} 条；删除只能是因为被反驳、被取代、过时或证据太弱。看不出新东西时就不改。现在 ${E.length}/${MAX_TOTAL} 条。</p>
      ${logHtml()}
      <h3 style="margin-top:16px">一段对话什么时候结束</h3>
      <form data-idle class="addit"><span class="small">离开超过</span><input name="h" type="number" min="1" max="720" step="1" value="${idleHours()}" style="width:80px"><span class="small">小时再打开，就整理上一段</span><button class="btn sm">保存</button></form>
      <p class="hint">也可以随时在 Agent 窗口点“新话题”。原对话不再发给模型，只在这台设备上存档；纪要和学习方法会同步到你的其他设备。</p></div></div></div>`;
}

function digestsHtml() {
  const g = (new URLSearchParams(location.hash.split('?')[1] || '')).get('g');
  const L = Object.entries(store.all('digests')).sort((a, b) => b[1].c - a[1].c);
  return `<div class="card" style="margin-top:14px"><ul class="lst">${L.map(([id, d]) => `<li id="dg-${id}"${id === g ? ' style="background:var(--hl)"' : ''}><b>${esc(d.title)}</b>
      <div class="md small" style="margin-top:4px">${md(d.t)}</div>
      <div class="meta">${new Date(d.c).toLocaleString('zh-CN', { hour12: false })}${d.at ? ' · ' + esc(stageLabel(d.at)) : ''} · ${d.n || 0} 条消息
      <span class="act"><button data-act="digest-note" data-id="${id}">转成笔记</button><button data-act="digest-del" data-id="${id}">删除</button></span></div></li>`).join('')
    || '<li class="fnt">还没有对话纪要。和学习 Agent 聊完点“新话题”，或者离开一段时间再回来，这里就会出现。</li>'}</ul></div>`;
}

act('method-edit', el => { store.ui().methodEdit = el.dataset.id; store.saveUi(); refresh(); });
act('method-cancel', () => { store.ui().methodEdit = null; store.saveUi(); refresh(); });
act('method-del', el => { const id = el.dataset.id, before = store.get('method', id); store.del('method', id); refresh(); toast('已删除', () => { store.put('method', id, before); refresh(); }); });
act('digest-del', el => { const id = el.dataset.id, before = store.get('digests', id); store.del('digests', id); dropDigest(id); refresh(); toast('已删除', () => { store.put('digests', id, before); refresh(); }); });
act('method-undo', async el => {
  const h = LOG[+el.dataset.i]; if (!h || h.undone) return;
  const r = undoOps(h.log);
  for (const [id, x] of Object.entries(r.set)) store.put('method', id, x);
  for (const id of r.del) store.del('method', id);
  h.undone = true; await store.localSet('methodLog', LOG); refresh(); toast('已撤销这次修改');
});
act('digest-note', el => {
  const d = store.get('digests', el.dataset.id); if (!d) return;
  const id = 'c' + uid('');
  store.put('cards', id, { t: `## ${d.title}\n${d.t}`, at: d.at || null, c: Date.now() });
  toast('已转成卡片笔记', () => store.del('cards', id));
});
document.addEventListener('submit', e => {
  const f = e.target;
  if (f.matches && f.matches('form[data-method-edit]')) {
    e.preventDefault(); const id = f.dataset.methodEdit, x = store.get('method', id), t = f.t.value.trim(); if (!x || !t) return;
    store.put('method', id, { ...x, d: f.d.value, t: t.slice(0, 300), by: 'user', w: Math.max(x.w, 0.6), u: Date.now() });
    store.ui().methodEdit = null; store.saveUi(); refresh(); toast('已保存');
  } else if (f.matches && f.matches('form[data-method-add]')) {
    e.preventDefault(); const t = f.t.value.trim(); if (!t) return;
    store.put('method', 'm' + uid(''), { d: f.d.value, t: t.slice(0, 300), w: 0.7, n: 1, c: Date.now(), u: Date.now(), src: [], by: 'user' });
    refresh(); toast('已添加');
  } else if (f.matches && f.matches('form[data-idle]')) {
    e.preventDefault(); const h = Math.round(+f.h.value);
    if (!(h >= 1 && h <= 720)) { toast('请填 1 到 720 之间的小时数'); return; }
    store.put('meta', 'idleHours', h); toast(`已保存：离开 ${h} 小时后整理`);
  }
});

// 导出我的学习 Agent（SKILL.md）：只含你自己的数据；默认带学习方法、档案和在学阶段，不带笔记原文和对话纪要
act('skill-export', async () => {
  if (!confirm('将导出你的学习方法档案、学习者档案和当前在学的阶段，生成一个 SKILL.md 文件。文件交给别的 AI 工具后就收不回来了。继续吗？')) return;
  // 用本地日期，和 version 的本地时分保持一致（不能用 toISOString，否则北京时间 0–8 点会写成前一天）
  const d = new Date(), date = iso(d), version = date.replace(/-/g, '') + '-' + String(d.getHours()).padStart(2, '0') + String(d.getMinutes()).padStart(2, '0');
  const method = activeMethod(store.all('method')).map(([, x]) => `- ${x.d}：${x.t}`).join('\n');
  const doing = M.doing().map(x => x.kind === 'stage' ? `- ${x.t.name} / ${x.s.title}：${x.s.goal || ''}` : `- ${x.t.name} / 前沿：${x.r.title}`).join('\n');
  const o = agentSkill({ date, version, sections: [
    { h: '学习者档案', body: store.get('meta', 'profile') || '' },
    { h: '我的学习方法', body: method },
    { h: '我现在在学', body: doing }] });
  try { await saveFile('SKILL.md', o.parts[0], 'text/markdown'); }
  catch (e) { toast('保存失败：' + (e && e.message ? e.message : e)); return; }
  toast(`已导出。把它放进 skills/${o.dir}/ 文件夹里使用`);
});
