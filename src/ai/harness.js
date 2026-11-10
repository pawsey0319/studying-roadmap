// 学习 Agent 的 Harness：把“模型”外面那一圈固定下来（规格、上下文、工具、审批、反馈、轨迹）。
// 参考 DeepSeek Harness 的分层：Spec 只由开发者发版，用户只能提供学习者档案和反馈，不能改 Agent 的提示词或工具。
// 这样用户升级的是“我的学习数据”，开发者升级的是“Agent 本身”，两边不会互相覆盖。
import { systemPrompt } from './agent.js';
import * as store from '../store/index.js';
import { uid } from '../core/ids.js';

const SPEC = {
  id: 'learning-agent',
  name: '学习 Agent',
  version: '2026.11.1',
  protocol: 'lh-agent/1',
  // 上下文按这个顺序拼，超长时从后往前裁；用户改不了
  context: ['profile', 'memory', 'recent', 'method', 'digests', 'journal', 'tests', 'current'],
  tools: ['list_tracks', 'get_stage', 'search_news', 'get_notes', 'get_route', 'list_channels', 'search_digests', 'search_public', 'get_public'],
  maxSteps: 6,
  // 只有用户勾选后才生效的修改：跳过、标为已掌握
  approval: ['skip', 'mastered'],
  feedback: ['up', 'down', 'wrong', 'too_generic', 'ignored_my_material', 'bad_plan', 'tone', 'other']
};
for (const k of ['context', 'tools', 'approval', 'feedback']) Object.freeze(SPEC[k]);
export const AGENT_SPEC = Object.freeze(SPEC);

export const specStamp = () => `${AGENT_SPEC.id}@${AGENT_SPEC.version}`;
export const buildSystem = ctx => systemPrompt(ctx);

// 稳定性指纹：反馈和轨迹里带上它，开发者能分清“哪一版提示词/模型”出的问题
export function fingerprint(s) {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return h.toString(16).padStart(8, '0');
}
export const promptStamp = sys => `${specStamp()}#${fingerprint(String(sys || ''))}`;

/* ---------- 轨迹：只存在本设备，供开发者排查；不上传 ---------- */
let Q = Promise.resolve();
export function trace(event, data = {}) {
  const row = { t: Date.now(), event, spec: specStamp(), ...data };
  Q = Q.then(async () => {
    const rows = (await store.localGet('agentTrace')) || [];
    rows.push(row);
    if (rows.length > 240) rows.splice(0, rows.length - 240);
    await store.localSet('agentTrace', rows);
  }).catch(() => {});
  return Q;
}
export async function traceRows() { await Q; return (await store.localGet('agentTrace')) || []; }
export async function clearTrace() { await store.localSet('agentTrace', []); }

/* ---------- 反馈：跟着账号同步，开发者导出后用来改提示词、工具和评测集 ---------- */
export const REASONS = [
  ['wrong', '事实或判断有误'],
  ['too_generic', '太泛，没帮上忙'],
  ['ignored_my_material', '没用到我的资料'],
  ['bad_plan', '路线改得不对'],
  ['tone', '语气或长度不合适'],
  ['other', '其他']
];
export const RATING = { up: '有用', down: '没帮助' };

export function recordFeedback({ rating, reason = '', note = '', message, cur, cfg, src = [], context = '', prompt = '' }) {
  const r = rating === 'up' ? 'up' : 'down';
  const f = {
    rating: r,
    reason: String(reason || '').slice(0, 40),
    note: String(note || '').slice(0, 600),
    at: Date.now(),
    spec: specStamp(),
    prompt: String(prompt || '').slice(0, 80),
    provider: String((cfg && cfg.provider) || '').slice(0, 30),
    model: String((cfg && cfg.model) || '').slice(0, 80),
    kind: String((cur && cur.kind) || '').slice(0, 20),
    title: String((cur && cur.title) || '').slice(0, 80),
    excerpt: String(message || '').replace(/```[\s\S]*?```/g, '').replace(/\s+/g, ' ').trim().slice(0, 500),
    src: (Array.isArray(src) ? src : []).map(x => `${x.t}:${x.title || x.id || ''}`).slice(0, 8),
    context: String(context || '').slice(0, 200)
  };
  const id = 'f' + uid('').slice(0, 12);
  store.put('feedback', id, f);
  return { id, ...f };
}
export const feedbackRows = () => Object.entries(store.all('feedback')).sort((a, b) => b[1].at - a[1].at);
export function feedbackJsonl(rows = feedbackRows()) {
  return rows.map(([, f]) => JSON.stringify({ ...f, spec: typeof f.spec === 'string' && f.spec ? f.spec : 'unknown' })).join('\n') + (rows.length ? '\n' : '');
}
export function feedbackSummary() {
  const rows = feedbackRows().map(([, f]) => f);
  const down = rows.filter(f => f.rating === 'down');
  const by = {};
  for (const f of down) by[f.reason || 'other'] = (by[f.reason || 'other'] || 0) + 1;
  return { total: rows.length, up: rows.length - down.length, down: down.length, by };
}
