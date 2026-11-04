// 导出给其他 AI（上下文工程面板）。入口：学习 Agent、阶段卡片、笔记、商机卡片。
// 隐私：默认什么都不勾，全部由你选；导出的内容会离开这个网站。工具配置表和导出记录只存这台设备。
import { $, esc, iso } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { stageContext } from '../ai/agent.js';
import { activeMethod } from '../core/method.js';
import { masteryLines } from '../core/mastery.js';
import { SCENES, KIND_NAME, build, prefillUrl, mergeTools, bestCombo, reqSections } from '../core/ctxpack.js';
import { uid } from '../core/ids.js';
import { act, toast } from './kit.js';
import { stageLabel } from './home.js';

let X = null;   // 面板状态：{ at, card, biz, scene, tool, picks:Set, extra, out, tab }
let TOOLS = [], LOG = [];
const PICK_NAME = { profile: '学习者档案', memory: '记住的事', method: '学习方法', stage: '阶段进度', notesSum: '笔记摘要', notesFull: '笔记原文', digests: '对话纪要', journal: '学习日志', biz: '商机', req: '需求包', news: '相关资讯', library: '导入资料' };
const dlg = () => { let d = $('#exDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'exDlg'; d.setAttribute('aria-label', '导出给其他 AI'); document.body.appendChild(d); } return d; };

// 可以带的信息：每项 { id, name, body }，没有内容的不显示
function sources() {
  const L = [], add = (id, name, body, note) => { body = String(body || '').trim(); if (body) L.push({ id, name, body, note }); };
  const f = X.at && M.findStage(X.at), r = X.at && !f ? M.route(X.at) : null;
  add('profile', '学习者档案', store.get('meta', 'profile'));
  add('memory', 'Agent 记住的事', store.get('meta', 'memory'));
  add('method', '学习方法档案', activeMethod(store.all('method')).map(([, x]) => `- ${x.d}：${x.t}`).join('\n'), '只带“较有把握”以上的条目');
  if (f) add('stage', '这个阶段的进度', stageContext({ ...f.s, items: f.s.items.map(i => ({ ...i, done: store.isDone(i.id) })) }, f.t, '') + '\n' + masteryLines(f.s, store.all('tests')));
  if (r) add('stage', '这条前沿路线', `${M.routeName(r.id)}：${r.desc}\n` + (r.learn || []).map(i => `- ${i.text}${store.isDone(i.id) ? '（已完成）' : ''}`).join('\n'));
  const cards = Object.values(store.all('cards')).filter(c => X.card ? false : X.at && c.at === X.at).sort((a, b) => b.c - a.c);
  const one = X.card && store.get('cards', X.card), doc = X.at ? store.note(X.at) : '';
  const full = [one && one.t, doc && '阶段文档：\n' + doc, ...cards.map(c => c.t)].filter(Boolean).join('\n\n---\n\n');
  const sum = [one && one.t.slice(0, 600), doc && doc.split('\n').filter(l => /^#+\s|^[-*]\s/.test(l)).slice(0, 20).join('\n'), ...cards.slice(0, 12).map(c => '- ' + c.t.split('\n')[0].slice(0, 120))].filter(Boolean).join('\n');
  add('notesSum', '相关笔记（摘要）', sum, '标题和要点，不带全文');
  if (full !== sum) add('notesFull', '相关笔记（原文）', full.slice(0, 20000));
  const dg = Object.values(store.all('digests')).filter(g => X.at ? g.at === X.at : true).sort((a, b) => b.c - a.c).slice(0, X.at ? 4 : 2);
  add('digests', '对话纪要', dg.map(g => `### ${g.title}\n${g.t}`).join('\n\n'));
  const j = X.at && store.get('journal', X.at);
  if (j) add('journal', '学习日志', `上次聊到：${j.last}\n下次重点：${j.next}`);
  const b = X.biz && (M.C.biz.items || []).find(x => x.id === X.biz);
  if (b) add('biz', '商机条目', `${b.title}\n${b.desc}${(b.links || []).length ? '\n参考：' + b.links.map(l => `${l.name} ${l.url}`).join('；') : ''}`);
  if (X.req) add('req', '需求包', reqSections(X.req).map(s => `### ${s.h}\n${s.body}`).join('\n\n'), '商机做 demo 时和 Agent 一起整理的');
  const rids = b ? (b.r || []) : r ? [r.id] : f ? M.routes(f.t.id).filter(x => x.from === f.s.id).map(x => x.id) : [];
  add('news', '相关资讯', rids.flatMap(id => M.routeNews(id).slice(0, 8)).slice(0, 15).map(n => `- ${n.d} ${n.t}（${n.src || ''}）${n.u}`).join('\n'));
  if (X.at) add('library', '导入的资料', Object.values(store.all('library')).filter(d => d.at === X.at).map(d => `【${d.title}】\n${d.text.slice(0, 6000)}`).join('\n\n'));
  return L;
}

export async function openExport({ at = null, card = null, biz = null, scene = null, req = null } = {}) {
  TOOLS = mergeTools(await store.localGet('ctxTools'));
  LOG = (await store.localGet('ctxLog')) || [];
  if (biz && !req) req = await store.localGet('req.' + biz);
  const c = card && store.get('cards', card);
  X = { at: at || (c && c.at) || null, card, biz, req, scene: scene || (biz ? 'demo' : 'study'), tool: TOOLS[0].id, picks: new Set(), extra: '', out: null, tab: 'make' };
  render(); const d = dlg(); if (!d.open) d.showModal();
}

const title = () => { const b = X.biz && (M.C.biz.items || []).find(x => x.id === X.biz); return (X.req && X.req.title) || (b && b.title) || (X.at && stageLabel(X.at)) || '我的学习背景'; };
function compose() {
  const S = sources().filter(s => X.picks.has(s.id)), tool = TOOLS.find(t => t.id === X.tool) || TOOLS[0];
  const secs = S.flatMap(s => s.id === 'req' ? reqSections(X.req).map(x => ({ id: 'req', ...x })) : [{ id: s.id, h: s.name, body: s.body }]);
  X.out = { ...build({ scene: X.scene, tool, sections: secs, extra: X.extra, title: title(), date: iso(new Date()) }), tool };
}

function render() {
  const d = dlg(), S = sources(), best = bestCombo(LOG, X.scene), sc = SCENES[X.scene];
  const head = `<div class="ob-h"><h3>导出给其他 AI</h3><span class="fnt small">${esc(title())}</span><button class="x" data-act="ex-close" aria-label="关闭">×</button></div>
    <div class="chips" style="padding:10px 18px 0">${[['make', '导出'], ['tools', '工具配置'], ['log', `导出记录 ${LOG.length || ''}`]].map(([k, v]) => `<button class="chip" data-act="ex-tab" data-id="${k}" aria-pressed="${X.tab === k}">${v}</button>`).join('')}</div>`;
  let body;
  if (X.tab === 'tools') body = toolsHtml();
  else if (X.tab === 'log') body = logHtml();
  else {
    const total = S.filter(s => X.picks.has(s.id)).reduce((n, s) => n + s.body.length, 0) + X.extra.length;
    const tool = TOOLS.find(t => t.id === X.tool) || TOOLS[0];
    body = `<div class="ex">
      <div class="exs"><b>1. 场景</b><div class="chips">${Object.entries(SCENES).map(([k, v]) => `<button class="chip" data-act="ex-scene" data-id="${k}" aria-pressed="${X.scene === k}">${v.name}</button>`).join('')}</div>
        <p class="hint">${esc(sc.aim)}</p></div>
      <div class="exs"><b>2. 要带哪些信息</b><span class="fnt small">默认都不带，导出的内容会离开这个网站，按需勾选</span>
        ${S.map(s => `<label class="exi"><input type="checkbox" data-expick="${s.id}"${X.picks.has(s.id) ? ' checked' : ''}><span>${esc(s.name)}${sc.rec.includes(s.id) ? ' <span class="tag">这个场景常用</span>' : ''}${s.note ? `<small>${esc(s.note)}</small>` : ''}</span><span class="fnt small">约 ${s.body.length.toLocaleString()} 字</span></label>`).join('') || '<p class="fnt small">这里没有可带的个人信息。</p>'}
        ${best ? `<p class="small">这个场景下评分最高的组合（${best.avg} 分，${best.n} 次）：${best.picks.map(p => esc((S.find(s => s.id === p) || { name: p }).name)).join('、')} <button class="lnk" data-act="ex-best">按它勾选</button></p>` : ''}
        <textarea id="exExtra" rows="2" placeholder="补充一句话（可选），例如：重点讲和 RAG 的区别 / 页面风格要简洁">${esc(X.extra)}</textarea>
        <p class="fnt small">已选约 ${total.toLocaleString()} 字</p></div>
      <div class="exs"><b>3. 目标工具</b><select id="exTool">${TOOLS.map(t => `<option value="${t.id}"${t.id === X.tool ? ' selected' : ''}>${esc(t.name)} · ${KIND_NAME[t.kind]} · ${t.max.toLocaleString()} 字以内</option>`).join('')}</select>
        <div class="sa"><button class="btn pri" data-act="ex-make">生成</button></div></div>
      ${X.out ? outHtml(tool) : ''}</div>`;
  }
  d.innerHTML = `<div class="ob">${head}<div class="ob-gen">${body}</div></div>`;
  const ta = $('#exExtra'); if (ta) ta.oninput = () => { X.extra = ta.value.slice(0, 1000); };
  const sel = $('#exTool'); if (sel) sel.onchange = () => { X.tool = sel.value; X.out = null; render(); };
  d.querySelectorAll('input[data-expick]').forEach(cb => cb.onchange = () => { cb.checked ? X.picks.add(cb.dataset.expick) : X.picks.delete(cb.dataset.expick); X.out = null; render(); });
}

function outHtml(tool) {
  const o = X.out, n = o.parts.length;
  return `<div class="exs"><b>4. 结果</b> <span class="fnt small">${o.file ? `保存为项目根目录下的 ${esc(o.file)}` : n > 1 ? `超过 ${tool.max.toLocaleString()} 字，拆成 ${n} 段：先发第 1 段搭框架，生成完再依次发后面几段` : `${o.parts[0].length.toLocaleString()} 字`}${o.over ? '；超出上限，已截断，少勾几项更好' : ''}</span>
    ${o.parts.map((p, i) => `<div class="expart"><div class="meta">${n > 1 ? `第 ${i + 1} / ${n} 段 · ` : ''}${p.length.toLocaleString()} 字
      <span class="act"><button data-act="ex-copy" data-i="${i}">复制</button>${o.file ? `<button data-act="ex-file" data-i="${i}">下载 ${esc(o.file)}</button>` : ''}
      ${i === 0 && prefillUrl(tool, p) && n === 1 ? `<a href="${esc(prefillUrl(tool, p))}" target="_blank" rel="noopener" data-act="ex-open">在 ${esc(tool.name)} 里打开（已预填）</a>` : tool.url && i === 0 ? `<a href="${esc(tool.url)}" target="_blank" rel="noopener" data-act="ex-open">打开 ${esc(tool.name)}</a>` : ''}</span></div>
      <pre>${esc(p)}</pre></div>`).join('')}</div>`;
}

function toolsHtml() {
  return `<p class="hint">每个工具的格式和单段长度上限。默认值是保守估计，不是官方数字；工具改了规则时在这里改，只存这台设备。预填链接里用 {q} 代表 prompt（目前只有 Lovable 支持）。</p>
    <table class="extbl"><thead><tr><th>工具</th><th>格式</th><th>单段上限（字）</th><th>打开地址</th></tr></thead><tbody>
    ${TOOLS.map(t => `<tr data-tid="${t.id}"><td><input name="name" value="${esc(t.name)}"></td><td><select name="kind">${Object.entries(KIND_NAME).map(([k, v]) => `<option value="${k}"${k === t.kind ? ' selected' : ''}>${v}</option>`).join('')}</select></td>
      <td><input name="max" type="number" min="200" step="100" value="${t.max}"></td><td><input name="url" value="${esc(t.url || '')}" placeholder="https://…"></td></tr>`).join('')}</tbody></table>
    <div class="sa"><button class="btn pri" data-act="ex-tools-save">保存</button><button class="btn gh" data-act="ex-tools-reset">恢复默认</button></div>`;
}

function logHtml() {
  if (!LOG.length) return '<p class="fnt">还没有导出记录。每次复制或下载都会记一条；回来打个分，下次同一场景会推荐评分最高的勾选组合。</p>';
  return `<ul class="lst">${LOG.map((x, i) => `<li><b>${esc(SCENES[x.scene] ? SCENES[x.scene].name : x.scene)} → ${esc((TOOLS.find(t => t.id === x.tool) || { name: x.tool }).name)}</b> · ${esc(x.title || '')}
      <div class="meta">${new Date(x.t).toLocaleString('zh-CN', { hour12: false })} · ${x.len.toLocaleString()} 字${x.parts > 1 ? ` · ${x.parts} 段` : ''} · 带了：${esc(x.picks.map(p => PICK_NAME[p] || p).join('、') || '无')}</div>
      <div class="exr">${[1, 2, 3, 4, 5].map(n => `<button class="chip" data-act="ex-rate" data-i="${i}" data-n="${n}" aria-pressed="${x.rating === n}">${n}</button>`).join('')}
        <input data-exnote="${i}" value="${esc(x.note || '')}" placeholder="生成结果的链接或备注" maxlength="500"></div></li>`).join('')}</ul>`;
}

async function logExport() {
  const o = X.out; if (!o || o.logged) return; o.logged = true;
  LOG.unshift({ id: uid('x'), t: Date.now(), scene: X.scene, tool: X.tool, title: title(), picks: [...X.picks].sort(), len: o.parts.reduce((n, p) => n + p.length, 0), parts: o.parts.length, rating: 0, note: '' });
  LOG = LOG.slice(0, 100); await store.localSet('ctxLog', LOG);
}
async function copy(text) {
  try { await navigator.clipboard.writeText(text); return true; }
  catch (e) { const t = document.createElement('textarea'); t.value = text; document.body.appendChild(t); t.select(); const ok = document.execCommand('copy'); t.remove(); return ok; }
}

act('ex-close', () => dlg().close());
act('ex-tab', el => { X.tab = el.dataset.id; render(); });
act('ex-scene', el => { X.scene = el.dataset.id; X.out = null; render(); });
act('ex-best', () => { const b = bestCombo(LOG, X.scene); if (b) { X.picks = new Set(b.picks); X.out = null; render(); } });
act('ex-make', () => { compose(); render(); });
act('ex-copy', async el => { if (await copy(X.out.parts[+el.dataset.i])) { el.textContent = '已复制'; toast(X.out.parts.length > 1 ? `已复制第 ${+el.dataset.i + 1} 段` : '已复制，去目标工具里粘贴'); } await logExport(); });
act('ex-file', async el => {
  const blob = new Blob([X.out.parts[+el.dataset.i]], { type: 'text/markdown' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = X.out.file; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  await logExport();
});
act('ex-open', async () => { if (X.out && X.out.parts.length === 1) await copy(X.out.parts[0]); await logExport(); });
act('ex-rate', async el => { const x = LOG[+el.dataset.i]; if (!x) return; x.rating = +el.dataset.n; await store.localSet('ctxLog', LOG); render(); });
act('ex-tools-save', async () => {
  const rows = [...dlg().querySelectorAll('tr[data-tid]')].map(tr => { const g = n => tr.querySelector(`[name=${n}]`).value.trim(); const base = TOOLS.find(t => t.id === tr.dataset.tid) || {};
    return { ...base, id: tr.dataset.tid, name: g('name') || base.name, kind: g('kind'), max: Math.max(200, +g('max') || base.max), url: /^https:\/\//.test(g('url')) ? g('url') : '' }; });
  await store.localSet('ctxTools', rows); TOOLS = mergeTools(rows); toast('已保存工具配置'); render();
});
act('ex-tools-reset', async () => { await store.localSet('ctxTools', null); TOOLS = mergeTools(null); render(); });
document.addEventListener('change', async e => {
  const i = e.target.dataset && e.target.dataset.exnote; if (i == null || !LOG[+i]) return;
  LOG[+i].note = e.target.value.slice(0, 500); await store.localSet('ctxLog', LOG);
});
act('export-open', el => openExport({ at: el.dataset.at || null, card: el.dataset.card || null, biz: el.dataset.biz || null, scene: el.dataset.scene || null }));
