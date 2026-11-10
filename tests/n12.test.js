// 第一版：平台模型代理（cloudbase/functions/ai）。纯函数 + 用本地假服务把整个流程跑一遍
import test from 'node:test';
import assert from 'node:assert/strict';
import http from 'node:http';
import * as L from '../cloudbase/functions/ai/lib.mjs';

test('代理纯函数：令牌、额度、请求清洗、用量解析、成本、来源', () => {
  assert.equal(L.bearer('Bearer abc.def'), 'abc.def'); assert.equal(L.bearer('Basic x'), ''); assert.equal(L.bearer(null), '');
  assert.deepEqual(L.limitsFor(null, {}), { plan: 'free', day: 30, month: 300, light: 60 });
  assert.deepEqual(L.limitsFor(null, { AI_FREE_DAY: '5', AI_FREE_MONTH: 'abc' }), { plan: 'free', day: 5, month: 300, light: 60 });
  assert.equal(L.limitsFor({ plan: 'sub', until: '2000-01-01T00:00:00Z' }, {}).plan, 'free', '订阅过期按免费');
  assert.deepEqual(L.limitsFor({ plan: 'sub', day_limit: 50 }, {}), { plan: 'sub', day: 50, month: 4000, light: 60 });
  assert.equal(L.cleanBody(null, ['m']).status, 400);
  assert.equal(L.cleanBody({ messages: [] }, ['m']).status, 400);
  assert.equal(L.cleanBody({ messages: [{ role: 'user', content: 'x'.repeat(200001) }] }, ['m']).status, 413);
  const c = L.cleanBody({ model: 'zz', messages: [{ role: 'user', content: 'hi' }, { role: 'tool', content: 'x' }], max_tokens: 99999, temperature: 9, feat: 'agent' }, ['m1', 'm2']);
  assert.equal(c.model, 'm1'); assert.equal(c.messages.length, 1); assert.equal(c.max_tokens, 4000); assert.equal(c.temperature, 1.5); assert.equal(c.feat, 'agent');
  assert.equal(L.cleanBody({ messages: [{ role: 'user', content: 'a' }], feat: 'hack' }, ['m']).feat, 'other');
  assert.equal(L.cleanBody({ messages: [{ role: 'user', content: 'a' }], temperature: 0 }, ['m']).temperature, 0);
  const sse = 'data: {"choices":[{"delta":{"content":"你"}}]}\n\ndata: {"choices":[],"usage":{"prompt_tokens":12,"completion_tokens":3}}\n\ndata: [DONE]\n';
  assert.deepEqual(L.usageFromSSE(sse), { in: 12, out: 3 }); assert.equal(L.textFromSSE(sse), '你');
  const an = 'data: {"type":"message_start","message":{"usage":{"input_tokens":7}}}\ndata: {"type":"content_block_delta","delta":{"text":"ok"}}\ndata: {"type":"message_delta","usage":{"output_tokens":2}}\n';
  assert.deepEqual(L.usageFromSSE(an, 'anthropic'), { in: 7, out: 2 }); assert.equal(L.textFromSSE(an, 'anthropic'), 'ok');
  assert.deepEqual(L.estimate([{ content: 'abc' }], 'abcdef'), { in: 2, out: 4 });
  assert.equal(L.costMicro({ in: 1000, out: 500 }, 1, 2), 2000);
  assert.equal(L.allowOrigin('https://a.com', 'https://a.com, https://localhost'), 'https://a.com'); assert.equal(L.allowOrigin('https://b.com', 'https://a.com'), '');
  assert.match(L.quotaMessage({ day: 30 }, { plan: 'free', day: 30, month: 300, light: 60 }, 'agent'), /今天的 30 次免费额度用完了/);
  assert.match(L.quotaMessage({ day: 1 }, { plan: 'sub', day: 30, month: 300, light: 60 }, 'agent'), /本月的 300 次订阅额度/);
  assert.match(L.quotaMessage({}, { plan: 'free', day: 30, month: 300, light: 60 }, 'summary'), /自动总结和翻译/);
});

const unsupportedContents = [
  [{ type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } }],
  [{ type: 'text', text: '描述图片' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,AAAA' } }],
  [{ type: 'image', source: { type: 'base64', media_type: 'image/png', data: 'AAAA' } }],
  [{ type: 'text', text: '即使全是文本块也不支持数组格式' }],
  { type: 'input_audio', data: 'AAAA' },
];

test('平台未配置视觉时只收纯文本：不能静默丢弃音频、图片或内容块', () => {
  for (const content of unsupportedContents) {
    for (const role of ['user', 'assistant', 'tool']) {
      const result = L.cleanBody({ messages: [{ role: 'system', content: '请回答用户' }, { role, content }] }, ['m']);
      assert.equal(result.ok, false);
      assert.equal(result.status, 400);
      assert.match(result.error, /仅支持纯文本.*不支持音频、图片/);
      assert.equal(result.messages, undefined, '拒绝整个请求，不返回被裁剪的消息');
    }
  }
  const messages = [{ role: 'system', content: '请回答用户' }, { role: 'user', content: '你好' }, { role: 'assistant', content: '你好！' }];
  const result = L.cleanBody({ messages }, ['m']);
  assert.equal(result.ok, true);
  assert.deepEqual(result.messages, messages);
});

// 真实 1px PNG；大预算样例仅测试签名/头部校验，不冒充完整图像解码或模型质量验证。
const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jRZkAAAAASUVORK5CYII=', 'base64');
const image = (bytes = png, mime = 'png') => ({ type: 'image_url', image_url: { url: `data:image/${mime};base64,${bytes.toString('base64')}`, detail: 'auto' } });
const paddedPng = size => { const bytes = Buffer.alloc(size); png.copy(bytes); return bytes; };
const visualBody = content => ({ model: 'm2', messages: [{ role: 'system', content: '系统' }, { role: 'user', content }] });
const visionOptions = { visionModels: ['m2'] };

test('视觉清洗：显式名单、完整内容、严格base64/魔数、角色与文字/媒体预算', () => {
  const body = visualBody([{ type: 'text', text: '描述' }, image()]);
  const cleaned = L.cleanBody(body, ['m1', 'm2'], visionOptions);
  assert.equal(cleaned.ok, true); assert.deepEqual(cleaned.messages, body.messages);
  assert.equal(L.cleanBody(body, ['m1', 'm2']).ok, false);
  assert.equal(L.cleanBody({ ...body, model: 'm1' }, ['m1', 'm2'], visionOptions).ok, false);
  assert.equal(L.cleanBody({ ...body, model: 'unknown' }, ['m1', 'm2'], visionOptions).ok, false);
  assert.equal(L.cleanBody(visualBody([{ type: 'text', text: 'ab' }, image()]), ['m2'], { ...visionOptions, maxChars: 4 }).ok, true);
  assert.equal(L.cleanBody(visualBody([{ type: 'text', text: 'abc' }, image()]), ['m2'], { ...visionOptions, maxChars: 4 }).status, 413);
  assert.deepEqual(L.estimate(cleaned.messages, 'abc'), { in: 3, out: 2 }, '估算只包含正文，不把base64当文字token');
  const badBlocks = [
    { type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } },
    { type: 'mystery' }, { type: 'text', text: 123 }, { type: 'text', text: 'x', audio: 'hidden' },
    { type: 'image_url', image_url: { url: 'https://example.com/a.png' } },
    { type: 'image_url', image_url: { url: image().image_url.url, detail: 'unknown' } },
    image(Buffer.from('not an image')), image(png, 'jpeg'),
    ...['AAAA', png.toString('base64').replace(/=$/, ''), png.toString('base64') + '\n', '/x=='].map(data => ({ type: 'image_url', image_url: { url: 'data:image/png;base64,' + data } })),
  ];
  for (const block of badBlocks) assert.equal(L.cleanBody(visualBody([{ type: 'text', text: '不要丢附件' }, block]), ['m2'], visionOptions).ok, false, JSON.stringify(block));
  for (const role of ['system', 'assistant', 'tool']) assert.equal(L.cleanBody({ model: 'm2', messages: [{ role, content: [image()] }] }, ['m2'], visionOptions).ok, false);
  assert.equal(L.cleanBody(visualBody([image(paddedPng(2 * 1024 * 1024))]), ['m2'], visionOptions).ok, true);
  assert.equal(L.cleanBody(visualBody([image(paddedPng(2 * 1024 * 1024 + 1))]), ['m2'], visionOptions).ok, false);
  const large = image(paddedPng(2 * 1024 * 1024));
  assert.equal(L.cleanBody(visualBody([large, large, large]), ['m2'], visionOptions).ok, true);
  assert.equal(L.cleanBody(visualBody([large, large, large, image()]), ['m2'], visionOptions).status, 413);
  assert.equal(L.cleanBody(visualBody(Array(4).fill(image())), ['m2'], visionOptions).ok, true);
  assert.equal(L.cleanBody(visualBody(Array(5).fill(image())), ['m2'], visionOptions).status, 413);
  assert.equal(L.cleanBody({ model: 'm2', messages: [{ role: 'user', content: [large, large] }, { role: 'user', content: [large, image()] }] }, ['m2'], visionOptions).status, 413, '预算跨消息累计');
  const gif = Buffer.from('R0lGODlhAQABAIAAAAAAAP///ywAAAAAAQABAAACAUwAOw==', 'base64');
  const jpeg = Buffer.from('ffd8ffe00002ffd9', 'hex');
  const webp = Buffer.alloc(20); webp.write('RIFF'); webp.writeUInt32LE(12, 4); webp.write('WEBPVP8L', 8);
  for (const [mime, bytes] of [['gif', gif], ['jpeg', jpeg], ['webp', webp]]) assert.equal(L.cleanBody(visualBody([image(bytes, mime)]), ['m2'], visionOptions).ok, true, mime);
});

// 假的云开发网关（登录 + 数据库函数）和假的模型服务
const calls = [];
let FULL = false, UPFAIL = false;
const listen = srv => new Promise(r => srv.listen(0, '127.0.0.1', () => r(srv.address().port)));
const mock = http.createServer(async (req, res) => {
  let b = ''; for await (const c of req) b += c;
  calls.push({ url: req.url, auth: req.headers.authorization, body: b });
  if (req.url.startsWith('/auth/v1/user/me')) {
    if (req.headers.authorization === 'Bearer good') return res.end(JSON.stringify({ sub: 'u1', email: 'a@b.c' }));
    if (req.headers.authorization === 'Bearer anon') return res.end(JSON.stringify({ sub: 'u2' }));
    res.writeHead(401); return res.end('{}');
  }
  const rpc = { '/v1/rdb/rest/rpc/ai_plan': 'null', '/v1/rdb/rest/rpc/ai_peek': '{"day":3,"month":9,"light":1}', '/v1/rdb/rest/rpc/ai_record': 'null' };
  if (req.url === '/v1/rdb/rest/rpc/ai_take') return res.end(JSON.stringify(FULL ? { ok: false, day: 30, month: 30, light: 0 } : { ok: true, day: 1, month: 1, light: 0 }));
  if (rpc[req.url]) return res.end(rpc[req.url]);
  if (req.url === '/v1/messages') {
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    return res.end('data: {"type":"content_block_delta","delta":{"text":"兼容文本"}}\n\ndata: {"type":"message_delta","usage":{"output_tokens":2}}\n\n');
  }
  if (req.url === '/v1/chat/completions') {
    if (UPFAIL) { res.writeHead(500); return res.end('boom'); }
    res.writeHead(200, { 'content-type': 'text/event-stream' });
    res.write('data: {"choices":[{"delta":{"content":"你好"}}]}\n\n');
    return res.end('data: {"choices":[],"usage":{"prompt_tokens":100,"completion_tokens":20}}\n\ndata: [DONE]\n\n');
  }
  res.writeHead(404); res.end();
});

test('代理流程：登录、额度、转发、记账、退回、跨域', async () => {
  const MP = await listen(mock);
  const real = globalThis.fetch;
  globalThis.fetch = (u, o) => real(String(u).replace(/^https:\/\/envx\.api\.tcloudbasegateway\.com/, `http://127.0.0.1:${MP}`).replace(/^https:\/\/up\.example\/v1/, `http://127.0.0.1:${MP}/v1`), o);
  Object.assign(process.env, { LH_NO_LISTEN: '1', CB_ENV: 'envx', CB_SERVICE_KEY: 'svc', AI_DB_SECRET: 's'.repeat(32), AI_BASE: 'https://up.example/v1', AI_KEY: 'k', AI_MODELS: 'm1,m2', AI_VISION_MODELS: '', AI_FORMAT: 'openai', AI_PRICES: '{"m1":[1,2]}', AI_ALLOW_ORIGIN: 'https://ok.app' });
  const { handle } = await import('../cloudbase/functions/ai/index.mjs');
  const srv = http.createServer((q, s) => handle(q, s)); const FP = await listen(srv);
  const F = (path, o = {}) => real(`http://127.0.0.1:${FP}${path}`, o);
  try {
    let r = await F('/', { method: 'OPTIONS', headers: { origin: 'https://ok.app' } }); assert.equal(r.status, 204); assert.equal(r.headers.get('access-control-allow-origin'), 'https://ok.app');
    r = await F('/', { headers: { origin: 'https://evil.app' } }); assert.equal(r.status, 403, '不在名单里的来源');
    r = await F('/'); assert.equal(r.status, 401, '没有令牌');
    r = await F('/', { headers: { authorization: 'Bearer bad' } }); assert.equal(r.status, 401, '令牌无效');
    r = await F('/', { headers: { 'x-user-token': 'anon' } }); assert.equal(r.status, 403, '匿名账号不能用');
    r = await F('/', { headers: { 'x-user-token': 'good' } });
    assert.deepEqual(await r.json(), { models: ['m1', 'm2'], visionModels: [], plan: 'free', day: 3, month: 9, light: 1, dayLimit: 30, monthLimit: 300, lightLimit: 60 });
    r = await F('/', { method: 'POST', headers: { 'x-user-token': 'good' }, body: '{bad' }); assert.equal(r.status, 400);
    const takeBefore = calls.filter(c => c.url.endsWith('/ai_take')).length;
    const upstreamBefore = calls.filter(c => c.url === '/v1/chat/completions').length;
    for (const content of unsupportedContents) {
      r = await F('/', { method: 'POST', headers: { 'x-user-token': 'good' }, body: JSON.stringify({ messages: [{ role: 'user', content: '前面有正常文本' }, { role: 'user', content }] }) });
      assert.equal(r.status, 400, '多模态请求不能丢弃附件后继续响应');
      assert.match((await r.json()).error, /仅支持纯文本.*不支持音频、图片/);
    }
    assert.equal(calls.filter(c => c.url.endsWith('/ai_take')).length, takeBefore, '拒绝请求不扣次数');
    assert.equal(calls.filter(c => c.url === '/v1/chat/completions').length, upstreamBefore, '拒绝请求不转发模型');
    r = await F('/', { method: 'POST', headers: { 'x-user-token': 'good' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }], feat: 'agent' }) });
    assert.equal(r.status, 200); assert.equal(r.headers.get('x-ai-format'), 'openai'); assert.match(await r.text(), /你好/);
    await new Promise(r => setTimeout(r, 50));
    const rec = calls.filter(c => c.url.endsWith('/ai_record')).pop();
    assert.deepEqual(JSON.parse(rec.body), { p_secret: 's'.repeat(32), p_user: 'u1', p_feat: 'agent', p_in: 100, p_out: 20, p_cost: 140, p_refund: false });
    const up = calls.filter(c => c.url === '/v1/chat/completions').pop();
    assert.equal(JSON.parse(up.body).model, 'm1'); assert.equal(up.auth, 'Bearer k', '模型 Key 只在云函数里');
    assert.equal(calls.filter(c => c.url.endsWith('/ai_take')).pop().auth, 'Bearer svc');
    process.env.AI_VISION_MODELS = ' m2,unavailable,m2 ';
    r = await F('/', { headers: { 'x-user-token': 'good' } });
    assert.deepEqual((await r.json()).visionModels, ['m2'], 'GET主入口只声明实际可选的视觉模型');
    const body = visualBody([{ type: 'text', text: '描述这个完整图片' }, image()]);
    for (const outgoing of [body, visualBody([{ type: 'text', text: '大请求预算验证' }, image(paddedPng(1024 * 1024))])]) {
      r = await F('/', { method: 'POST', headers: { 'x-user-token': 'good' }, body: JSON.stringify(outgoing) });
      assert.equal(r.status, 200, '真实1px图片与超过旧1MB的预算样例都可发送'); await r.text();
      assert.deepEqual(JSON.parse(calls.filter(c => c.url === '/v1/chat/completions').pop().body).messages, outgoing.messages, '假上游完整收到图片，不裁剪base64或text');
    }
    const takes = calls.filter(c => c.url.endsWith('/ai_take')).length;
    const ups = calls.filter(c => c.url === '/v1/chat/completions').length;
    const invalid = [
      { ...body, model: 'm1' },
      visualBody([{ type: 'image_url', image_url: { url: 'https://example.com/image.png' } }]),
      visualBody([{ type: 'input_audio', input_audio: { data: 'AAAA', format: 'wav' } }]),
      visualBody([{ type: 'unknown' }]),
      { model: 'm2', messages: [{ role: 'assistant', content: [image()] }] },
      visualBody([image(Buffer.from('bad magic'))]),
      visualBody(Array(5).fill(image())),
      visualBody([{ type: 'text', text: 'x'.repeat(200001) }, image()]),
      { messages: [{ role: 'user', content: 'x'.repeat(200001) }] },
      visualBody([image(paddedPng(2 * 1024 * 1024 + 1))]),
      visualBody(Array(4).fill(image(paddedPng(2 * 1024 * 1024)))),
    ];
    for (const b of invalid) {
      r = await F('/', { method: 'POST', headers: { 'x-user-token': 'good' }, body: JSON.stringify(b) });
      assert.ok([400, 413].includes(r.status)); await r.text();
    }
    process.env.AI_FORMAT = 'anthropic';
    r = await F('/', { headers: { 'x-user-token': 'good' } }); assert.deepEqual((await r.json()).visionModels, []);
    r = await F('/', { method: 'POST', headers: { 'x-user-token': 'good' }, body: JSON.stringify(visualBody([image()])) });
    assert.equal(r.status, 400); await r.text();
    assert.equal(calls.filter(c => c.url.endsWith('/ai_take')).length, takes, '所有拒绝都在扣额前');
    assert.equal(calls.filter(c => c.url === '/v1/chat/completions').length, ups, '所有拒绝都不转发');
    r = await F('/', { method: 'POST', headers: { 'x-user-token': 'good' }, body: JSON.stringify({ model: 'm2', messages: [{ role: 'system', content: '保持兼容' }, { role: 'user', content: '你好' }] }) });
    assert.equal(r.status, 200); assert.match(await r.text(), /兼容文本/);
    const anthropic = JSON.parse(calls.filter(c => c.url === '/v1/messages').pop().body);
    assert.equal(anthropic.system, '保持兼容'); assert.deepEqual(anthropic.messages, [{ role: 'user', content: '你好' }]);
    process.env.AI_FORMAT = 'openai';
    process.env.AI_INVITE_ONLY = '1';
    r = await F('/', { headers: { 'x-user-token': 'good' } }); assert.equal(r.status, 403, '邀请制下没有记录的人不能用');
    process.env.AI_INVITE_ONLY = '';
    FULL = true;
    r = await F('/', { method: 'POST', headers: { 'x-user-token': 'good' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    assert.equal(r.status, 429); assert.match((await r.json()).error, /免费额度用完了/);
    FULL = false; UPFAIL = true;
    r = await F('/', { method: 'POST', headers: { 'x-user-token': 'good' }, body: JSON.stringify({ messages: [{ role: 'user', content: 'hi' }] }) });
    assert.equal(r.status, 502);
    assert.equal(JSON.parse(calls.filter(c => c.url.endsWith('/ai_record')).pop().body).p_refund, true, '上游失败时退回这一次');
    assert.equal(calls.filter(c => c.url.startsWith('/auth/v1/user/me') && c.auth === 'Bearer good').length, 1, '令牌校验结果缓存 5 分钟');
  } finally { globalThis.fetch = real; srv.close(); mock.close(); }
});

import { makeBackend } from '../src/store/backend.js';
test('注销账号：先发验证码，再带验证码删除', async () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const seen = [], real = globalThis.fetch;
  globalThis.fetch = async (u, o) => { seen.push({ u: String(u), m: o.method, a: o.headers.authorization, b: o.body }); return new Response('{}', { status: 200 }); };
  try {
    const cb = makeBackend({ backend: 'cloudbase', cloudbaseEnv: 'env-1', cloudbaseKey: 'k' });
    await cb.reauth('tok'); await cb.deleteMe('tok', ' 123456 ');
    assert.match(seen[0].u, /\/auth\/v1\/user\/reauthenticate\?client_id=env-1$/); assert.equal(seen[0].m, 'POST'); assert.equal(JSON.parse(seen[0].b).verify_opt, 'email_code'); assert.equal(seen[0].a, 'Bearer tok');
    assert.match(seen[1].u, /\/auth\/v1\/user\/me\?verify_code=123456&client_id=env-1$/); assert.equal(seen[1].m, 'DELETE');
    assert.ok(!makeBackend({ supabaseUrl: 'https://x.supabase.co', supabaseAnonKey: 'sb_publishable_x' }).reauth, 'Supabase 备用后端不提供注销');
  } finally { globalThis.fetch = real; }
});

test('平台模型地址：配了 aiFunction 才提供；aiUrl 只接受 https', async () => {
  const k = 'learning-hub.cloud', mem = { [k]: JSON.stringify({ kind: 'cloudbase', access: 'a', refresh: 'r', exp: Date.now() + 3600e3, uid: 'u1' }) };
  globalThis.localStorage = { getItem: x => mem[x] ?? null, setItem: (x, v) => { mem[x] = v; } };
  const cloud = await import('../src/store/cloud.js?t=ai');   // 模块加载时读登录信息，所以在设好 localStorage 之后再加载
  cloud.setup({ backend: 'cloudbase', cloudbaseEnv: 'env-1', cloudbaseKey: 'k' });
  assert.equal(cloud.hostedAI(), false);
  cloud.setup({ backend: 'cloudbase', cloudbaseEnv: 'env-1', cloudbaseKey: 'k', aiFunction: 'lh-ai' });
  assert.equal(cloud.hostedAI(), true);
  return cloud.aiEndpoint().then(ep => {
    assert.equal(ep.url, 'https://env-1.api.tcloudbasegateway.com/v1/functions/lh-ai?webfn=true');
    assert.equal(ep.headers['x-user-token'], 'a');
    cloud.setup({ backend: 'cloudbase', cloudbaseEnv: 'env-1', cloudbaseKey: 'k', aiFunction: 'lh-ai', aiUrl: 'http://x.com/ai' });
    return cloud.aiEndpoint();
  }).then(ep => {
    assert.match(ep.url, /tcloudbasegateway/, 'http 地址不接受');
    cloud.setup({ backend: 'cloudbase', cloudbaseEnv: 'env-1', cloudbaseKey: 'k', aiFunction: 'lh-ai', aiUrl: 'https://ai.example.com/lh-ai' });
    return cloud.aiEndpoint();
  }).then(async ep => {
    assert.equal(ep.url, 'https://ai.example.com/lh-ai');
    const { readFile } = await import('node:fs/promises');
    const config = JSON.parse(await readFile(new URL('../config.json', import.meta.url), 'utf8'));
    cloud.setup(config);
    assert.equal(cloud.hostedAI(), true, '实际部署配置启用平台模型');
    assert.equal(config.aiFunction, 'lh-ai');
    const actual = await cloud.aiEndpoint();
    assert.equal(actual.url, 'https://studyingloop-d4gve2bc779a7d0ea-1396624416.ap-shanghai.app.tcloudbase.com/lh-ai');
    assert.equal(actual.headers['x-user-token'], 'a');
  });
});
