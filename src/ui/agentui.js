// 学习 Agent 抽屉：对话、上下文、修改方案、工具调用、花费控制。
import { $, esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { md } from '../core/md.js';
import { uid, hash } from '../core/ids.js';
import { chat, cost, PROVIDERS } from '../ai/providers.js';
import * as cloud from '../store/cloud.js';
import { systemPrompt, stageContext, extractBlocks, cleanPlan, digestPrompt, digestText } from '../ai/agent.js';
import { applyMethodOps, activeMethod, methodView } from '../core/method.js';
import { addAttempt, isMastered, mastery, masteryLines, suggestMastered, KINDS as QKINDS } from '../core/mastery.js';
import { indexDigest, searchDigests } from '../ai/embed.js';
import { act, refresh, toast, PICK, MAX_PICK, pickBar } from './kit.js';
import { planCard, registerPlan } from './suggest.js';
import { stageLabel } from './home.js';

/* ---------- 设置与花费（只存本设备） ---------- */
// 网站接了云端时，默认用管理员提供的内测模型；否则默认魔搭
export async function aiCfg() {
  let c = await store.localGet('ai');
  if (c && c.provider === 'hosted' && !cloud.hostedAI()) c = null;
  c = c || (cloud.hostedAI() ? { provider: 'hosted', model: '', key: '', budget: 0 } : { provider: 'modelscope', model: PROVIDERS.modelscope.model, key: '', budget: 30 });
  return c.provider === 'hosted' ? { ...c, endpoint: cloud.aiEndpoint } : c;
}
export const saveCfg = c => { const { endpoint, ...rest } = c; return store.localSet('ai', rest); };
// 能不能调用；不能时返回原因
export function aiBlock(cfg) {
  if (cfg.provider === 'hosted') return !cloud.hostedAI() ? '这个网站没有接云端，请在设置里换一个服务商' : !cloud.signedIn() ? '内测模型需要先登录：设置 → 账号与云端同步' : '';
  return cfg.key || cfg.provider === 'custom' ? '' : '还没有设置 AI 服务。去“设置”选一个服务商并填 Key';
}
const month = () => new Date().toISOString().slice(0, 7);
export async function usage() { const u = (await store.localGet('usage')) || {}; return u.m === month() ? u : { m: month(), cny: 0, tin: 0, tout: 0, calls: 0 }; }
async function addUsage(cfg, us) {
  const u = await usage(); u.cny += cost(cfg, us); u.tin += us.in; u.tout += us.out; u.calls++;
  await store.localSet('usage', u); return u;
}

/* ---------- 上下文 ---------- */
// ctx：{ kind, id, title, text（发给模型的上下文）, pills }
function stageCtx(id) {
  const f = M.findStage(id); if (!f) return null;
  const s = { ...f.s, items: f.s.items.map(i => ({ ...i, done: store.isDone(i.id) })) };
  const cards = Object.values(store.all('cards')).filter(c => c.at === id).map(c => '- ' + c.t).join('\n');
  const notes = [store.note(id), cards].filter(Boolean).join('\n');
  const lib = Object.values(store.all('library')).filter(d => d.at === id).map(d => `【导入资料：${d.title}】\n${d.text.slice(0, 3000)}`).join('\n\n');
  return { stage: f.s, track: f.t, text: stageContext(s, f.t, notes) + (lib ? '\n\n' + lib : ''), notes: !!notes, tests: masteryLines(f.s, store.all('tests')) };
}
function routeCtx(id) {
  const r = M.routes().find(x => x.id === id); if (!r) return null;
  const n = M.routeNews(id).slice(0, 25).map(x => `- ${x.d} ${x.t}（${x.src || ''}）`).join('\n');
  const learn = (r.learn || []).map(i => `- ${i.text}${store.isDone(i.id) ? '（已完成）' : ''}`).join('\n');
  return `前沿路线：${M.routeName(id)}（${id}）\n说明：${r.desc}\n关键词：${(r.kw || []).join('、')}\n现有跟踪学习清单：\n${learn || '（空）'}\n最近进展：\n${n || '（暂无）'}`;
}
function trackCtx(tid) {
  const t = M.track(tid), st = M.state(tid);
  return `方向：${t.name}（${t.id}）\n目标：${t.goal || ''}\n` + st.stages.map((s, i) => `\n## 阶段 ${i + 1}\n` + stageContext({ ...s, items: s.items.map(x => ({ ...x, done: store.isDone(x.id) })) }, t, store.note(s.id))).join('\n');
}

const KINDS = {
  free: () => ({ title: '自由对话', text: '用户正在看的页面：' + (document.title || '') + '\n在学：' + M.doing().map(d => d.kind === 'stage' ? `${d.t.name} / ${d.s.title}（${d.s.id}）` : `${d.t.name} / 前沿：${d.r.title}`).join('；'), pills: ['在学的阶段'] }),
  adjust: id => { const c = stageCtx(id); return c && { title: '调整阶段', stageId: id, text: c.text, pills: ['这个阶段', c.notes ? '相关笔记' : null], first: `说说你在“${c.stage.title}”上的情况：哪些已经会了、哪里卡住、想做出什么。我会先问清楚，再在原有阶段上给出修改方案，你逐条确认后才生效。` }; },
  check: id => { const c = stageCtx(id); return c && { title: '根据笔记检查', stageId: id, text: c.text, pills: ['这个阶段', '相关笔记'], auto: '请根据我在这个阶段的笔记，找出可能的卡点或理解偏差，再判断哪些任务我可能已经会了。如果需要调整，用 plan 代码块给出修改方案（跳过只作为建议）。如果笔记太少无法判断，就直接说，并告诉我应该记些什么。' }; },
  stage: id => { const c = stageCtx(id); return c && { title: '阶段对话', stageId: id, text: c.text, tests: c.tests, pills: ['这个阶段', c.notes ? '相关笔记' : null] }; },
  quiz: id => { const c = stageCtx(id); return c && { title: '自测', stageId: id, text: c.text, tests: c.tests, pills: ['这个阶段', '自测记录'],
    auto: '考考我这个阶段。先挑一个还没自测或没达标的任务出一道题；我答完你批改，再出下一道。', label: '开始自测' }; },
  card: id => { const c = store.get('cards', id); if (!c) return null; const s = c.at ? stageCtx(c.at) : null;
    return { title: '消化笔记', stageId: c.at && M.findStage(c.at) ? c.at : null, cardId: id, text: (s ? s.text + '\n\n' : '') + '用户想讨论的这条笔记：\n' + c.t, pills: ['这条笔记', c.at ? stageLabel(c.at) : null],
      auto: '这是我刚记下的一条笔记。帮我消化它：指出理解对不对、有没有偏差，补一个具体例子；需要的话问我一个检验理解的问题。最后把值得留下的内容放在 note 代码块里。' }; },
  doc: id => { const s = stageCtx(id); const text = store.note(id); return { title: '讨论阶段文档', stageId: s ? id : null, text: (s ? s.text : routeCtx(id) || '') + '\n\n阶段文档：\n' + text.slice(0, 6000), pills: ['阶段文档'] }; },
  organize: id => { const cards = Object.values(store.all('cards')).filter(c => c.at === id).sort((a, b) => a.c - b.c); const doc = store.note(id);
    return { title: '整理卡片', docId: id, text: `阶段：${stageLabel(id)}\n现有文档：\n${doc || '（空）'}\n\n卡片笔记：\n${cards.map(c => '- ' + c.t).join('\n')}`, pills: [`${cards.length} 张卡片`, '阶段文档'],
      auto: '把这些卡片整理进阶段文档：保留文档原有内容，合并重复的点，按主题分小标题，标出还没搞懂的问题。输出完整的新文档，放在 note 代码块里（text 字段是完整 Markdown，at 字段是阶段 ID）。' }; },
  news: id => { const n = M.news().find(x => x.id === id); if (!n) return null;
    const rel = M.news().filter(x => x.id !== id && x.r.some(r => n.r.includes(r))).slice(0, 6);
    return { title: '一键解析', newsIds: [id], routeId: n.r[0] || null, text: newsBlock(n) + `\n\n同一前沿路线最近的其他进展（供参考）：\n${rel.map(x => `- ${x.d} ${x.t}`).join('\n') || '（无）'}\n\n${doingText()}`,
      pills: ['这条资讯', rel.length ? `${rel.length} 条相关进展` : null, '在学的阶段'], auto: EXPLAIN_ONE }; },
  multi: ids => { const L = String(ids).split(',').map(id => M.news().find(x => x.id === id)).filter(Boolean); if (L.length < 2) return null;
    return { title: `关联解析 · ${L.length} 条`, newsIds: L.map(n => n.id), routeId: (L[0].r || [])[0] || null, text: L.map((n, i) => `【${i + 1}】` + newsBlock(n)).join('\n\n') + '\n\n' + doingText(),
      pills: [`${L.length} 条资讯`, '在学的阶段'], auto: EXPLAIN_MANY }; },
  route: id => { const t = routeCtx(id); return t && { title: '更新跟踪学习清单', routeId: id, text: t, pills: ['这条前沿路线', '最近进展'],
    auto: '根据这条前沿路线的最新进展，补充 2–4 项跟踪学习任务（至少一项实践验证），放在 route 代码块里：{"route":"路线 ID","items":[{"text":"…","mode":"theory 或 practice","url":"确定才填"}]}。不要重复已有清单，并用一两句话说明为什么选这些。' }; },
  track: id => ({ title: '规划这个方向', text: trackCtx(id), pills: ['整个方向'], first: `想怎么调整“${M.track(id).name}”？可以说说你整体学到哪了、目标是什么。我会先问清楚，再对需要调整的阶段各给一份修改方案。` })
};

function newsBlock(n) {
  return `标题：${n.t}\n来源：${n.src || ''}（${n.lvl ? { A: '一手来源', B: '权威媒体', C: '社区讨论，未核实' }[n.lvl] : '未定级'}${n.via ? '，经 ' + n.via + ' 转载' : ''}）· ${n.d}\n链接：${n.u}\n摘要：${n.s || '（无）'}\n方向：${n.k.map(k => (M.track(k) || {}).name || k).join('、')}；前沿路线：${n.r.map(M.routeName).join('、') || '无'}`;
}
const doingText = () => '用户正在学：' + (M.doing().map(d => d.kind === 'stage' ? `${d.t.name} / ${d.s.title}` : `${d.t.name} / 前沿：${d.r.title}`).join('；') || '（未设置）');
const EXPLAIN_RULE = '只根据给出的标题、摘要和你确定知道的背景来讲；原文里才有的细节（数字、结论）不要编，拿不准就标“需要看原文确认”。来源是社区讨论的，提醒我它未经核实。';
const EXPLAIN_ONE = `帮我一键解析这条资讯，按下面的结构，总共不超过 400 字：
**一句话**：发生了什么。
**看懂它要知道的**：里面的术语或背景，每个一两句话讲清楚（最多 3 个）。
**为什么重要**：分技术和产品/商业两个角度，各一两句。
**和我的关系**：和我正在学的哪个阶段或前沿路线有关，建议我做什么（读原文、先补什么、还是可以略过）。
${EXPLAIN_RULE}
最后把要点整理成一张笔记，放在 note 代码块里：{"text":"Markdown 内容，开头写上资讯标题和链接","at":"最相关的阶段或前沿路线 ID，没有就留空"}。`;
const EXPLAIN_MANY = `这几条资讯我觉得有关联，但没看懂它们之间是什么关系。帮我一键解析，总共不超过 600 字：
**一句话串起来**：它们共同指向的是什么变化或趋势；如果其实没什么关系，直接说，并按话题分组。
**各条的位置**：每条一两句话，说清它在这件事里扮演的角色（起因、进展、反应、对比、反例……），用【编号】指代。
**关系**：先后、因果、竞争、互补、矛盾，哪些是确定的，哪些只是推测。
**看懂它们要知道的**：共同的术语或背景（最多 3 个）。
**对我的意义**：技术和产品各一两句，以及和我正在学的内容的关系、下一步建议。
${EXPLAIN_RULE}
最后把结论整理成一张笔记，放在 note 代码块里：{"text":"Markdown 内容，列出各条标题和链接","at":"最相关的阶段或前沿路线 ID，没有就留空"}。`;

/* ---------- 附带的资讯（拖进来或右键询问） ---------- */
// item：{ id?, t 标题, u 链接, src?, quote? 选中的文字 }
let ATT = [];
const attKey = x => x.id || x.u || x.quote;
function attText(list) {
  return list.map((x, i) => {
    const n = x.id && M.news().find(y => y.id === x.id);
    if (n) return `【${i + 1}】` + newsBlock(n);
    if (x.quote) return `【${i + 1}】用户选中的一段文字：「${x.quote.slice(0, 2000)}」${x.t ? `\n（出自：${x.t}${x.u ? '，' + x.u : ''}）` : ''}`;
    return `【${i + 1}】标题：${x.t}\n来源：${x.src || '实时动态'}\n链接：${x.u}`;
  }).join('\n\n');
}
// 把资讯放进对话框（不发送）；抽屉没开就先打开
export async function attach(items) {
  if (!dw() || dw().hidden) await openAgent('free');
  for (const x of items) if (x && (x.t || x.quote) && !ATT.some(y => attKey(y) === attKey(x))) ATT.push(x);
  ATT = ATT.slice(0, MAX_PICK);
  await renderDrawer();
  const ta = $('#agentIn'); if (ta) ta.focus();
}
// 带着资讯直接提问（右键菜单）
export async function askWith(items, question) {
  if (!dw() || dw().hidden) await openAgent('free');
  ATT = items.slice(0, MAX_PICK);
  await send(question || '');
}

/* ---------- 一段对话的生命周期 ---------- */
// 对话不长期保留：离开超过设定的小时数再打开，或你点“新话题”，就把这一段压缩成“对话纪要”，原对话从上下文里移走。
// 纪要会同步到你的其他设备；原对话只在这台设备上存档（不再发给模型），纪要出错时可以回查。
const NEXT_RE = /```next[\s\S]*?```/g;
export const idleHours = () => store.get('meta', 'idleHours') || 6;
const idleMs = () => idleHours() * 3600e3;
const lastTs = msgs => Math.max(0, ...msgs.map(m => m.ts || 0));
const ctxAt = () => { const a = CUR && (CUR.stageId || CUR.routeId || CUR.docId); return a && (M.findStage(a) || M.route(a)) ? a : null; };
const sessionInfo = () => ({ kind: CUR.kind, title: CUR.title, at: ctxAt() });
async function indexSession(key, info) {
  const ix = (await store.localGet('chatIndex')) || {};
  if (MSGS.length) ix[key] = { ...info, t: Date.now(), tries: (ix[key] || {}).tries || 0 }; else delete ix[key];
  await store.localSet('chatIndex', ix);
}
// 和当前话题相关的过去纪要：同一个阶段或路线的最近 3 份；自由对话带最近 2 份
function relatedDigests() {
  const all = Object.values(store.all('digests')).sort((a, b) => b.c - a.c), at = CUR && ctxAt();
  return at ? all.filter(g => g.at === at).slice(0, 3) : CUR && CUR.kind === 'free' ? all.slice(0, 2) : [];
}

// 把一段对话整理成纪要，并更新学习方法档案。成功返回纪要 ID；AI 不可用时返回 null，对话保留
async function closeSession(key, msgs, info, manual) {
  const talk = msgs.filter(m => (m.role === 'user' || m.role === 'assistant') && String(m.content || '').trim());
  const ix = (await store.localGet('chatIndex')) || {};
  const done = async () => { await store.localSet(key, []); delete ix[key]; await store.localSet('chatIndex', ix); };
  if (talk.filter(m => m.role === 'assistant').length < 1 || talk.length < 2) { await done(); return null; }
  const cfg = await aiCfg();
  if (aiBlock(cfg)) return null;
  const transcript = talk.map(m => `${m.role === 'user' ? '用户' : 'Agent'}：${(m.show || extractBlocks(m.content).text).slice(0, 1500)}`).join('\n\n').slice(-12000);
  const view = methodView(store.all('method')), lines = view.lines;
  const userText = talk.filter(m => m.role === 'user' && !m.auto).map(m => m.show || m.content).join('\n');
  let d = null, ops = [];
  try {
    const res = await chat(cfg, [{ role: 'system', content: digestPrompt(lines) }, { role: 'user', content: `对话主题：${info.title}${info.at ? '（' + stageLabel(info.at) + '）' : ''}\n\n${transcript}` }], { maxTokens: 1500, temperature: 0.2 });
    await addUsage(cfg, res.usage);
    const bl = extractBlocks(res.text).blocks;
    d = (bl.find(b => b.type === 'digest') || {}).data || null;
    ops = ((bl.find(b => b.type === 'method') || {}).data || {}).ops || [];
  } catch (e) { /* 网络或模型出错：下次再试 */ }
  if (!d) {
    const tries = ((ix[key] || {}).tries || 0) + 1;
    if (tries < 3 && !manual) { ix[key] = { ...(ix[key] || info), tries }; await store.localSet('chatIndex', ix); return null; }
    d = { title: info.title, learned: [], open: [], wrong: [], next: '（自动整理失败，原对话已在这台设备上存档）' };
  }
  const gid = 'g' + uid('');
  const dg = { title: String(d.title || info.title).slice(0, 60), t: digestText(d) || '（这段对话没有可沉淀的内容）', at: info.at || null, kind: info.kind, c: Date.now(), n: talk.length };
  store.put('digests', gid, dg);
  await store.localSet('arch.' + gid, msgs);
  if (info.at) writeJournal(info.at, d);
  indexDigest(gid, dg);
  const n = store.get('meta', 'methodN') || 0;
  const r = applyMethodOps(store.all('method'), ops, { n, src: gid, idGen: () => 'm' + uid(''), map: view.map, userText });
  for (const [id, x] of Object.entries(r.set)) store.put('method', id, x);
  for (const id of r.del) store.del('method', id);
  store.put('meta', 'methodN', n + 1);
  if (r.log.length || r.rejected.length) {
    const H = (await store.localGet('methodLog')) || [];
    H.unshift({ g: gid, t: Date.now(), title: dg.title, log: r.log, rejected: r.rejected.map(x => ({ t: String((x.op && (x.op.t || x.op.op)) || ''), why: x.why })) });
    await store.localSet('methodLog', H.slice(0, 30));
  }
  await done();
  refresh();
  return gid;
}
// 学习日志：每个阶段一条“上次聊到哪 / 下次重点”，最多保留 50 条（参考 DeepTutor 的学习日志）
function writeJournal(at, d) {
  const last = [d.title, ...(d.learned || []).slice(0, 2)].filter(Boolean).join('；').slice(0, 400);
  const next = String(d.next || (d.open || [])[0] || '').slice(0, 400);
  if (!last && !next) return;
  store.put('journal', at, { last, next, u: Date.now() });
  const J = Object.entries(store.all('journal')).sort((a, b) => b[1].u - a[1].u);
  for (const [k] of J.slice(50)) store.del('journal', k);
}
// 打开网站时，把离开太久的对话在后台整理掉（每次最多 3 段）
export async function sweepSessions() {
  const ix = (await store.localGet('chatIndex')) || {}, now = Date.now();
  let n = 0;
  for (const [key, info] of Object.entries(ix)) {
    if (n >= 3 || now - info.t < idleMs()) continue;
    if (CUR && key === ckey(CUR) && !dw().hidden) continue;
    const msgs = (await store.localGet(key)) || [];
    if (await closeSession(key, msgs, info)) n++;
  }
  if (n) { refresh(); toast(`已把 ${n} 段过去的对话整理成纪要`); }
}
function nextHtml() {
  const last = [...MSGS].reverse().find(m => m.role === 'assistant');
  const b = last && extractBlocks(last.content).blocks.find(x => x.type === 'next');
  const qs = (b && Array.isArray(b.data.q) ? b.data.q : []).filter(q => typeof q === 'string' && q.trim()).map(q => q.trim().slice(0, 40)).slice(0, 3);
  return qs.length ? `<div class="quick">${qs.map(q => `<button data-act="agent-next" data-q="${esc(q)}">${esc(q)}</button>`).join('')}</div>` : '';
}

/* ---------- 抽屉状态 ---------- */
let CUR = null, MSGS = [], busy = false, ctl = null, note = '';
const ckey = c => 'chat.' + c.kind + '.' + (c.kind === 'multi' ? hash(String(c.id)) : (c.id || ''));
const dw = () => $('#dw');

export async function openAgent(kind = 'free', id = '') {
  const make = KINDS[kind]; if (!make) return;
  const c = make(id); if (!c) { toast('找不到要讨论的内容'); return; }
  CUR = { kind, id, ...c };
  const key = ckey(CUR);
  MSGS = (await store.localGet(key)) || [];
  document.body.classList.add('dw-open'); dw().hidden = false;
  // 离开太久：先把上次的对话整理成纪要，再开始新的一段
  if (MSGS.length && Date.now() - lastTs(MSGS) > idleMs()) {
    note = '正在把上次的对话整理成纪要…'; await renderDrawer();
    await closeSession(key, MSGS, sessionInfo());
    MSGS = (await store.localGet(key)) || []; note = '';
  }
  await renderDrawer();
  if (!MSGS.length && CUR.auto) send(CUR.auto, { auto: true, label: CUR.label || (kind === 'news' ? '一键解析这条资讯' : kind === 'multi' ? `一键解析这 ${String(id).split(',').length} 条资讯的关联` : '') });
}
export function closeAgent() { document.body.classList.remove('dw-open'); if (dw()) dw().hidden = true; if (ctl) ctl.abort(); }

async function renderDrawer() {
  const cfg = await aiCfg(), u = await usage(), p = PROVIDERS[cfg.provider] || PROVIDERS.custom;
  const block = aiBlock(cfg), ready = !block;
  const prof = store.get('meta', 'profile'), mem = store.get('meta', 'memory');
  const nMethod = activeMethod(store.all('method')).length, nDig = relatedDigests().length;
  const pills = ['学习者档案' + (prof ? '' : '（未填）'), mem ? '长期记忆' : null, nMethod ? '你的学习方法' : null, nDig ? `${nDig} 份过去的纪要` : null, journalText() ? '学习日志' : null, ...(CUR.pills || [])].filter(Boolean);
  dw().innerHTML = `<div class="dw-h"><h3>学习 Agent</h3><span class="fnt small">${esc(CUR.title)}</span>
      <button class="x" data-act="agent-close" aria-label="收起">×</button></div>
    <div class="mem">它会看到：${pills.map(x => `<span>${esc(x)}</span>`).join('')}<button class="btn sm gh" data-act="agent-new" title="把这段对话整理成纪要，然后开始新话题"${MSGS.length && !busy ? '' : ' disabled'}>新话题</button></div>
    <div class="msgs" id="msgs" aria-live="polite">${ready ? '' : `<div class="ai"><p>${esc(block)}。</p><p><a class="btn sm acc" href="#/settings" data-act="agent-close">去设置</a></p></div>`}
      ${CUR.first && !MSGS.length ? `<div class="ai md">${md(CUR.first)}</div>` : ''}
      ${MSGS.map(msgHtml).join('')}${note ? `<div class="tool">${esc(note)}</div>` : ''}</div>
    ${busy ? '' : nextHtml()}
    <form class="inb" id="agentForm">${ATT.length ? `<div class="att">${ATT.map((x, i) => `<span class="attc" title="${esc(x.u || '')}">${x.quote ? '“' + esc(x.quote.slice(0, 24)) + '…”' : esc(x.t.slice(0, 40))}<button type="button" data-act="att-rm" data-i="${i}" aria-label="移除">×</button></span>`).join('')}</div>` : ''}
      <textarea id="agentIn" rows="2" placeholder="${ATT.length ? '想问什么？直接按 Enter 就是让 Agent 解析' : '说说你的情况，或者问一个问题。可以把资讯拖进来。Enter 发送，Shift+Enter 换行'}"${ready ? '' : ' disabled'}></textarea>
      <div class="inb-r"><span class="fnt small">需要时会自己去查你的笔记和资讯</span>
      <button class="btn pri" id="agentSend"${ready ? '' : ' disabled'}>${busy ? '停止' : '发送'}</button></div>
      <div class="cost">${cfg.provider === 'hosted' ? `内测模型${cfg.model ? ' · ' + esc(cfg.model) : ''} · 本月 ${u.calls} 次` : `${esc(p.name)} · ${esc(cfg.model || p.model)} · 本月 ¥${u.cny.toFixed(2)}${cfg.budget ? ` / 上限 ¥${cfg.budget}` : ''} · ${u.calls} 次`}</div></form>`;
  const box = $('#msgs'); box.scrollTop = box.scrollHeight;
  const ta = $('#agentIn');
  ta.addEventListener('keydown', e => { if (e.key === 'Enter' && !e.shiftKey && !e.isComposing) { e.preventDefault(); $('#agentForm').requestSubmit(); } });
  $('#agentForm').addEventListener('submit', e => { e.preventDefault(); if (busy) { ctl && ctl.abort(); return; } const v = ta.value.trim(); if (v || ATT.length) { ta.value = ''; send(v); } });
  if (ready && matchMedia('(min-width: 821px)').matches) setTimeout(() => ta.focus(), 30);
}

function msgHtml(m, i) {
  if (m.role === 'user') {
    if (m.auto) return `<div class="me auto">${esc(m.label || m.content.slice(0, 60) + '…')}</div>`;
    const att = (m.att || []).map(x => `<span class="attc">${x.u ? `<a href="${esc(x.u)}" target="_blank" rel="noopener">${esc(x.t.slice(0, 50))}</a>` : esc(x.t.slice(0, 50))}</span>`).join('');
    return `<div class="me">${esc(m.show ?? m.content)}${att ? `<div class="att in">${att}</div>` : ''}</div>`;
  }
  if (m.role === 'tool') return `<div class="tool">${esc(m.content)}</div>`;
  if (m.role === 'err') return `<div class="ai err">${esc(m.content)}</div>`;
  const { text, blocks } = extractBlocks(m.content);
  const extra = blocks.map((b, k) => blockHtml(b, `${i}.${k}`)).join('') + gradeHtml(m, i);
  const save = blocks.some(b => b.type === 'note') ? '' : `<button class="lnk" data-act="msg-note" data-i="${i}">存进笔记</button>`;
  return `<div class="ai"><div class="md">${md(text)}</div>${extra}<div class="fnt small mfoot">${save}${m.cost != null ? `<span>约 ${m.tin + m.tout} token · ¥${m.cost.toFixed(4)}${m.est ? '（估算）' : ''}</span>` : ''}</div></div>`;
}

const BLOCKS = new Map();
function blockHtml(b, key) {
  BLOCKS.set(key, b);
  if (b.type === 'plan') {
    const f = M.findStage(b.data.stage || CUR.stageId);
    const plan = f && cleanPlan(b.data, f.s);
    if (!plan) return `<p class="fnt small">（Agent 给出的方案里没有可用的修改，或者阶段 ID 不对。）</p>`;
    return planCard(registerPlan({ ...plan, id: 'p' + key.replace(/\./g, '_') + '_' + plan.stage.replace(/\./g, '_'), from: '', title: plan.title, why: '学习 Agent 的建议', track: f.t.id }), { later: true });
  }
  if (b.type === 'note') return `<div class="blk"><div class="md">${md(String(b.data.text || '').slice(0, 1200))}</div>
    <div class="pf"><button class="btn sm ${CUR.docId ? 'acc' : ''}" data-act="blk-note" data-k="${key}">${CUR.docId ? '用这个替换阶段文档' : '存进笔记'}</button></div></div>`;
  if (b.type === 'memory') return `<div class="blk"><span class="tag ai">建议记住</span> ${esc(b.data.text || '')}<div class="pf"><button class="btn sm" data-act="blk-memory" data-k="${key}">记住</button></div></div>`;
  if (b.type === 'route') {
    const items = (b.data.items || []).filter(x => x && x.text).slice(0, 8);
    return `<div class="blk"><b class="small">跟踪学习清单补充</b><ul>${items.map(x => `<li>${x.mode === 'practice' ? '<span class="tag">实践验证</span> ' : ''}${esc(x.text)}${x.url ? ' <span class="tag ai">链接未核实</span>' : ''}</li>`).join('')}</ul>
      <div class="pf"><button class="btn sm acc" data-act="blk-route" data-k="${key}">加入清单</button></div></div>`;
  }
  if (b.type === 'quiz') return `<div class="quiz"><div class="k">自测题 · ${esc(QKINDS[b.data.kind] || '记忆')}类${b.data.kind === 'concept' ? '（用你自己的话讲）' : ''}</div><div class="md">${md(String(b.data.q || ''))}</div></div>`;
  if (b.type === 'tool' || b.type === 'summary' || b.type === 'next' || b.type === 'grade') return '';
  return '';
}

/* ---------- 发送 ---------- */
const TOOLS = {
  list_tracks: () => M.tracks().map(t => `${t.id}：${t.name}，当前阶段 ${M.state(t.id).current || '已学完'}`).join('\n'),
  get_stage: a => { const c = stageCtx(a.id); return c ? c.text : '没有这个阶段 ID'; },
  search_news: a => {
    const q = String(a.query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const hits = M.news().filter(n => (!a.track || n.k.includes(a.track)) && q.every(w => (n.t + ' ' + (n.s || '')).toLowerCase().includes(w))).slice(0, 10);
    return hits.map(n => `- ${n.d} ${n.t}（${n.src || ''}）${n.u}`).join('\n') || '没有找到';
  },
  get_notes: a => {
    const cs = Object.values(store.all('cards')).filter(c => (a.at ? c.at === a.at : true) && (!a.query || c.t.includes(a.query))).slice(0, 20).map(c => '- ' + c.t.slice(0, 400));
    const doc = a.at ? store.note(a.at) : '';
    return [doc && '阶段文档：\n' + doc.slice(0, 3000), cs.join('\n')].filter(Boolean).join('\n\n') || '没有笔记';
  },
  get_route: a => routeCtx(a.id) || '没有这条路线',
  search_digests: async a => {
    const all = store.all('digests'), ids = await searchDigests(a.query, 5);
    const q = String(a.query || '').toLowerCase().split(/\s+/).filter(Boolean);
    const hits = ids && ids.length ? ids.map(id => all[id]).filter(Boolean)
      : Object.values(all).filter(g => q.every(w => (g.title + ' ' + g.t).toLowerCase().includes(w))).sort((x, y) => y.c - x.c).slice(0, 5);
    return hits.map(g => `## ${new Date(g.c).toLocaleDateString('zh-CN')} ${g.title}\n${g.t.slice(0, 1200)}`).join('\n\n') || '没有找到相关的对话纪要';
  }
};
const TOOL_LABEL = { list_tracks: '查看你的学习方向', get_stage: '查看一个阶段', search_news: '搜索资讯', get_notes: '查看你的笔记', get_route: '查看前沿路线', search_digests: '查找过去的对话纪要' };

async function send(text, opts = {}) {
  if (busy) return;
  const cfg = await aiCfg();
  const u = await usage();
  if (cfg.budget && u.cny >= cfg.budget && !confirm(`本月已经用了 ¥${u.cny.toFixed(2)}，超过你设的上限 ¥${cfg.budget}。还要继续调用吗？`)) return;
  if (cfg.budget && u.cny >= cfg.budget * 0.8 && u.cny < cfg.budget && !opts.warned) toast(`本月花费已到上限的 ${Math.round(u.cny / cfg.budget * 100)}%`);
  if (ATT.length && !opts.auto) {
    const list = ATT; ATT = [];
    const q = text || (list.length > 1 ? `解析这 ${list.length} 条之间的关联` : list[0].quote ? '解释一下这段话' : '解析这条资讯');
    const rule = !text ? '\n\n' + (list.length > 1 ? EXPLAIN_MANY : EXPLAIN_ONE).replace(/^[^\n]*\n/, '按下面的结构回答：\n') : '\n\n' + EXPLAIN_RULE;
    MSGS.push({ role: 'user', show: q, att: list.map(x => ({ t: x.quote ? '“' + x.quote.slice(0, 40) + '…”' : x.t, u: x.u || '' })),
      content: `${q}\n\n附带的内容：\n${attText(list)}${rule}` });
  } else MSGS.push({ role: 'user', content: text, ...(opts.auto ? { auto: true, label: opts.label } : {}) });
  MSGS[MSGS.length - 1].ts = Date.now();
  busy = true; await renderDrawer();
  const box = $('#msgs');
  const sys = systemPrompt({ profile: store.get('meta', 'profile'), memory: store.get('meta', 'memory'), recent: recentChanges(),
    method: activeMethod(store.all('method')).map(([, x]) => `- ${x.d}：${x.t}`).join('\n'),
    digests: relatedDigests().map(g => `- ${new Date(g.c).toLocaleDateString('zh-CN')} ${g.title}：${g.t.replace(/\s+/g, ' ').slice(0, 700)}`).join('\n'),
    journal: journalText(), tests: CUR.tests || '' });
  const steps = 6;
  try {
    for (let step = 0; step < steps; step++) {
      const history = MSGS.filter(m => m.role !== 'err').slice(-16).map(m => m.role === 'tool' ? { role: 'user', content: '工具结果：\n' + m.result } : { role: m.role, content: m.role === 'assistant' ? m.content.replace(NEXT_RE, '') : m.content });
      const messages = [{ role: 'system', content: sys + '\n\n当前上下文：\n' + CUR.text }, ...history];
      const el = document.createElement('div'); el.className = 'ai'; el.innerHTML = '<div class="md fnt">思考中…</div>'; box.appendChild(el);
      let acc = '';
      ctl = new AbortController();
      const res = await chat(cfg, messages, { signal: ctl.signal, onDelta: d => { acc += d; el.firstChild.className = 'md'; el.firstChild.innerHTML = md(acc.replace(/```next[\s\S]*?(```|$)/g, '').replace(/```[\s\S]*?(```|$)/g, '\n（正在生成方案…）\n')); box.scrollTop = box.scrollHeight; } });
      const c = cost(cfg, res.usage); await addUsage(cfg, res.usage);
      MSGS.push({ role: 'assistant', ts: Date.now(), content: res.text, cost: c, tin: res.usage.in, tout: res.usage.out, est: res.estimated });
      const { blocks } = extractBlocks(res.text);
      recordQuiz(blocks, MSGS.length - 1);
      const tool = blocks.find(b => b.type === 'tool');
      if (!tool) break;
      const fn = TOOLS[tool.data.name];
      const out = fn ? String(await fn(tool.data.args || {})).slice(0, 6000) : '没有这个工具';
      MSGS.push({ role: 'tool', ts: Date.now(), content: TOOL_LABEL[tool.data.name] || `调用 ${tool.data.name}`, result: out });
      await renderDrawer();
    }
  } catch (e) {
    if (e.name !== 'AbortError') MSGS.push({ role: 'err', content: e.message || String(e) });
  }
  busy = false; ctl = null;
  MSGS = MSGS.slice(-60);
  await store.localSet(ckey(CUR), MSGS);
  await indexSession(ckey(CUR), sessionInfo());
  await renderDrawer();
}

function journalText() {
  const at = ctxAt(); const j = at && store.get('journal', at);
  return j ? `${stageLabel(at)}（${new Date(j.u).toLocaleDateString('zh-CN')}）上次：${j.last || '—'}；下次重点：${j.next || '—'}` : '';
}
/* ---------- 自测 ---------- */
// 出的题先记在本机“待批改”里（参考答案不显示）；收到批改结果后记一次作答，算掌握度
const quizItem = id => { const f = CUR && CUR.stageId && M.findStage(CUR.stageId); if (!f) return null; return f.s.items.some(i => i.id === id) ? id : f.s.id; };
function recordQuiz(blocks, mi) {
  const U = store.ui(); U.quizPending = U.quizPending || {};
  for (const b of blocks) {
    if (b.type === 'quiz' && b.data.q) {
      const item = quizItem(b.data.item); if (!item) continue;
      U.quizPending[item] = { q: String(b.data.q).slice(0, 400), a: String(b.data.a || '').slice(0, 600), k: QKINDS[b.data.kind] ? b.data.kind : 'memory', t: Date.now(), at: CUR.stageId };
    } else if (b.type === 'grade') {
      const item = quizItem(b.data.item); if (!item) continue;
      const pend = U.quizPending[item] || {};
      const rec = addAttempt(store.get('tests', item), { kind: pend.k || b.data.kind, s: +b.data.score, h: +b.data.hints || 0, r: +b.data.retries || 0, p: b.data.pass !== false && +b.data.score >= 0.6, q: pend.q ? { t: pend.q, a: pend.a } : null });
      store.put('tests', item, rec);
      delete U.quizPending[item];
      MSGS[mi].graded = { item, m: mastery(rec), ok: isMastered(rec) };
    }
  }
  store.saveUi();
  if (blocks.some(b => b.type === 'quiz' || b.type === 'grade')) refresh();   // 阶段卡片上的掌握度跟着更新
}
function gradeHtml(m, i) {
  const g = m.graded; if (!g) return '';
  const f = M.findStage(CUR.stageId), it = f && f.s.items.find(x => x.id === g.item);
  const recs = store.all('tests'), whole = f && suggestMastered(f.s, recs, store.done());
  return `<div class="quiz"><div class="k">自测记录 · ${esc(it ? it.text.slice(0, 40) : '这个阶段')}</div>掌握度 <b>${Math.round(g.m * 100)}%</b>${g.ok ? ' · 已达标' : ''}
    ${g.ok && it && !store.isDone(it.id) ? `<div class="pf"><button class="btn sm" data-act="quiz-done" data-id="${it.id}">把这项勾为完成</button></div>` : ''}
    ${whole ? `<div class="pf"><span class="small">这个阶段每一项都完成了或自测达标。</span><button class="btn sm acc" data-act="master" data-id="${f.s.id}">标为已掌握</button></div>` : ''}</div>`;
}
act('quiz-done', el => { store.setDone(el.dataset.id, true, new Date().toISOString().slice(0, 10)); el.disabled = true; el.textContent = '已勾为完成'; refresh(); });

function recentChanges() {
  const ov = store.all('overlay');
  return Object.entries(ov).filter(([, v]) => v && v.at).sort((a, b) => b[1].at - a[1].at).slice(0, 3)
    .map(([k, v]) => `${stageLabel(k)}：${[v.mastered && '标为已掌握', v.goal && '改了目标', v.skip && `跳过 ${v.skip.length} 项`, v.add && `新增 ${v.add.length} 项`].filter(Boolean).join('，')}`).join('；');
}

/* ---------- 动作 ---------- */
act('agent-close', () => closeAgent());
act('att-rm', el => { ATT.splice(+el.dataset.i, 1); renderDrawer(); });
act('agent-new', async () => {
  if (busy || !MSGS.length) return;
  busy = true; note = '正在把这段对话整理成纪要…'; await renderDrawer();
  const gid = await closeSession(ckey(CUR), MSGS, sessionInfo(), true);
  MSGS = (await store.localGet(ckey(CUR))) || []; busy = false; note = '';
  await renderDrawer();
  toast(gid ? '已整理成纪要，可以在“我的学习方法”里查看' : '没能整理（AI 服务不可用），这段对话先保留');
});
act('agent-next', el => send(el.dataset.q));
act('msg-note', el => {
  const m = MSGS[+el.dataset.i]; if (!m) return;
  const id = 'c' + uid('');
  store.put('cards', id, { t: extractBlocks(m.content).text, at: ctxAt(), c: Date.now() });
  el.disabled = true; el.textContent = '已存进笔记'; toast('已存进笔记', () => store.del('cards', id));
});
act('blk-note', el => {
  const b = BLOCKS.get(el.dataset.k); if (!b) return;
  const text = String(b.data.text || '').trim(); if (!text) return;
  if (CUR.docId) {
    const before = store.note(CUR.docId);
    store.setNote(CUR.docId, text); refresh();
    toast('已更新阶段文档', () => { store.setNote(CUR.docId, before); refresh(); });
  } else {
    const id = 'c' + uid(''), at = M.findStage(b.data.at) || M.route(b.data.at) ? b.data.at : (CUR.stageId || CUR.routeId || null);
    store.put('cards', id, { t: text, at, c: Date.now() }); refresh();
    toast('已存进笔记', () => { store.del('cards', id); refresh(); });
  }
  el.disabled = true; el.textContent = '已保存';
});
act('blk-memory', el => {
  const b = BLOCKS.get(el.dataset.k); if (!b) return;
  const cur = store.get('meta', 'memory') || '';
  store.put('meta', 'memory', (cur ? cur + '\n' : '') + '- ' + String(b.data.text).slice(0, 300));
  el.disabled = true; el.textContent = '已记住'; toast('已记住，可以在设置里查看和修改');
});
act('blk-route', el => {
  const b = BLOCKS.get(el.dataset.k); if (!b) return;
  const rid = M.route(b.data.route) ? b.data.route : CUR.routeId; if (!rid) return;
  const m = store.get('routes', rid) || {};
  const add = (b.data.items || []).filter(x => x && x.text).slice(0, 8).map(x => ({ id: `${rid}.u${uid('').slice(0, 8)}`, text: String(x.text).slice(0, 300), mode: x.mode === 'practice' ? 'practice' : 'theory', ...(/^https?:\/\//.test(x.url || '') ? { url: x.url } : {}), ai: true }));
  store.put('routes', rid, { ...m, learnAdd: [...(m.learnAdd || []), ...add] }); refresh();
  el.disabled = true; el.textContent = '已加入'; toast(`已加入 ${add.length} 项`);
});
act('agent-adjust', el => openAgent('adjust', el.dataset.id));
act('agent-check', el => openAgent('check', el.dataset.id));
act('agent-stage', el => openAgent('stage', el.dataset.id));
act('agent-quiz', el => openAgent('quiz', el.dataset.id));
act('agent-card', el => openAgent('card', el.dataset.id));
act('agent-doc', el => openAgent('doc', el.dataset.id));
act('agent-organize', el => openAgent('organize', el.dataset.id));
act('agent-news', el => { if (!M.isRead(el.dataset.id)) store.put('read', el.dataset.id, new Date().toISOString().slice(0, 10)); openAgent('news', el.dataset.id); });
// 多选：进入选择模式 → 勾选 2–8 条 → 一键解析关联
act('pick-start', el => { PICK.on = true; PICK.ids = el.dataset.id ? [el.dataset.id] : []; refresh(); pickBar(); });
act('pick-cancel', () => { PICK.on = false; PICK.ids = []; refresh(); pickBar(); });
act('pick', el => {
  const id = el.dataset.id, i = PICK.ids.indexOf(id);
  if (i >= 0) PICK.ids.splice(i, 1);
  else if (PICK.ids.length >= MAX_PICK) { el.checked = false; toast(`一次最多选 ${MAX_PICK} 条`); return; }
  else PICK.ids.push(id);
  const on = PICK.ids.includes(id);
  setTimeout(() => { el.checked = on; }, 0);   // 点击事件被统一 preventDefault 了，这里手动同步勾选状态
  const li = el.closest('li'); if (li) li.classList.toggle('picked', on);
  pickBar();
});
act('pick-go', () => { if (PICK.ids.length < 2) return; const ids = PICK.ids.join(','); PICK.on = false; PICK.ids = []; refresh(); pickBar(); openAgent('multi', ids); });
act('route-explain', el => { const ids = M.routeNews(el.dataset.id).slice(0, MAX_PICK).map(n => n.id); if (ids.length < 2) { toast('这条路线的进展不到 2 条'); return; } openAgent('multi', ids.join(',')); });
act('agent-route', el => openAgent('route', el.dataset.id));
act('agent-track', el => openAgent('track', el.dataset.id));
act('agent-open', () => openAgent('free'));
window.addEventListener('agent:card', e => openAgent('card', e.detail));
document.addEventListener('keydown', e => { if (e.key === 'Escape' && document.body.classList.contains('dw-open') && !document.querySelector('dialog[open]')) closeAgent(); });
