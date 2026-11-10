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

// 图片预算与前端一致；请求体另加 base64 开销，正文仍独立限制为 20 万字符。
export const IMAGE_LIMITS = { perImage: 2 * 1024 * 1024, count: 4, total: 6 * 1024 * 1024 };
export const VISION_BODY_BYTES = 4 * Math.ceil(IMAGE_LIMITS.total / 3) + 200000 * 6 + 65536;
const keysOnly = (o, keys) => o && typeof o === 'object' && !Array.isArray(o) && Object.keys(o).every(k => keys.includes(k));
function imageBytes(url) {
  if (typeof url !== 'string') return 0;
  const m = /^data:image\/(png|jpeg|webp|gif);base64,([A-Za-z0-9+/]+={0,2})$/.exec(url);
  if (!m || m[2].length % 4 || m[2].length > 4 * Math.ceil(IMAGE_LIMITS.perImage / 3)) return 0;
  const bytes = Buffer.from(m[2], 'base64');
  // Buffer 解码本身很宽松；回编码比对同时拒绝错误 padding、非零 pad bits 等非规范形式。
  if (!bytes.length || bytes.length > IMAGE_LIMITS.perImage || bytes.toString('base64') !== m[2]) return 0;
  const starts = hex => bytes.subarray(0, hex.length / 2).equals(Buffer.from(hex, 'hex'));
  const ascii = (a, b) => bytes.toString('latin1', a, b);
  const valid = m[1] === 'png' ? bytes.length >= 24 && starts('89504e470d0a1a0a') && bytes.readUInt32BE(8) === 13 && ascii(12, 16) === 'IHDR' && bytes.readUInt32BE(16) > 0 && bytes.readUInt32BE(20) > 0
    : m[1] === 'jpeg' ? bytes.length >= 4 && starts('ffd8ff') && bytes.subarray(-2).equals(Buffer.from('ffd9', 'hex'))
    : m[1] === 'gif' ? bytes.length >= 13 && ['GIF87a', 'GIF89a'].includes(ascii(0, 6)) && bytes.readUInt16LE(6) > 0 && bytes.readUInt16LE(8) > 0
    : bytes.length >= 20 && ascii(0, 4) === 'RIFF' && bytes.readUInt32LE(4) === bytes.length - 8 && ascii(8, 12) === 'WEBP' && ['VP8 ', 'VP8L', 'VP8X'].includes(ascii(12, 16));
  return valid ? bytes.length : 0;
}
const textLength = m => typeof m.content === 'string' ? m.content.length : m.content.reduce((n, p) => n + (p.type === 'text' ? p.text.length : 0), 0);

// 检查全部内容后才返回；禁止过滤掉不支持的附件后继续回答。visionModels 必须由服务端配置。
export function cleanBody(b, models, { maxChars = 200000, maxTokens = 4000, visionModels = [] } = {}) {
  if (!b || typeof b !== 'object') return { ok: false, status: 400, error: '请求格式不对' };
  const list = Array.isArray(models) ? models : [];
  const model = list.includes(b.model) ? b.model : list[0];
  const vision = Array.isArray(visionModels) && visionModels.includes(model);
  const reject = error => ({ ok: false, status: 400, error });
  const messages = []; let images = 0, bytes = 0;
  for (const m of Array.isArray(b.messages) ? b.messages : []) {
    if (!m) continue;
    if (typeof m.content === 'string') {
      if (['system', 'user', 'assistant'].includes(m.role) && m.content.trim()) messages.push(m);
      continue;
    }
    if (!vision) return reject('平台模型目前仅支持纯文本消息，不支持音频、图片等多模态内容；请改用支持该能力的独立接口或已配置的视觉模型');
    if (m.role !== 'user' || !Array.isArray(m.content) || !m.content.length) return reject('仅支持 user 消息中的 text/image_url 内容数组，不支持音频或其他内容');
    for (const p of m.content) {
      if (p?.type === 'text' && keysOnly(p, ['type', 'text']) && typeof p.text === 'string') continue;
      if (p?.type !== 'image_url' || !keysOnly(p, ['type', 'image_url']) || !keysOnly(p.image_url, ['url', 'detail']) || (p.image_url.detail != null && !['auto', 'low', 'high'].includes(p.image_url.detail)))
        return reject('不支持的内容块：仅允许 text 与内联 image_url，不支持音频或未知字段');
      const size = imageBytes(p.image_url.url);
      if (!size) return reject('图片须为有效的内联 PNG/JPEG/WebP/GIF base64，禁止远程 URL，且每张不得超过 2MiB');
      images++; bytes += size;
      if (images > IMAGE_LIMITS.count || bytes > IMAGE_LIMITS.total) return { ok: false, status: 413, error: '图片最多 4 张，总大小不得超过 6MiB' };
    }
    messages.push({ role: m.role, content: m.content });
  }
  if (!messages.length) return reject('没有消息内容');
  // 只计字符串及 text 块正文，不把 base64、JSON 转义和角色字段算进文字预算。
  if (messages.reduce((n, m) => n + textLength(m), 0) > maxChars) return { ok: false, status: 413, error: '内容太长，请缩短后再试' };
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
export const estimate = (messages, outText) => ({ in: Math.ceil(messages.reduce((a, m) => a + textLength(m), 0) / 1.5), out: Math.ceil(String(outText || '').length / 1.5) });
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
