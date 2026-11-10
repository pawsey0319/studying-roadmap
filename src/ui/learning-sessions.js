// 学习会话回顾：本地记录与自愿质量上报分开，恢复不重放任何动作。
import { esc } from '../util.js';
import { hash } from '../core/ids.js';
import { withSessionLock } from '../core/session-lock.js';
import { createReleaseCandidate } from '../core/agent-release.js';
import * as store from '../store/index.js';
import { uid, signedIn, onStatus } from '../store/cloud.js';
import { act, refresh, toast } from './kit.js';
import { deleteSession, createQualityPreview, authorizeQualityFeedback } from '../core/learning-session.js';

const list = value => Array.isArray(value) ? value : [];
const map = value => value && typeof value === 'object' && !Array.isArray(value) ? value : {};
const state = { selected: '', feedback: '', preview: null, notice: '', admin: null, candidates: [], inbox: [], submitted: [], busy: false, client: null };
// Generation, not uid alone: A → B → A must never revive an A request.
export function createAccountBoundary(getAccount, changed) {
  let account = getAccount(), epoch = 0;
  const sync = () => { const next = getAccount(); if (next !== account) { account = next; epoch++; changed(); } };
  return { sync, capture() {
    sync(); const ticket = epoch;
    const current = () => { sync(); return ticket === epoch; };
    const assert = () => { if (!current()) throw Object.assign(new Error('ACCOUNT_CHANGED'), { code: 'ACCOUNT_CHANGED' }); };
    return { current, assert, async wait(fn) { assert(); const result = await fn(); assert(); return result; } };
  } };
}
const boundary = createAccountBoundary(() => signedIn() ? uid() : '', () => {
  state.admin = null; state.candidates = []; state.inbox = []; state.submitted = [];
  state.preview = null; state.notice = ''; state.busy = false; state.feedback = ''; state.selected = '';
  // Remove already-rendered private content synchronously; do not recursively render.
  const root = globalThis.document?.getElementById('learning-sessions');
  if (root) root.replaceChildren();
});
const clearAccountData = () => boundary.sync();
onStatus(clearAccountData);
const STATUS = { active: '进行中', waiting: '等待用户', paused: '已暂停', completed: '已完成', failed: '失败' };
const button = (action, label, id = '', disabled = false) => `<button type="button" class="btn sm gh" data-act="${esc(action)}" data-id="${esc(id)}"${disabled ? ' disabled' : ''}>${esc(label)}</button>`;
const date = value => Number.isFinite(value) ? new Date(value).toLocaleString('zh-CN') : '时间未知';

export function sessionCards(sessions, selected = '') {
  return Object.entries(map(sessions)).filter(([, s]) => s && s.status !== 'deleted').sort((a, b) => (b[1].updatedAt || 0) - (a[1].updatedAt || 0)).map(([key, s]) => `<article class="card"><h3>${esc(s.title || '未命名任务')}</h3><p>${esc(STATUS[s.status] || s.status || '状态未知')} · ${esc(date(s.updatedAt))} · Spec ${esc(s.spec || 'unknown')}</p><p>${esc(list(s.checkpoints).at(-1)?.summary || list(s.events).at(-1)?.summary || '尚无摘要')}</p>${button('ls-select', selected === key ? '正在查看' : '查看记录', key)}</article>`).join('') || '<p class="fnt">还没有保存的学习会话。与 Agent 对话后可在这里回看；完成任务不等于已掌握。</p>';
}

export function sessionDetails(s, key) {
  const evidence = list(s.evidence), checkpoints = list(s.checkpoints);
  return `<article class="card"><h2>${esc(s.title || '任务记录')}</h2><p>任务完成不会自动更改掌握度。继续前需核对来源、设备与版本，并重新授权；不会重放旧命令。</p><p>来源：${esc(s.source?.title || '未记录')} · 版本 ${esc(s.source?.version || 'unknown')} · 设备 ${esc(s.source?.deviceId || '未记录')}（仅为历史快照，尚未验证当前来源）</p><div class="actions">${button('ls-resume', '打开当前话题（历史仅回顾）', key)} ${button('ls-feedback', '自愿分享质量反馈', key)} ${button('ls-delete', '删除本地会话及关联索引', key)}</div><h3>摘要与检查点</h3>${checkpoints.map(c => `<section><p>${esc(date(c.at))} · ${esc(c.summary)}</p><p>下一步：${esc(c.nextStep || '未记录')}</p><p class="fnt">截至事件 ${esc(c.eventCount ?? '未知')}；历史来源版本 ${esc(c.source?.version || 'unknown')}</p></section>`).join('') || '<p>尚无检查点。</p>'}<details><summary>事件时间线与证据（${esc(list(s.events).length)}）</summary>${list(s.events).map(e => `<section><h4>${esc(e.type)} · ${esc(date(e.at))}</h4><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(e.summary)}</p><p class="fnt">事件 ${esc(e.id)} · 请求 ${esc(e.requestId || '未记录')} · 来源版本 ${esc(e.sourceVersion || 'unknown')}</p>${evidence.filter(x => x.eventId === e.id).map(x => `<blockquote><p style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(x.excerpt)}</p><small>证据 ${esc(x.id)} · ${esc(x.kind)} · 版本 ${esc(x.sourceVersion || 'unknown')}（历史引用，不自动打开来源）</small></blockquote>`).join('')}</section>`).join('') || '<p>尚无事件。</p>'}</details><h3>个人学习反馈（仅自己）</h3><p>调整自己的解释节奏，不进入管理者收件箱。</p><label>我的学习感受<textarea id="ls-personal" rows="3" maxlength="1000" placeholder="例如：下次从这个步骤继续"></textarea></label>${button('ls-personal-save', '保存个人反馈', key)}</article>`;
}

function feedbackForm(s, key, configured) {
  const answers = list(s.events).filter(e => e.type === 'answer');
  return `<section class="card" id="ls-quality"><h3>质量反馈 · 独立分享预览</h3><p>拒绝上报不影响使用。默认不附回答原文、材料或媒体；请逐项选择。自动脱敏不保证没有隐私，请自己核对。</p><label>原因<select id="ls-reason"><option value="事实错误">事实错误</option><option value="忽略材料">忽略材料</option><option value="引用错误">引用错误</option><option value="权限或隐私问题">权限或隐私问题</option><option value="其他">其他</option></select></label><label>可编辑说明<textarea id="ls-note" rows="3" maxlength="600"></textarea></label><fieldset><legend>可选附件（默认不选）</legend>${answers.map((e, i) => `<label><input type="checkbox" name="ls-answer" value="${esc(i)}">回答 ${esc(e.id)}：${esc(String(e.summary || '').slice(0, 100))}</label>`).join('')}${list(s.evidence).map((e, i) => `<label><input type="checkbox" name="ls-evidence" value="${esc(i)}">证据 ${esc(e.id)}：${esc(String(e.excerpt || '').slice(0, 100))}</label>`).join('')}<label><input type="checkbox" id="ls-share-title">附来源标题</label><p>截图、录音、完整项目：当前安全提交契约不支持，不能附加。</p></fieldset>${button('ls-preview', '生成独立预览', key)} ${button('ls-feedback-cancel', '取消分享')}${state.preview ? `<h4>将提交的完整内容</h4><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(state.preview, null, 2))}</pre><label><input type="checkbox" id="ls-consent">我已检查预览，同意把上述选中内容提交给质量管理服务</label>${button('ls-submit', configured ? '确认提交此预览' : '未配置质量服务，不能提交', key, !configured || state.busy)}` : ''}<p class="fnt">${configured ? '服务已配置不代表后台已经部署或可用；提交结果以服务响应为准。' : '未配置质量服务；可在本地预览，不会发送。'}</p></section>`;
}

function submittedPanel(configured) {
  return `<section class="card"><h2>我已提交的质量反馈</h2><p>只请求当前账号的提交，不读取旧私人反馈文档。删除申请由服务处理，不等于回滚已发布版本。</p>${button('ls-submitted', '向服务查询我的提交', '', !configured)}${state.submitted.map(f => `<article><p>${esc(f.id)} · ${esc(f.status || '待处理')}</p>${button('ls-submitted-delete', '申请删除反馈及关联评测样本', f.id)}</article>`).join('')}</section>`;
}

function adminPanel(configured) {
  return `<section class="card"><h2>管理者审核入口</h2><p>与个人反馈隔离。身份与每次权限由服务端验证；前端不能授予自己管理员身份。离线回放不得执行真实副作用。</p>${button('ls-admin', configured ? '向服务验证管理权限并加载' : '服务未配置', '', !configured || state.busy)}${state.admin ? `<p>已由服务验证：${esc(state.admin.id || '管理员')}</p><h3>用户自愿提交的质量反馈</h3>${state.inbox.map(f => `<article><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(f, null, 2))}</pre>${button('ls-feedback-review', '标记已审核', f.id)}</article>`).join('') || '<p>暂无获准查看的质量反馈。</p>'}<h3>候选版本</h3><details><summary>提交待审核候选（不批准、不部署）</summary><p>只提交固定的Spec/模型版本与摘要，不能携带生产密钥或自行声明评测通过。</p><label>候选ID<input id="ls-candidate-id" maxlength="100"></label><label>Spec版本<input id="ls-candidate-spec" maxlength="100"></label><label>模型revision<input id="ls-candidate-model" maxlength="100"></label><label>变更摘要<textarea id="ls-candidate-summary" maxlength="1000"></textarea></label>${button('ls-candidate-submit', '提交待审候选')}</details>${state.candidates.map(c => `<article><h3>${esc(c.id)} · ${esc(c.state)}</h3><p>${esc(c.summary)}</p><p>Spec ${esc(c.spec)} · 模型 ${esc(c.modelRevision)} · 灰度 ${esc(c.rollout || 0)}%</p><pre style="white-space:pre-wrap;overflow-wrap:anywhere">${esc(JSON.stringify(c.evaluation || '暂无评测报告', null, 2))}</pre>${button('ls-admin-action', '审查', c.id, c.state !== 'candidate')}${button('ls-evaluate', '缺少可信评测产物，暂不能评测', c.id, true)}${button('ls-approve', '批准', c.id, c.state !== 'evaluated' || !c.evaluation?.passed)}<label>上一稳定版本<input data-ls-previous="${esc(c.id)}" maxlength="100"></label><label>灰度比例<select data-ls-rollout="${esc(c.id)}"><option value="5">5%</option><option value="25">25%</option></select></label>${button('ls-canary', '申请灰度', c.id, !['approved', 'canary'].includes(c.state))}${button('ls-release', '申请全量发布', c.id, c.state !== 'canary')}${button('ls-rollback', '回滚后续配置', c.id, !['canary', 'released'].includes(c.state))}</article>`).join('') || '<p>服务未返回候选版本。</p>'}` : ''}<p class="fnt">回滚仅影响后续配置，不撤销已发生的数据变更。本页请求真实服务，不宣称签名发布后台已部署。</p></section>`;
}

async function loadClient() {
  if (!state.client) state.client = await import('../ai/feedback-client.js');
  return state.client;
}
let configured = false;
export async function renderLearningSessions() {
  const scope = boundary.capture();
  const sessions = map(await store.localGet('learningSessions'));
  try { const client = await loadClient(); configured = client.qualityFeedbackAvailable(); } catch { configured = false; }
  if (!scope.current()) return '';
  const selected = sessions[state.selected];
  return `<section id="learning-sessions"><h1>学习会话与反馈</h1><p>本地任务回顾；不会把历史私人反馈自动交给管理者。</p>${state.notice ? `<p role="status">${esc(state.notice)}</p>` : ''}${sessionCards(sessions, state.selected)}${selected && selected.status !== 'deleted' ? sessionDetails(selected, state.selected) : ''}${selected && state.feedback === state.selected ? feedbackForm(selected, state.selected, configured) : ''}${submittedPanel(configured)}${adminPanel(configured)}</section>`;
}
export async function afterLearningSessions() {
  const field = document.querySelector('#ls-personal');
  if (field) field.value = map(await store.localGet('personalSessionFeedback'))[state.selected]?.note || '';
}
const report = error => { state.notice = `操作未完成：${error?.code || error?.message || '未知错误'}。未配置、登录失效或权限不足时不会尝试绕过服务权限。`; refresh(); };
const guard = fn => async el => { const scope = boundary.capture(); if (state.busy) return; try { await fn(el, scope); } catch (error) { if (scope.current()) report(error); } };
act('ls-select', el => { state.selected = el.dataset.id; state.feedback = ''; state.preview = null; refresh(); });
act('ls-feedback', el => { state.feedback = el.dataset.id; state.preview = null; refresh(); });
act('ls-feedback-cancel', () => { state.feedback = ''; state.preview = null; refresh(); });
act('ls-personal-save', guard(async el => {
  const values = map(await store.localGet('personalSessionFeedback'));
  values[el.dataset.id] = { note: document.querySelector('#ls-personal')?.value.slice(0, 1000) || '', at: Date.now() };
  await store.localSet('personalSessionFeedback', values); toast('已保存在本设备，仅自己可见');
}));
act('ls-resume', guard(async el => {
  const s = map(await store.localGet('learningSessions'))[el.dataset.id];
  if (!s || s.status === 'deleted') return;
  if (!globalThis.confirm('将打开这个话题的当前聊天，不保证是正在回顾的历史实例，也不恢复历史执行状态。不会执行旧命令；来源、设备和版本需重新验证，任何读取或操作需重新授权。继续打开？')) return;
  const { openAgent } = await import('./agentui.js');
  await openAgent(s.topic?.kind || 'free', s.topic?.id || '', { resumeOnly: true });
  toast('已打开；请核对来源并重新授权，不继承旧权限');
}));

// 只删除明确索引的本地数据，绝不把本地删除冒充云端已删除。
export function cleanupSessionLocal(storage, key, at = Date.now()) {
  return withSessionLock(() => cleanupSessionLocalLocked(storage, key, at));
}
async function cleanupSessionLocalLocked(storage, key, at) {
  const sessions = map(await storage.localGet('learningSessions')), s = sessions[key];
  if (!s || s.status === 'deleted') return null;
  const { session, cleanup } = deleteSession(s, at);
  for (const [name, ids] of [['learningSessionAttachments', cleanup.attachmentIds], ['qualityFeedbackOutbox', cleanup.qualityFeedbackIds], ['evaluationSamples', cleanup.evaluationSampleIds]]) {
    const values = { ...map(await storage.localGet(name)) };
    for (const id of list(ids)) delete values[id];
    for (const [id, value] of Object.entries(values)) if (value?.sessionId === s.id) delete values[id];
    await storage.localSet(name, values);
  }
  const personal = { ...map(await storage.localGet('personalSessionFeedback')) }; delete personal[key];
  await storage.localSet('personalSessionFeedback', personal);
  // 先落墓碑，阻止正在完成的日志 hook 重新创建会话。
  await storage.localSet('learningSessions', { ...sessions, [key]: session });
  if (s.topic?.kind) {
    const chatKey = 'chat.' + s.topic.kind + '.' + (s.topic.kind === 'multi' ? hash(String(s.topic.id)) : (s.topic.id || ''));
    const index = { ...map(await storage.localGet('chatIndex')) };
    // 一个话题可以有多个归档实例；未知或已换实例绝不能按 topic 删当前聊天。
    if (index[chatKey]?.logId === s.id) {
      await storage.localSet(chatKey, []);
      delete index[chatKey];
      await storage.localSet('chatIndex', index);
      cleanup.clearedChatSessionId = s.id;
    }
  }
  return cleanup;
}
act('ls-delete', guard(async (el, scope) => {
  if (!globalThis.confirm('删除本地会话、附件和关联索引？已提交到服务的反馈不会因此自动撤回。')) return;
  const sessions = map(await store.localGet('learningSessions')), session = sessions[el.dataset.id], topic = session?.topic;
  if (topic?.kind) {
    const { forgetAgentSession } = await import('./agentui.js');
    const chatKey = 'chat.' + topic.kind + '.' + (topic.kind === 'multi' ? hash(String(topic.id)) : (topic.id || ''));
    const index = map(await store.localGet('chatIndex'));
    // forget 的同步开头再次核验 expectedLogId，先标记 deleted/abort，防止晚返回写入。
    if (index[chatKey]?.logId === session.id) await forgetAgentSession(topic.kind, topic.id || '', session.id);
  }
  await cleanupSessionLocal(store, el.dataset.id);
  scope.assert();
  state.selected = ''; state.feedback = ''; state.preview = null;
  state.notice = '本地记录及关联索引已清理。只清除实例ID明确匹配的当前聊天；未知或其他实例聊天保留。已上报反馈需另向服务申请删除，不能保证供应商立即删除。'; refresh();
}));
act('ls-preview', guard(async (el, scope) => {
  const s = map(await scope.wait(() => store.localGet('learningSessions')))[el.dataset.id]; scope.assert(); if (!s || s.status === 'deleted') return;
  const pick = name => [...document.querySelectorAll(`input[name="${name}"]:checked`)].map(x => Number(x.value));
  const answers = list(s.events).filter(e => e.type === 'answer');
  const feedback = { spec: s.spec, reason: document.querySelector('#ls-reason')?.value || '', note: document.querySelector('#ls-note')?.value || '' };
  const fields = ['reason', 'note'];
  const selectedAnswers = pick('ls-answer'), selectedEvidence = pick('ls-evidence');
  if (selectedAnswers.length) { fields.push('excerpt'); feedback.excerpt = selectedAnswers.map(i => answers[i]?.summary || '').join('\n'); }
  if (selectedEvidence.length) { fields.push('context'); feedback.context = selectedEvidence.map(i => list(s.evidence)[i]?.excerpt || '').join('\n'); }
  if (document.querySelector('#ls-share-title')?.checked) { fields.push('sourceTitles'); feedback.src = [s.source?.title || '']; }
  state.preview = createQualityPreview({ id: `q-${crypto.randomUUID()}`, sessionId: s.id, feedback, fields, at: Date.now() });
  refresh();
}));
act('ls-submit', guard(async (_, scope) => {
  if (!configured || !state.preview || !document.querySelector('#ls-consent')?.checked) { toast('请先配置服务、预览并明确同意'); return; }
  const payload = authorizeQualityFeedback(state.preview, { confirmed: true, previewId: state.preview.id, fields: state.preview.fields });
  state.busy = true;
  try { const client = await scope.wait(() => loadClient()); scope.assert(); const result = await scope.wait(() => client.submitQualityFeedback(payload)); scope.assert(); state.notice = `服务已接收质量反馈：${result?.id || payload.id}。不代表已修改线上 Agent。`; state.preview = null; state.feedback = ''; }
  finally { if (scope.current()) { state.busy = false; refresh(); } }
}));

async function reloadAdmin(scope) {
  const client = await scope.wait(() => loadClient()); scope.assert();
  state.admin = null; state.candidates = []; state.inbox = [];
  const response = await scope.wait(() => client.listReleaseCandidates()); scope.assert();
  const inbox = await scope.wait(() => client.listAdminFeedback()); scope.assert();
  state.inbox = list(inbox?.feedback || inbox);
  // 只有受保护的管理员 RPC 成功后显示管理操作；不提交本地角色声明。
  state.admin = { id: '服务端权限校验已通过' }; state.candidates = list(response?.candidates || response);
}
act('ls-admin', guard(async (_, scope) => { await reloadAdmin(scope); scope.assert(); refresh(); }));
act('ls-submitted', guard(async (_, scope) => {
  const client = await scope.wait(() => loadClient()); scope.assert();
  const response = await scope.wait(() => client.listQualityFeedback()); scope.assert(); state.submitted = list(response?.feedback || response); refresh();
}));
act('ls-submitted-delete', guard(async (el, scope) => {
  if (!globalThis.confirm('向服务申请删除这条已提交反馈及关联评测样本？不回滚已发布版本。')) return;
  const client = await scope.wait(() => loadClient()); scope.assert();
  await scope.wait(() => client.deleteQualityFeedback(el.dataset.id)); scope.assert(); state.submitted = state.submitted.filter(f => f.id !== el.dataset.id);
  state.notice = '服务已响应删除申请；供应商保留期限及已发布版本影响不保证同时消除。'; refresh();
}));
act('ls-candidate-submit', guard(async (_, scope) => {
  if (!state.admin) throw new Error('ADMIN_REQUIRED');
  const value = id => document.getElementById(id)?.value.trim() || '';
  const candidate = createReleaseCandidate({ id: value('ls-candidate-id'), spec: value('ls-candidate-spec'), modelRevision: value('ls-candidate-model'), summary: value('ls-candidate-summary'), at: Date.now() });
  const client = await scope.wait(() => loadClient()); scope.assert();
  await scope.wait(() => client.submitReleaseCandidate(candidate)); await reloadAdmin(scope); scope.assert();
  state.notice = '服务已接收待审候选，不代表评测通过、批准或部署。'; refresh();
}));
act('ls-feedback-review', guard(async (el, scope) => {
  const client = await scope.wait(() => loadClient()); scope.assert();
  await scope.wait(() => client.reviewQualityFeedback(el.dataset.id, 'reviewed')); await reloadAdmin(scope); scope.assert(); refresh();
}));
async function releaseAction(el, action, scope) {
  if (!state.admin) throw new Error('ADMIN_REQUIRED');
  if (!globalThis.confirm(`向服务申请「${action}」？服务将重新校验权限、评测和版本状态；回滚不撤销数据变更。`)) return;
  const options = {};
  if (action === 'canary') {
    const inputs = [...document.querySelectorAll('[data-ls-previous]')], selects = [...document.querySelectorAll('[data-ls-rollout]')];
    options.previousReleaseId = inputs.find(x => x.dataset.lsPrevious === el.dataset.id)?.value || '';
    options.rollout = Number(selects.find(x => x.dataset.lsRollout === el.dataset.id)?.value || 5);
  }
  state.busy = true;
  try { const client = await scope.wait(() => loadClient()); scope.assert(); await scope.wait(() => client.advanceRelease(el.dataset.id, action, { ...options, at: Date.now() })); await reloadAdmin(scope); scope.assert(); state.notice = '请求已由服务响应，请核对最新版本状态。'; }
  finally { if (scope.current()) { state.busy = false; refresh(); } }
}
for (const [name, action] of [['ls-admin-action', 'review'], ['ls-approve', 'approve'], ['ls-canary', 'canary'], ['ls-release', 'release'], ['ls-rollback', 'rollback']]) act(name, guard((el, scope) => releaseAction(el, action, scope)));
