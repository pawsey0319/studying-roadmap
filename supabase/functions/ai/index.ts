// 内测用的模型代理：被邀请的用户登录后，用管理员的模型 Key 调用学习 Agent。
// Key 只存在 Supabase 的函数密钥里，不会出现在网页、仓库或用户的浏览器里。
// 部署：Supabase 控制台 → Edge Functions → Deploy a new function → Via Editor，函数名 ai，粘贴本文件，Deploy。
// 部署后在函数的 Details 里关闭 “Verify JWT”（本函数自己校验登录，见下面）。
// 函数密钥（Edge Functions → Secrets）：
//   AI_BASE    聚合接口地址，填到 /v1 为止，例如 https://api.example.com/v1
//   AI_KEY     聚合接口的 Key
//   AI_MODELS  允许用户选的模型，逗号分隔，第一个是默认，例如 deepseek-v4.1-flash,glm-5.3
//   AI_DAILY_LIMIT / AI_MONTHLY_LIMIT  每人每天 / 每月最多调用次数（可选，默认 100 / 1500）
//   AI_FORMAT  可选，聚合接口是 Anthropic 格式时填 anthropic，默认 OpenAI 兼容格式

const env = (k, d = '') => Deno.env.get(k) || d;
const CORS = {
  'access-control-allow-origin': env('AI_ALLOW_ORIGIN', '*'),
  'access-control-allow-headers': 'authorization, apikey, content-type, x-client-info',
  'access-control-allow-methods': 'GET, POST, OPTIONS',
  'access-control-expose-headers': 'x-ai-format',
};
const json = (status, data) => new Response(JSON.stringify(data), { status, headers: { ...CORS, 'content-type': 'application/json' } });
const pick = (k, name) => { try { return JSON.parse(env(k, '{}'))[name || 'default'] || ''; } catch (e) { return ''; } };

const SB_URL = env('SUPABASE_URL');
const PUB = pick('SUPABASE_PUBLISHABLE_KEYS') || env('SUPABASE_ANON_KEY');
const SECRET = pick('SUPABASE_SECRET_KEYS') || env('SUPABASE_SERVICE_ROLE_KEY');
const keyHeaders = k => (k.startsWith('sb_') ? { apikey: k } : { apikey: k, authorization: 'Bearer ' + k });
const MODELS = env('AI_MODELS').split(',').map(s => s.trim()).filter(Boolean);
const DAY = +env('AI_DAILY_LIMIT', '100'), MONTH = +env('AI_MONTHLY_LIMIT', '1500');

async function rpc(name, args) {
  const r = await fetch(`${SB_URL}/rest/v1/rpc/${name}`, { method: 'POST', headers: { ...keyHeaders(SECRET), 'content-type': 'application/json' }, body: JSON.stringify(args) });
  if (!r.ok) throw new Error('用量记录失败：' + (await r.text()).slice(0, 200));
  return r.json();
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response('ok', { headers: CORS });
  if (!env('AI_BASE') || !env('AI_KEY') || !MODELS.length) return json(503, { error: '管理员还没有配置模型（AI_BASE / AI_KEY / AI_MODELS）' });

  // 1. 校验登录：只有被邀请并登录的用户能用
  const token = (req.headers.get('authorization') || '').replace(/^Bearer\s+/i, '');
  if (!token) return json(401, { error: '请先在设置里用邮箱登录' });
  const ur = await fetch(`${SB_URL}/auth/v1/user`, { headers: { apikey: PUB, authorization: 'Bearer ' + token } });
  if (!ur.ok) return json(401, { error: '登录已过期，请重新登录' });
  const user = await ur.json();

  // 2. GET：返回可选模型和本人用量
  if (req.method === 'GET') {
    const u = await rpc('ai_peek', { p_user: user.id });
    return json(200, { models: MODELS, day: u.day, month: u.month, dayLimit: DAY, monthLimit: MONTH });
  }
  if (req.method !== 'POST') return json(405, { error: '只支持 POST' });

  // 3. 检查请求，记一次用量（超限就拒绝）
  let b;
  try { b = await req.json(); } catch (e) { return json(400, { error: '请求格式不对' }); }
  const messages = Array.isArray(b.messages) ? b.messages.filter(m => m && ['system', 'user', 'assistant'].includes(m.role) && typeof m.content === 'string') : [];
  if (!messages.length) return json(400, { error: '没有消息内容' });
  if (JSON.stringify(messages).length > 200000) return json(413, { error: '内容太长，请缩短后再试' });
  const model = MODELS.includes(b.model) ? b.model : MODELS[0];
  const q = await rpc('ai_take', { p_user: user.id, p_day: DAY, p_month: MONTH });
  if (!q.ok) return json(429, { error: q.day >= DAY ? `今天的 ${DAY} 次内测额度用完了，明天再来` : `本月的 ${MONTH} 次内测额度用完了` });

  // 4. 转发给聚合接口，原样流式返回
  const maxTokens = Math.min(+b.max_tokens || 2048, 6000), temperature = Math.min(Math.max(+b.temperature || 0.4, 0), 1.5);
  const base = env('AI_BASE').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  let up;
  if (env('AI_FORMAT') === 'anthropic') {
    const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    up = await fetch(base + '/messages', { method: 'POST', headers: { 'content-type': 'application/json', 'x-api-key': env('AI_KEY'), 'anthropic-version': '2023-06-01' },
      body: JSON.stringify({ model, system: sys, messages: messages.filter(m => m.role !== 'system'), max_tokens: maxTokens, temperature, stream: true }) });
  } else {
    up = await fetch(base + '/chat/completions', { method: 'POST', headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env('AI_KEY') },
      body: JSON.stringify({ model, messages, max_tokens: maxTokens, temperature, stream: true }) });
  }
  if (!up.ok) {
    const t = (await up.text()).slice(0, 300);
    return json(502, { error: `模型服务返回 ${up.status}${up.status === 401 || up.status === 403 ? '（管理员的 Key 失效了）' : up.status === 429 ? '（模型服务限流，稍后再试）' : ''}：${t}` });
  }
  return new Response(up.body, { status: 200, headers: { ...CORS, 'content-type': up.headers.get('content-type') || 'text/event-stream', 'x-ai-format': env('AI_FORMAT') === 'anthropic' ? 'anthropic' : 'openai' } });
});
