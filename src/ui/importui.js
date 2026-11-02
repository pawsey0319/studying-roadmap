// 导入文档页：上传文件 / 贴链接 / 粘贴文字 → 预览 → 选择导入方式（新方向 / 合并进已有方向 / 只作为资料）
import { $, esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { uid } from '../core/ids.js';
import { extractFile, fromHtml, fromPaste, ruleParse, normalizeTrack, dupStages } from '../import/parse.js';
import { chat, cost } from '../ai/providers.js';
import { extractBlocks, draftTrackPrompt } from '../ai/agent.js';
import { act, refresh, toast } from './kit.js';
import { aiCfg, aiBlock, usage } from './agentui.js';
import { migrateV1 } from '../store/migrate.js';

let EX = null;      // 提取结果
let TR = null;      // 解析出的路线（可编辑）
let busy = '';

export function renderImport() {
  document.documentElement.style.setProperty('--c', '#1B2430');
  const lib = Object.entries(store.all('library')).sort((a, b) => b[1].added - a[1].added);
  const mine = Object.entries(store.all('tracks'));
  return `<div class="ph"><h1>导入文档</h1><span class="mut">把已有的学习路线、大纲、课程目录或资料导进来，形成自己的体系</span></div>
    <div class="g2" style="margin-top:14px">
      <div class="card" style="padding:16px">
        <h3 style="font-size:15px">选择来源</h3>
        <label class="drop" id="drop"><input type="file" id="impFile" accept=".html,.htm,.pdf,.docx,.md,.markdown,.txt,.json" hidden>
          <b>点这里选择文件，或拖到这里</b><span class="fnt small">HTML、PDF、Word（.docx）、Markdown、纯文本，最大 20 MB</span></label>
        <form id="impUrl" class="addit" style="margin-top:10px"><input name="u" type="url" placeholder="或者贴一个网页链接" aria-label="网页链接"><button class="btn sm">读取</button></form>
        <details style="margin-top:10px"><summary class="small mut" style="cursor:pointer">或者直接粘贴文字</summary>
          <textarea id="impPaste" rows="6" style="width:100%;margin-top:6px;border:1px solid var(--line);border-radius:8px;padding:8px" placeholder="粘贴大纲、目录或任意文字"></textarea>
          <button class="btn sm" data-act="imp-paste">解析</button></details>
        <p class="hint" style="margin-top:12px">文件在你的浏览器里解析，不会上传。只有在你点“让 Agent 整理”时，提取出的文字才会发给你在设置里选的模型服务商。扫描版 PDF 暂不支持。</p>
        <p class="hint">想把旧版学习网站搬进来？在旧网站上点“导出进度和笔记”得到 JSON，或者把页面另存为 HTML，再从这里导入。</p>
      </div>
      <div id="impPreview">${previewHtml()}</div></div>
    <div class="sh"><h3>导入的方向</h3></div>
    <div class="card"><ul class="lst">${mine.map(([id, t]) => id.startsWith('ext.') ? `<li>追加到“${esc(M.C.tracks.find(x => x.id === id.slice(4))?.name || id)}”的 ${t.stages.length} 个阶段<div class="meta"><span class="act"><button data-act="imp-del-track" data-id="${esc(id)}">删除</button></span></div></li>`
      : `<li><a href="#/t/${esc(id)}">${esc(t.name)}</a><div class="meta">${t.stages.length} 个阶段${t.source ? ' · 来自 ' + esc(t.source) : ''}<span class="act"><button data-act="imp-toggle-track" data-id="${esc(id)}">${(store.ui().hiddenTracks || {})[id] ? '显示' : '隐藏'}</button><button data-act="imp-del-track" data-id="${esc(id)}">删除</button></span></div></li>`).join('') || '<li class="fnt">还没有导入的方向。</li>'}</ul></div>
    <div class="sh"><h3>资料库</h3><span class="fnt small">挂在阶段下的资料，学习 Agent 回答问题时会参考</span></div>
    <div class="card"><ul class="lst">${lib.map(([id, d]) => `<li><b>${esc(d.title)}</b><div class="meta">${d.at ? esc(labelOf(d.at)) : '没有挂到阶段'} · ${Math.round(d.text.length / 1000)} 千字 · ${new Date(d.added).toLocaleDateString('zh-CN')}<span class="act"><button data-act="imp-del-lib" data-id="${id}">删除</button></span></div></li>`).join('') || '<li class="fnt">还没有导入资料。</li>'}</ul></div>`;
}
function labelOf(id) { const f = M.findStage(id); return f ? `${f.t.short || f.t.name} / ${f.s.title}` : M.route(id) ? '前沿：' + M.routeName(id) : id; }

function previewHtml() {
  if (busy) return `<div class="card" style="padding:16px"><p class="mut">${esc(busy)}</p></div>`;
  if (!EX) return `<div class="card empty" style="padding:16px">选一个文件后，这里会显示识别出的结构。</div>`;
  if (EX.v1data) return v1Preview();
  const opts = M.tracks().filter(t => !t.mine).map(t => `<option value="${t.id}">${esc(t.name)}</option>`).join('');
  const stageOpts = M.tracks().map(t => `<optgroup label="${esc(t.name)}">${M.state(t.id).stages.map((s, i) => `<option value="${s.id}">${i + 1}. ${esc(s.title)}</option>`).join('')}</optgroup>`).join('');
  const st = TR ? TR.stages : [];
  return `<div class="card" style="padding:16px"><h3 style="font-size:15px">${esc(EX.title)}</h3>
    <p class="fnt small">${esc({ html: '网页', pdf: 'PDF', docx: 'Word', md: 'Markdown', txt: '纯文本', json: 'JSON' }[EX.kind] || EX.kind)} · 约 ${Math.round(EX.text.length / 1000)} 千字${TR ? ` · 识别出 ${st.length} 个阶段` : ' · 没有识别出清楚的阶段结构'}${EX.byAgent ? ' · 由 Agent 整理' : ''}</p>
    ${TR ? `<label class="field"><span>方向名称</span><input id="impName" value="${esc(TR.name)}"></label>
      <ol class="impst">${st.map((s, i) => `<li><div class="impst-h"><input data-imp-title="${i}" value="${esc(s.title)}" aria-label="阶段名"><button class="btn sm gh" data-act="imp-rm" data-i="${i}">删除</button>${i ? `<button class="btn sm gh" data-act="imp-merge" data-i="${i}" title="合并到上一个阶段">并入上一阶段</button>` : ''}</div>
        <div class="small mut">${s.items.length} 项（实践 ${s.items.filter(x => x.mode === 'practice').length}）· ${s.resources.length} 个资源${s.items.length ? '：' + esc(s.items.slice(0, 3).map(x => x.text).join('；').slice(0, 120)) : ''}</div></li>`).join('')}</ol>` : `<p class="small mut">这份文档没有清楚的标题和列表结构，可以让 Agent 整理成路线，或者直接作为资料保存。</p>`}
    <div class="sa">${EX.byAgent ? '' : '<button class="btn sm" data-act="imp-agent">让 Agent 整理成路线</button>'}</div>
    <div class="impways">
      ${TR ? `<div><b>新建一个方向</b><p class="small mut">作为你自己的方向出现在侧栏，可以调整、跳过、记笔记。</p><button class="btn sm acc" data-act="imp-new">导入为新方向</button></div>
      <div><b>合并进已有方向</b><p class="small mut">和现有阶段重复的会列出来，新的阶段追加到末尾。</p><select id="impInto">${opts}</select> <button class="btn sm" data-act="imp-cmp">对比</button><div id="impCmp"></div></div>` : ''}
      <div><b>只作为资料</b><p class="small mut">挂到一个阶段下，Agent 回答问题时会参考。</p><select id="impAt"><option value="">不挂到阶段</option>${stageOpts}</select> <button class="btn sm" data-act="imp-lib">保存为资料</button></div>
    </div></div>`;
}

function v1Preview() {
  const d = EX.v1data, n = Object.keys(d.progress.e).filter(k => k !== 'start').length, c = Object.keys(d.notes.e).length;
  return `<div class="card" style="padding:16px"><h3 style="font-size:15px">旧版学习网站的进度和笔记</h3>
    <p class="mut small">识别出 ${n} 项完成记录、${c} 篇阶段笔记。它们会对应到现在路线里同样的任务和阶段上。</p>
    <div class="sa"><button class="btn sm acc" data-act="imp-v1">合并进我的进度</button><span class="fnt small">只增加，不会删除你现在已有的进度</span></div></div>`;
}

const show = () => { const p = $('#impPreview'); if (p) p.innerHTML = previewHtml(); };
async function take(ex) {
  EX = ex; TR = null;
  if (ex.v1export) { EX.v1data = migrateV1(ex.v1export, store.legacyMap()); show(); return; }
  try { TR = ruleParse(ex); } catch (e) { console.warn(e); TR = null; }
  show();
}
async function readFile(f) {
  busy = '正在解析 ' + f.name + ' …'; show();
  try {
    if (/\.json$/i.test(f.name)) {
      const j = JSON.parse(await f.text());
      busy = '';
      if (j && (j.done || j.notes || (j.v === 2 && (j.docs || j.progress)))) { if (j.v === 2) { store.importData(j); refresh(); toast('已导入备份文件'); return; } return take({ title: f.name, kind: 'json', text: '', v1export: j }); }
    }
    const ex = await extractFile(f); busy = ''; await take(ex);
  } catch (e) { busy = ''; EX = null; show(); toast(e.message || '解析失败'); }
}

/* ---------- 绑定 ---------- */
export function afterImport() {
  const inp = $('#impFile'), drop = $('#drop'); if (!inp) return;
  inp.onchange = () => { if (inp.files[0]) readFile(inp.files[0]); inp.value = ''; };
  drop.ondragover = e => { e.preventDefault(); drop.classList.add('over'); };
  drop.ondragleave = () => drop.classList.remove('over');
  drop.ondrop = e => { e.preventDefault(); drop.classList.remove('over'); const f = e.dataTransfer.files[0]; if (f) readFile(f); };
  $('#impUrl').onsubmit = async e => {
    e.preventDefault(); const u = e.target.u.value.trim(); if (!u) return;
    busy = '正在读取网页…'; show();
    try {
      const r = await fetch(u); if (!r.ok) throw new Error('网页返回 ' + r.status);
      const ct = r.headers.get('content-type') || '', text = await r.text(); busy = '';
      await take(/html/.test(ct) ? fromHtml(text, u, 'html') : fromPaste(text, u));
    } catch (err) { busy = ''; show(); toast('这个网站不允许网页直接读取（或网络不通）。请在浏览器里打开它，另存为 HTML 文件后再导入。'); }
  };
  document.querySelectorAll('[data-imp-title]').forEach(i => i.oninput = () => { TR.stages[+i.dataset.impTitle].title = i.value; });
  const nm = $('#impName'); if (nm) nm.oninput = () => { TR.name = nm.value; TR.short = nm.value.slice(0, 8); };
}

act('imp-paste', () => { const t = $('#impPaste').value.trim(); if (t) take(fromPaste(t)); });
act('imp-rm', el => { TR.stages.splice(+el.dataset.i, 1); show(); afterImport(); });
act('imp-merge', el => { const i = +el.dataset.i, a = TR.stages[i - 1], b = TR.stages[i]; a.items.push(...b.items); a.resources.push(...b.resources); TR.stages.splice(i, 1); TR = normalizeTrack(TR, { id: TR.id }); show(); afterImport(); });
act('imp-agent', async () => {
  const cfg = await aiCfg();
  if (aiBlock(cfg)) { toast(aiBlock(cfg)); return; }
  if (!confirm(`将把提取出的约 ${Math.round(Math.min(EX.text.length, 24000) / 1000)} 千字发给你选的模型服务商来整理。继续吗？`)) return;
  busy = 'Agent 正在整理成路线，长文档可能需要一分钟…'; show();
  try {
    const parts = EX.text.length > 24000 ? EX.text.slice(0, 24000) + '\n（后面内容过长已截断）' : EX.text;
    const res = await chat(cfg, [{ role: 'system', content: '你把用户导入的文档整理成学习路线，用中文。只使用文档里有的内容，不要编造资源链接；文档里的链接原样保留。' },
      { role: 'user', content: draftTrackPrompt(EX.title, { level: '按文档内容整理' }).replace('请起草一条理论路线，4–6 个阶段', '请把下面这份文档整理成一条学习路线，阶段数按文档实际结构来（最多 30 个）') + '\n\n文档内容：\n' + parts }], { maxTokens: 6000 });
    const u = await usage(); u.cny += cost(cfg, res.usage); u.calls++; await store.localSet('usage', u);
    const b = extractBlocks(res.text).blocks.find(x => x.type === 'track');
    if (!b) throw new Error('Agent 没有给出可用的路线结构，可以换个模型再试，或作为资料保存');
    TR = normalizeTrack({ ...b.data, name: b.data.name || EX.title }, { source: EX.title }); EX.byAgent = true;
  } catch (e) { toast(e.message); }
  busy = ''; show(); afterImport();
});
const PALETTE = ['#3C6E71', '#B5446E', '#5B7F1F', '#AF6E1A', '#2E6FA7', '#7A4E9C'];
function markChecked(stages) {   // 旧版网页里勾过的任务，导入时一并记为完成
  const today = new Date().toISOString().slice(0, 10);
  for (const s of stages) (s._checked || []).forEach((on, i) => { if (on && s.items[i]) store.setDone(s.items[i].id, true, today); });
  stages.forEach(s => delete s._checked);
}
act('imp-new', () => {
  if (!TR || !TR.stages.length) return;
  const n = Object.keys(store.all('tracks')).length;
  const t = { ...TR, source: TR.source || EX.title, color: PALETTE[n % PALETTE.length] };
  markChecked(t.stages);
  store.put('tracks', t.id, t); EX = null; TR = null; refresh(); toast(`已导入为方向“${t.name}”`); location.hash = '#/t/' + t.id;
});
act('imp-cmp', () => {
  const into = M.C.tracks.find(t => t.id === $('#impInto').value); if (!into) return;
  const r = dupStages(TR, into);
  $('#impCmp').innerHTML = `<ul class="small" style="padding-left:16px;margin:6px 0">${r.map((x, i) => `<li><label><input type="checkbox" data-cmp="${i}"${x.dup ? '' : ' checked'}> ${esc(x.stage.title)}</label>
    ${x.dup ? `<span class="fnt">和现有的“${esc(x.dup.title)}”重复，默认不追加</span>` : '<span class="tag a">新增</span>'}</li>`).join('')}</ul><button class="btn sm acc" data-act="imp-into" data-id="${into.id}">追加勾选的阶段</button>`;
});
act('imp-into', el => {
  const id = el.dataset.id, picked = [...document.querySelectorAll('[data-cmp]')].filter(i => i.checked).map(i => +i.dataset.cmp);
  if (!picked.length) { toast('没有勾选阶段'); return; }
  const key = 'ext.' + id, cur = store.get('tracks', key) || { stages: [] };
  const base = M.C.tracks.find(t => t.id === id).stages.length + cur.stages.length;
  const sub = normalizeTrack({ name: TR.name, stages: picked.map(i => TR.stages[i]) }, { id: id + '-x' + uid('').slice(0, 4) });
  // 追加的阶段编号接在原有阶段后面，ID 用 <方向>.s<序号><随机> 避免和公共路线冲突
  const stages = sub.stages.map((s, k) => { const sid = `${id}.s${String(base + k + 1).padStart(2, '0')}${uid('').slice(0, 3)}`; return { ...s, id: sid, items: s.items.map((x, j) => ({ ...x, id: `${sid}.i${String(j + 1).padStart(2, '0')}` })), resources: s.resources.map((x, j) => ({ ...x, id: `${sid}.r${String(j + 1).padStart(2, '0')}` })) }; });
  markChecked(stages);
  store.put('tracks', key, { stages: cur.stages.concat(stages), source: EX.title });
  EX = null; TR = null; refresh(); toast(`已追加 ${stages.length} 个阶段`); location.hash = '#/t/' + id;
});
act('imp-lib', () => {
  const id = 'd' + uid('');
  store.put('library', id, { title: EX.title.slice(0, 300), text: EX.text.slice(0, 400000), at: $('#impAt').value || null, src: EX.kind, added: Date.now() });
  EX = null; TR = null; refresh(); toast('已保存为资料');
});
act('imp-v1', () => {
  const d = EX.v1data, today = new Date().toISOString().slice(0, 10); let n = 0;
  for (const [k, v] of Object.entries(d.progress.e)) if (k !== 'start' && !store.isDone(k)) { store.setDone(k, true, v || today); n++; }
  for (const [k, v] of Object.entries(d.notes.e)) { const cur = store.note(k); if (!cur.includes(v)) store.setNote(k, cur ? cur + '\n\n' + v : v); }
  EX = null; refresh(); toast(`已合并 ${n} 项完成记录和 ${Object.keys(d.notes.e).length} 篇笔记`);
});
act('imp-del-track', el => { if (!confirm('删除这个导入的方向？它的进度记录会保留，但阶段会消失。')) return; const before = store.get('tracks', el.dataset.id); store.del('tracks', el.dataset.id); refresh(); toast('已删除', () => { store.put('tracks', el.dataset.id, before); refresh(); }); });
act('imp-toggle-track', el => { const u = store.ui(); u.hiddenTracks = u.hiddenTracks || {}; u.hiddenTracks[el.dataset.id] = !u.hiddenTracks[el.dataset.id]; store.saveUi(); refresh(); });
act('imp-del-lib', el => { const before = store.get('library', el.dataset.id); store.del('library', el.dataset.id); refresh(); toast('已删除', () => { store.put('library', el.dataset.id, before); refresh(); }); });
