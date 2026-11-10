// 平台模型代理（腾讯云开发 HTTP 云函数，Node 20，不依赖任何 npm 包）。部署和环境变量见同目录 README.md。
// 流程：校验登录 → 查额度并记一次 → 转发给模型服务 → 原样流式返回 → 结束后补记 token 用量和成本。
// 模型 Key、数据库服务端 Key、调用口令都只在云函数环境变量里，不进网页、不进仓库。
import http from 'node:http';
import crypto from 'node:crypto';
import { bearer, limitsFor, cleanBody, usageFromSSE, textFromSSE, estimate, costMicro, allowOrigin, quotaMessage } from './lib.mjs';

const env = (k, d = '') => String(process.env[k] ?? d).trim();
const GW = () => `https://${env('CB_ENV')}.api.tcloudbasegateway.com`;
const MODELS = () => env('AI_MODELS').split(',').map(s => s.trim()).filter(Boolean);
const FMT = () => (env('AI_FORMAT') === 'anthropic' ? 'anthropic' : 'openai');
const price = m => { try { const p = JSON.parse(env('AI_PRICES', '{}'))[m]; return Array.isArray(p) ? p : [0, 0]; } catch (e) { return [0, 0]; } };
const sha = s => crypto.createHash('sha256').update(String(s)).digest('hex').slice(0, 16);

// 跨域：AI_ALLOW_ORIGIN 为空时不处理（交给云开发网关的“安全来源”）；填了就只允许列出的来源
function cors(req) {
  const list = env('AI_ALLOW_ORIGIN'), origin = req.headers.origin || '';
  if (!list) return { ok: true, h: {} };
  const o = allowOrigin(origin, list);
  if (origin && !o) return { ok: false, h: {} };
  return { ok: true, h: o ? { 'access-control-allow-origin': o, vary: 'Origin', 'access-control-allow-headers': 'authorization, content-type, x-user-token, x-device-id',
    'access-control-allow-methods': 'GET, POST, OPTIONS', 'access-control-expose-headers': 'x-ai-format, x-ai-plan', 'access-control-max-age': '600' } : {} };
}
function json(res, h, status, data) { res.writeHead(status, { ...h, 'content-type': 'application/json; charset=utf-8', 'cache-control': 'no-store' }); res.end(JSON.stringify(data)); }

// 数据库函数：用服务端 API Key 调 PostgREST 的 /rpc，每次带上调用口令（数据库里核对）
async function rpc(name, args) {
  const r = await fetch(`${GW()}/v1/rdb/rest/rpc/${name}`, { method: 'POST',
    headers: { authorization: 'Bearer ' + env('CB_SERVICE_KEY'), 'content-type': 'application/json' }, body: JSON.stringify({ p_secret: env('AI_DB_SECRET'), ...args }) });
  const t = await r.text();
  if (!r.ok) throw new Error(`数据库返回 ${r.status}：${t.slice(0, 200)}`);
  return t ? JSON.parse(t) : null;
}

// 登录校验：拿用户的 access_token 问云开发“我是谁”；同一个令牌 5 分钟内不重复问
const SEEN = new Map();
async function whoami(token) {
  const k = sha(token), hit = SEEN.get(k);
  if (hit && hit.exp > Date.now()) return hit.u;
  const r = await fetch(`${GW()}/auth/v1/user/me?client_id=${encodeURIComponent(env('CB_ENV'))}`, { headers: { authorization: 'Bearer ' + token } });
  if (!r.ok) return null;
  const j = await r.json().catch(() => ({}));
  const id = String(j.sub || j.user_id || '');
  if (!id) return null;
  const u = { id, real: !!(j.email || j.phone_number) };
  if (SEEN.size > 5000) SEEN.clear();
  SEEN.set(k, { u, exp: Date.now() + 300e3 });
  return u;
}

// 字节上限只防超大请求；真正的 20 万字限制在 cleanBody 里按字符判断（中文一个字 3 字节）
async function readBody(req, max = 1000000) {
  let n = 0; const parts = [];
  for await (const c of req) { n += c.length; if (n > max) throw Object.assign(new Error('内容太长，请缩短后再试'), { status: 413 }); parts.push(c); }
  return Buffer.concat(parts).toString('utf8');
}
const refund = (u, feat) => rpc('ai_record', { p_user: u.id, p_feat: feat, p_in: 0, p_out: 0, p_cost: 0, p_refund: true }).catch(() => {});

export async function handle(req, res) {
  const c = cors(req), h = c.h;
  if (!c.ok) return json(res, {}, 403, { error: '这个来源不允许调用' });
  if (req.method === 'OPTIONS') { res.writeHead(204, h); res.end(); return; }
  if (!env('CB_ENV') || !env('CB_SERVICE_KEY') || !env('AI_DB_SECRET') || !env('AI_BASE') || !env('AI_KEY') || !MODELS().length)
    return json(res, h, 503, { error: '平台模型还没有配置好，请先在设置里换成自己的服务商' });
  const token = String(req.headers['x-user-token'] || '') || bearer(req.headers.authorization);
  if (!token) return json(res, h, 401, { error: '平台模型需要先登录：设置 → 账号与云端同步' });
  const u = await whoami(token).catch(() => null);
  if (!u) return json(res, h, 401, { error: '登录已过期，请重新登录' });
  if (!u.real) return json(res, h, 403, { error: '请先用邮箱登录，再使用平台模型' });

  const ent = await rpc('ai_plan', { p_user: u.id }).catch(() => null);
  if (env('AI_INVITE_ONLY') === '1' && !ent) return json(res, h, 403, { error: '平台模型目前只对受邀用户开放，可以先在设置里换成自己的 Key' });
  const lim = limitsFor(ent, process.env);
  if (req.method === 'GET') {
    const p = await rpc('ai_peek', { p_user: u.id });
    return json(res, h, 200, { models: MODELS(), plan: lim.plan, day: p.day, month: p.month, light: p.light, dayLimit: lim.day, monthLimit: lim.month, lightLimit: lim.light });
  }
  if (req.method !== 'POST') return json(res, h, 405, { error: '只支持 GET 和 POST' });

  let b;
  try { b = cleanBody(JSON.parse(await readBody(req)), MODELS(), { maxTokens: +env('AI_MAX_TOKENS', '4000') || 4000 }); }
  catch (e) { return json(res, h, e.status || 400, { error: e.status ? e.message : '请求格式不对' }); }
  if (!b.ok) return json(res, h, b.status, { error: b.error });

  const q = await rpc('ai_take', { p_user: u.id, p_feat: b.feat, p_day: lim.day, p_month: lim.month, p_light: lim.light });
  if (!q.ok) return json(res, h, 429, { error: quotaMessage(q, lim, b.feat) });

  const fmt = FMT(), base = env('AI_BASE').replace(/\/+$/, '').replace(/\/chat\/completions$/, '');
  const ctl = new AbortController(), t0 = Date.now();
  // 客户端在流式返回中途断开时（res 还没有写完）才中止上游；req 的 close 在请求体读完时就会触发，不能用
  res.on('close', () => { if (!res.writableEnded) ctl.abort(); });
  let up;
  try {
    if (fmt === 'anthropic') {
      const sys = b.messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
      // Anthropic 的 temperature 只接受 0–1，cleanBody 按 OpenAI 的 0–1.5 夹取后这里再收一次
      const temperature = Math.min(b.temperature, 1);
      up = await fetch(base + '/messages', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', 'x-api-key': env('AI_KEY'), 'anthropic-version': '2023-06-01' },
        body: JSON.stringify({ model: b.model, ...(sys ? { system: sys } : {}), messages: b.messages.filter(m => m.role !== 'system'), max_tokens: b.max_tokens, temperature, stream: true }) });
    } else {
      up = await fetch(base + '/chat/completions', { method: 'POST', signal: ctl.signal, headers: { 'content-type': 'application/json', authorization: 'Bearer ' + env('AI_KEY') },
        body: JSON.stringify({ model: b.model, messages: b.messages, max_tokens: b.max_tokens, temperature: b.temperature, stream: true, ...(env('AI_USAGE_OPT', '1') === '1' ? { stream_options: { include_usage: true } } : {}) }) });
    }
  } catch (e) { await refund(u, b.feat); return json(res, h, 502, { error: '连不上模型服务，稍后再试' }); }
  if (!up.ok) {
    const t = (await up.text().catch(() => '')).slice(0, 300);
    await refund(u, b.feat);
    console.log(JSON.stringify({ u: sha(u.id), feat: b.feat, model: b.model, status: up.status }));
    return json(res, h, 502, { error: `模型服务返回 ${up.status}${up.status === 429 ? '（模型服务限流，稍后再试）' : ''}：${t}` });
  }
  res.writeHead(200, { ...h, 'content-type': up.headers.get('content-type') || 'text/event-stream; charset=utf-8', 'cache-control': 'no-cache', 'x-ai-format': fmt, 'x-ai-plan': lim.plan });
  const dec = new TextDecoder(); let acc = '';
  try {
    const rd = up.body.getReader();
    for (;;) { const { value, done } = await rd.read(); if (done) break; res.write(value); if (acc.length < 2e6) acc += dec.decode(value, { stream: true }); }
  } catch (e) { /* 用户中途停止或网络断开：按已经收到的部分记账 */ }
  if (acc.length < 2e6) acc += dec.decode();   // 冲掉最后一个多字节字符
  res.end();
  let us = usageFromSSE(acc, fmt);
  if (!us.in && !us.out) us = estimate(b.messages, textFromSSE(acc, fmt));
  const [pi, po] = price(b.model);
  await rpc('ai_record', { p_user: u.id, p_feat: b.feat, p_in: us.in, p_out: us.out, p_cost: costMicro(us, pi, po), p_refund: false }).catch(e => console.log('记账失败', e.message));
  // 日志只记匿名编号、功能、用量和耗时，不记消息内容
  console.log(JSON.stringify({ u: sha(u.id), feat: b.feat, model: b.model, in: us.in, out: us.out, ms: Date.now() - t0, status: 200 }));
}

if (process.env.LH_NO_LISTEN !== '1') {
  http.createServer((req, res) => handle(req, res).catch(e => { try { json(res, cors(req).h, 500, { error: '服务出错：' + e.message }); } catch (x) { /* 已经开始返回，忽略 */ } }))
    .listen(+env('PORT', '9000'));
}
