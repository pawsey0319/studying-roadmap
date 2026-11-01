// 开局：你先描述，Agent 追问到理清（实时摘要），你确认后才为每个方向生成方案，逐个方向采用。
import { $, esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { md } from '../core/md.js';
import { chat, cost } from '../ai/providers.js';
import { onboardPrompt, extractBlocks, summaryStatus, profileFromSummary, planForTrackPrompt, draftTrackPrompt, cleanPlan, stageContext, ONBOARD_FIELDS } from '../ai/agent.js';
import { normalizeTrack } from '../import/parse.js';
import { act, refresh, toast } from './kit.js';
import { planCard, registerPlan } from './suggest.js';
import { aiCfg, usage } from './agentui.js';

const MAX_ROUNDS = 8;
let S = null;   // { msgs, summary, round, step: 'talk'|'gen'|'done', plans:[], drafts:[] }

async function addUsage(cfg, us) { const u = await usage(); u.cny += cost(cfg, us); u.tin += us.in; u.tout += us.out; u.calls++; await store.localSet('usage', u); }

export async function openOnboard() {
  S = (await store.localGet('onboard')) || { msgs: [], summary: null, round: 0, step: 'talk', plans: [], drafts: [] };
  const d = $('#obDlg'); render(); if (!d.open) d.showModal();
}
const save = () => store.localSet('onboard', S);

function summaryHtml() {
  const s = S.summary || {}, st = summaryStatus(s);
  const row = (k, label, val) => `<li class="${st[k] ? 'ok' : 'todo'}"><span>${st[k] ? '✓' : '·'}</span><b>${label}</b><div>${val || '<span class="fnt">还不清楚</span>'}</div></li>`;
  const tracks = (s.tracks || []).map(t => `${esc(t.name)}${t.id ? '' : ' <span class="tag mine">新方向</span>'}`).join('、');
  const levels = (s.tracks || []).map(t => `${esc(t.name)}：${esc(t.level || '？')}`).join('；');
  return `<ul class="obsum">${row('tracks', '方向', tracks)}${row('levels', '程度', levels)}${row('purpose', '目的', esc(s.purpose))}${row('outputs', '产出', esc(s.outputs))}${row('ratio', '产品/技术', esc(s.ratio))}${row('materials', '已有资料', esc(s.materials))}</ul>
    <button class="btn sm gh" data-act="ob-edit-sum">直接改摘要</button>`;
}

function render() {
  const d = $('#obDlg'), cfgOk = true;
  if (S.step === 'talk') {
    const st = summaryStatus(S.summary), clear = Object.values(st).every(Boolean);
    d.innerHTML = `<div class="ob"><div class="ob-h"><h3>规划我的学习路线</h3><span class="fnt small">第 ${Math.min(S.round + 1, MAX_ROUNDS)} / ${MAX_ROUNDS} 轮</span><button class="x" data-act="ob-close" aria-label="关闭">×</button></div>
      <div class="ob-b"><div class="ob-chat" id="obChat">
        ${S.msgs.length ? '' : `<div class="ai md"><p>先用一段话说说：想学哪些方向、每个方向学到哪了、想达到什么目标。说不全也没关系，我会追问。</p><p class="fnt small">例如：“在准备 AI 产品经理求职。Transformer 懂，Agent 的 ReAct 学过但细节忘了，MCP 没写过；量化完全没接触过。想做出几个能放进作品集的项目。”</p></div>`}
        ${S.msgs.map(m => m.role === 'user' ? `<div class="me">${esc(m.content)}</div>` : m.role === 'err' ? `<div class="ai err">${esc(m.content)}</div>` : `<div class="ai md">${md(extractBlocks(m.content).text)}</div>`).join('')}
      </div><aside class="ob-sum"><b>学习路线摘要</b><p class="fnt small">理清的打勾，模糊的标黄</p>${summaryHtml()}</aside></div>
      <form class="ob-in" id="obForm"><textarea id="obText" rows="3" placeholder="${S.msgs.length ? '回答上面的问题，或补充说明' : '说说你的情况'}"></textarea>
        <div class="ob-f"><button type="button" class="btn gh" data-act="ob-default">先用默认路线</button>
          <button type="button" class="btn" data-act="ob-gen"${S.summary && (S.summary.tracks || []).length ? '' : ' disabled'}>${clear ? '确认，生成方案' : '按现在的理解生成'}</button>
          <button class="btn pri" id="obSend">发送</button></div></form></div>`;
    const ta = $('#obText');
    ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#obForm').requestSubmit(); } });
    $('#obForm').addEventListener('submit', e => { e.preventDefault(); const v = ta.value.trim(); if (v) talk(v); });
    const c = $('#obChat'); c.scrollTop = c.scrollHeight; setTimeout(() => ta.focus(), 30);
  } else if (S.step === 'gen') {
    d.innerHTML = `<div class="ob"><div class="ob-h"><h3>生成方案</h3><button class="x" data-act="ob-close" aria-label="关闭">×</button></div>
      <div class="ob-gen" id="obGen"><p class="mut">正在为每个方向生成方案…</p></div></div>`;
  } else {
    const plans = S.plans.map(p => registerPlan(p));
    const byTrack = {};
    plans.forEach(p => { (byTrack[p.track] = byTrack[p.track] || []).push(p); });
    d.innerHTML = `<div class="ob"><div class="ob-h"><h3>你的个人方案</h3><button class="x" data-act="ob-close" aria-label="关闭">×</button></div>
      <div class="ob-gen"><p class="mut">只在原有路线上裁剪和改写。逐条勾选、逐个方向应用；跳过和“已掌握”默认不勾，需要你自己勾上。应用后阶段卡片上会显示“已个性化”，随时能恢复原版。</p>
      ${Object.entries(byTrack).map(([tid, ps]) => `<section class="obt"><h4 style="color:${M.track(tid)?.color || 'inherit'}">${esc(M.track(tid)?.name || tid)}</h4>${ps.map(p => planCard(p)).join('')}</section>`).join('')}
      ${S.drafts.map((t, i) => `<section class="obt"><h4>${esc(t.name)} <span class="tag mine">新方向草稿</span></h4><p class="small mut">${t.stages.length} 个阶段：${t.stages.map(s => esc(s.title)).join(' → ')}</p>
        <div class="pf"><button class="btn sm gh" data-act="ob-draft-drop" data-i="${i}">不要</button><button class="btn sm acc" data-act="ob-draft-add" data-i="${i}">加入为我的方向</button></div></section>`).join('')}
      ${!plans.length && !S.drafts.length ? '<p class="empty">Agent 没有给出修改，路线保持原版。</p>' : ''}
      ${S.genNotes ? `<div class="md small mut">${md(S.genNotes)}</div>` : ''}
      <div class="ob-f"><button class="btn" data-act="ob-restart">重新描述</button><button class="btn pri" data-act="ob-finish">完成</button></div></div></div>`;
  }
}

async function talk(text) {
  const cfg = await aiCfg();
  if (!cfg.key && cfg.provider !== 'custom') { toast('先在“设置”里选择 AI 服务并填 Key'); location.hash = '#/settings'; $('#obDlg').close(); return; }
  S.msgs.push({ role: 'user', content: text }); render();
  const chatEl = $('#obChat'); const el = document.createElement('div'); el.className = 'ai md fnt'; el.textContent = '思考中…'; chatEl.appendChild(el);
  $('#obSend').disabled = true;
  try {
    const sys = onboardPrompt(M.tracks().filter(t => !t.mine));
    const history = S.msgs.filter(m => m.role !== 'err').map(m => ({ role: m.role, content: m.content }));
    if (S.round >= MAX_ROUNDS - 1) history.push({ role: 'user', content: '（已经是最后一轮了：不要再追问，把仍不清楚的项写进 unclear，按合理默认值填好摘要，ready 设为 true。）' });
    let acc = '';
    const res = await chat(cfg, [{ role: 'system', content: sys }, ...history], { onDelta: d => { acc += d; el.className = 'ai md'; el.innerHTML = md(extractBlocks(acc.replace(/```summary[\s\S]*$/, '')).text); chatEl.scrollTop = chatEl.scrollHeight; } });
    await addUsage(cfg, res.usage);
    S.msgs.push({ role: 'assistant', content: res.text });
    const sum = extractBlocks(res.text).blocks.find(b => b.type === 'summary');
    if (sum) S.summary = sum.data;
    S.round++;
  } catch (e) { S.msgs.push({ role: 'err', content: e.message }); }
  await save(); render();
}

async function generate() {
  const cfg = await aiCfg(), sum = S.summary || {};
  S.step = 'gen'; render();
  const box = $('#obGen'), line = t => { box.insertAdjacentHTML('beforeend', `<p class="small">${t}</p>`); };
  const profile = profileFromSummary(sum, (store.get('meta', 'profile') || '').slice(0, 300));
  store.put('meta', 'profile', profile.slice(0, 8000)); store.put('meta', 'summary', sum);
  S.plans = []; S.drafts = []; S.genNotes = '';
  const sys = '你是学习路线规划助手，用中文。学习者档案：' + profile;
  for (const t of sum.tracks || []) {
    const pub = t.id && M.track(t.id) && !M.track(t.id).mine ? M.track(t.id) : M.tracks().find(x => x.name === t.name);
    try {
      if (pub) {
        line(`正在生成“${esc(pub.name)}”…`);
        const st = M.state(pub.id);
        const text = st.stages.map((s, i) => `## 阶段 ${i + 1}\n` + stageContext({ ...s, items: s.items.map(x => ({ ...x, done: store.isDone(x.id) })) }, pub)).join('\n');
        const res = await chat(cfg, [{ role: 'system', content: sys }, { role: 'user', content: planForTrackPrompt(pub, text, t) }], { maxTokens: 3000 });
        await addUsage(cfg, res.usage);
        const { text: rest, blocks } = extractBlocks(res.text);
        for (const b of blocks.filter(b => b.type === 'plan')) {
          const f = M.findStage(b.data.stage); if (!f || f.t.id !== pub.id) continue;
          const p = cleanPlan(b.data, f.s); if (p) S.plans.push({ ...p, id: 'ob_' + p.stage.replace(/\./g, '_'), track: pub.id, from: '' });
        }
        if (rest) S.genNotes += `**${pub.name}**：${rest}\n\n`;
      } else if (t.name) {
        line(`正在起草新方向“${esc(t.name)}”…`);
        const res = await chat(cfg, [{ role: 'system', content: sys }, { role: 'user', content: draftTrackPrompt(t.name, t) }], { maxTokens: 3500 });
        await addUsage(cfg, res.usage);
        const b = extractBlocks(res.text).blocks.find(b => b.type === 'track');
        if (b) { const nt = normalizeTrack({ ...b.data, name: b.data.name || t.name }, { source: 'Agent 起草' }); if (nt.stages.length) S.drafts.push(nt); }
      }
    } catch (e) { line(`<span class="err">${esc(t.name)}：${esc(e.message)}</span>`); }
  }
  S.step = 'done'; await save(); render();
}

const PALETTE = ['#3C6E71', '#B5446E', '#5B7F1F', '#AF6E1A', '#2E6FA7', '#7A4E9C'];
act('ob-close', () => $('#obDlg').close());
act('ob-gen', () => generate());
act('ob-default', async () => { store.put('meta', 'onboarded', new Date().toISOString().slice(0, 10)); S = null; await store.localSet('onboard', null); $('#obDlg').close(); toast('已使用默认路线。随时可以在工作台点“和 Agent 规划我的路线”。'); });
act('ob-restart', async () => { S = { msgs: [], summary: S.summary, round: 0, step: 'talk', plans: [], drafts: [] }; await save(); render(); });
act('ob-finish', async () => { store.put('meta', 'onboarded', new Date().toISOString().slice(0, 10)); await store.localSet('onboard', null); $('#obDlg').close(); refresh(); });
act('ob-draft-add', el => {
  const t = S.drafts[+el.dataset.i]; if (!t) return;
  const n = Object.keys(store.all('tracks')).length;
  store.put('tracks', t.id, { ...t, color: PALETTE[n % PALETTE.length] });
  S.drafts.splice(+el.dataset.i, 1); save(); render(); refresh(); toast(`已加入方向“${t.name}”`);
});
act('ob-draft-drop', el => { S.drafts.splice(+el.dataset.i, 1); save(); render(); });
act('ob-edit-sum', async () => {
  const cur = JSON.stringify(S.summary || { tracks: [], purpose: '', outputs: '', ratio: '', materials: '' }, null, 1);
  const v = prompt('直接修改摘要（JSON 格式）：', cur); if (v === null) return;
  try { S.summary = JSON.parse(v); await save(); render(); } catch (e) { toast('格式不对，没有保存'); }
});
act('onboard', () => openOnboard());
export const _fields = ONBOARD_FIELDS;
