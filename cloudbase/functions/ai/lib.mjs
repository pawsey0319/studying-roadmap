// 平台模型代理的纯函数（云函数和单元测试共用，不依赖任何 npm 包）
export const FEATS = ['agent', 'digest', 'summary', 'translate', 'tree', 'import', 'onboard', 'test', 'other'];
export const LIGHT = ['summary', 'translate'];   // 自动总结和翻译：单独的每日次数，不占主额度
export const bearer = h => { const m = /^Bearer\s+(\S+)$/i.exec(String(h || '').trim()); return m ? m[1] : ''; };
const int = (v, d) => { const n = parseInt(v, 10); return Number.isFinite(n) && n >= 0 ? n : d; };

// 这个用户的额度：有未过期的订阅记录用订阅额度，否则用免费额度。数值来自云函数环境变量，记录里单独写了的优先
export function limitsFor(ent, env, now = Date.now()) {
  const light = int(env.AI_LIGHT_DAY, 60);
  const sub = !!(ent && ent.plan === 'sub' && (!ent.until || Date.parse(ent.until) > now));
  if (sub) return { plan: 'sub', day: int(ent.day_limit, int(env.AI_SUB_DAY, 200)), month: int(ent.month_limit, int(env.AI_SUB_MONTH, 4000)), light };
  // 免费套餐也支持 ai_entitlements 里单独写上限（邀请制/内测用）；过期订阅记录不再沿用，按免费默认值
  const free = ent && ent.plan === 'free' ? ent : null;
  return { plan: 'free', day: int(free && free.day_limit, int(env.AI_FREE_DAY, 30)), month: int(free && free.month_limit, int(env.AI_FREE_MONTH, 300)), light };
}

// 检查并整理请求体；不合格时返回 { ok:false, status, error }
export function cleanBody(b, models, { maxChars = 200000, maxTokens = 4000 } = {}) {
  if (!b || typeof b !== 'object') return { ok: false, status: 400, error: '请求格式不对' };
  const messages = Array.isArray(b.messages) ? b.messages.filter(m => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string' && m.content.trim()) : [];
  if (!messages.length) return { ok: false, status: 400, error: '没有消息内容' };
  // 按正文总字数算，不把 JSON 转义和角色字段算进 20 万字（读取请求时另有字节上限兜底）
  if (messages.reduce((n, m) => n + m.content.length, 0) > maxChars) return { ok: false, status: 413, error: '内容太长，请缩短后再试' };
  const list = Array.isArray(models) ? models : [];
  const model = list.includes(b.model) ? b.model : list[0];
  const t = Number(b.temperature);
  const cap = Math.max(int(maxTokens, 4000), 1);
  return { ok: true, model, messages, max_tokens: Math.min(Math.max(int(b.max_tokens, 2048), 1), cap),
    temperature: b.temperature != null && Number.isFinite(t) ? Math.min(Math.max(t, 0), 1.5) : 0.4, feat: FEATS.includes(b.feat) ? b.feat : 'other' };
}

// 从流式返回里读出 token 用量和正文（OpenAI 兼容格式 / Anthropic 格式）
function events(text) {
  const out = [];
  for (const line of String(text).split('\n')) {
    const s = line.trim(); if (!s.startsWith('data:')) continue;
    const d = s.slice(5).trim(); if (!d || d === '[DONE]') continue;
    try { const j = JSON.parse(d); if (j && typeof j === 'object') out.push(j); } catch (e) { /* 不完整的一行，跳过 */ }
  }
  return out;
}
export function usageFromSSE(text, fmt = 'openai') {
  let u = { in: 0, out: 0 };
  for (const j of events(text)) {
    if (fmt === 'anthropic') {
      if (j.type === 'message_start' && j.message && j.message.usage) u.in = j.message.usage.input_tokens || u.in;
      if (j.type === 'message_delta' && j.usage) u.out = j.usage.output_tokens || u.out;
    } else if (j.usage) u = { in: j.usage.prompt_tokens || u.in, out: j.usage.completion_tokens || u.out };
  }
  return u;
}
export function textFromSSE(text, fmt = 'openai') {
  let out = '';
  for (const j of events(text)) {
    if (fmt === 'anthropic') { if (j.type === 'content_block_delta' && j.delta && j.delta.text) out += j.delta.text; }
    else { const c = (j.choices || [])[0]; if (c && c.delta && typeof c.delta.content === 'string') out += c.delta.content; }
  }
  return out;
}
// 服务商没返回用量时按字数粗估（中文约 1.5 字 / token），和网页里的估算一致
export const estimate = (messages, outText) => ({ in: Math.ceil(messages.reduce((a, m) => a + m.content.length, 0) / 1.5), out: Math.ceil(String(outText || '').length / 1.5) });
// 成本：价格单位是“元 / 百万 token”，结果单位是“微元”（百万分之一元），存成整数
export const costMicro = (u, pin, pout) => Math.round(u.in * (+pin || 0) + u.out * (+pout || 0));
// 允许的来源：逗号分隔的完整来源（协议 + 域名），不支持通配符
export function allowOrigin(origin, list) { const L = String(list || '').split(',').map(s => s.trim()).filter(Boolean); return origin && L.includes(origin) ? origin : ''; }
// 额度用完时给用户看的话
export function quotaMessage(q, lim, feat) {
  if (LIGHT.includes(feat)) return `今天的自动总结和翻译次数（${lim.light} 次）用完了，明天再来；也可以在设置里换成自己的 Key。`;
  const name = lim.plan === 'sub' ? '订阅额度' : '免费额度';
  return q.day >= lim.day ? `今天的 ${lim.day} 次${name}用完了，明天再来；也可以在设置里换成自己的 Key。` : `本月的 ${lim.month} 次${name}用完了；可以在设置里换成自己的 Key。`;
}
