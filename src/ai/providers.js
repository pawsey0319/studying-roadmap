// 模型服务商：两套接口格式覆盖全部（OpenAI 兼容 / Anthropic），都用流式输出。
// Key 只存在本设备（store.localSet），只发给你选的服务商。
export const PROVIDERS = {
  hosted: { name: '平台模型（登录后可用，有免费额度）', base: '', model: '', fmt: 'openai', price: [0, 0], models: [], hosted: true,
    help: '由本站提供模型，不用自己注册 Key。需要先在下面“账号与云端同步”里用邮箱登录；每人每天和每月有免费次数，用完后可以换成自己的 Key。' },
  modelscope: { name: '魔搭 ModelScope（免费）', base: 'https://api-inference.modelscope.cn/v1', model: 'deepseek-ai/DeepSeek-V4.1-Flash', fmt: 'openai', price: [0, 0],
    models: ['deepseek-ai/DeepSeek-V4.1-Flash', 'ZhipuAI/GLM-5.3', 'deepseek-ai/DeepSeek-V4-Flash-0731', 'MiniMax/MiniMax-M2.7'],
    help: '在 modelscope.cn 注册并绑定阿里云账号后，在“访问令牌”里创建，免费每天 2000 次。' },
  siliconflow: { name: '硅基流动（有免费模型）', base: 'https://api.siliconflow.cn/v1', model: 'Qwen/Qwen3-8B', fmt: 'openai', price: [0, 0],
    models: ['Qwen/Qwen3-8B', 'THUDM/GLM-4-9B-0414', 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B'],
    help: '在 siliconflow.cn 注册后在“API 密钥”里创建；列出的几个小模型免费，其他模型按量计费。' },
  deepseek: { name: 'DeepSeek 官方', base: 'https://api.deepseek.com', model: 'deepseek-chat', fmt: 'openai', price: [0.3, 1.2], models: ['deepseek-chat', 'deepseek-reasoner'], help: '在 platform.deepseek.com 充值后创建 API Key。' },
  dashscope: { name: '通义千问（阿里云百炼）', base: 'https://dashscope.aliyuncs.com/compatible-mode/v1', model: 'qwen-plus', fmt: 'openai', price: [0.11, 0.28], models: ['qwen-plus', 'qwen-turbo', 'qwen-max'], help: '在阿里云百炼控制台开通后创建 API Key，新用户有免费额度。' },
  moonshot: { name: 'Kimi（月之暗面）', base: 'https://api.moonshot.cn/v1', model: 'kimi-latest', fmt: 'openai', price: [0.6, 2.5], models: ['kimi-latest'], help: '在 platform.moonshot.cn 创建。' },
  openrouter: { name: 'OpenRouter（需海外网络）', base: 'https://openrouter.ai/api/v1', model: 'deepseek/deepseek-v4.1-flash', fmt: 'openai', price: [0.05, 0.2], models: ['deepseek/deepseek-v4.1-flash', 'anthropic/claude-sonnet-5.5', 'openai/gpt-6.1-sol', 'google/gemini-3.8-flash', 'openrouter/free'], help: '一个 Key 用多家模型。' },
  openai: { name: 'OpenAI（需海外网络）', base: 'https://api.openai.com/v1', model: 'gpt-6-luna', fmt: 'openai', price: [0.1, 0.5], models: ['gpt-6-luna', 'gpt-6.1-sol'], help: '' },
  anthropic: { name: 'Anthropic Claude（需海外网络）', base: 'https://api.anthropic.com/v1', model: 'claude-haiku-5.5', fmt: 'anthropic', price: [0.1, 0.5], models: ['claude-haiku-5.5', 'claude-sonnet-5.5'], help: '' },
  custom: { name: '自定义（OpenAI 兼容接口）', base: '', model: '', fmt: 'openai', price: [0, 0], models: [], help: '填任何兼容 OpenAI Chat Completions 的地址，例如本地的 Ollama：http://localhost:11434/v1' }
};
export const USD_CNY = 7.2;

// cfg：{ provider, base, model, key, price:[输入, 输出 美元/百万 token] }
// messages：[{role:'system'|'user'|'assistant', content}]
// onDelta(文本片段)；返回 { text, usage:{in,out}, estimated }
import { replyRule } from '../i18n.js';
// 图片输入：OpenAI 兼容接口用 [{type:'text'},{type:'image_url'}]；Anthropic 用 base64 块
function toAnthropic(m) {
  if (!Array.isArray(m.content)) return m;
  return { ...m, content: m.content.map(x => {
    if (x.type === 'text') return { type: 'text', text: x.text };
    if (x.type === 'image_url') {
      const u = String(x.image_url && x.image_url.url || '');
      const mm = u.match(/^data:([^;]+);base64,(.+)$/);
      if (mm) return { type: 'image', source: { type: 'base64', media_type: mm[1], data: mm[2] } };
      return { type: 'image', source: { type: 'url', url: u } };
    }
    return { type: 'text', text: String(x.text || '') };
  }) };
}
const msgText = m => Array.isArray(m.content) ? m.content.map(x => x.text || (x.image_url ? '[图片]' : '')).join('\n') : String(m.content || '');

export async function chat(cfg, messages, { onDelta, signal, temperature = 0.4, maxTokens = 2048, feat = 'other', captureCompletion = false, applyReplyRule = true } = {}) {
  // 直接音频已把语言规则纳入单消息提示和预算，避免再插入 system。
  const rule = applyReplyRule ? replyRule() : '';
  if (rule) messages = messages[0] && messages[0].role === 'system' ? [{ ...messages[0], content: messages[0].content + '\n\n' + rule }, ...messages.slice(1)] : [{ role: 'system', content: rule }, ...messages];
  const p = PROVIDERS[cfg.provider] || PROVIDERS.custom;
  const base = (cfg.base || p.base || '').replace(/\/+$/, '');
  if (!base && !p.hosted) throw new Error('还没有填接口地址');
  if (!cfg.key && cfg.provider !== 'custom' && !p.hosted) throw new Error('还没有填 API Key');
  let fmt = p.fmt;
  let url, headers, body;
  if (p.hosted) {
    const ep = await cfg.endpoint();
    url = ep.url; headers = { 'content-type': 'application/json', ...ep.headers };
    body = { model: cfg.model || '', messages, temperature, max_tokens: maxTokens, stream: true, feat };
  } else if (fmt === 'anthropic') {
    const sys = messages.filter(m => m.role === 'system').map(m => m.content).join('\n\n');
    url = base + '/messages';
    headers = { 'content-type': 'application/json', 'x-api-key': cfg.key, 'anthropic-version': '2023-06-01', 'anthropic-dangerous-direct-browser-access': 'true' };
    body = { model: cfg.model || p.model, max_tokens: maxTokens, temperature, stream: true, messages: messages.filter(m => m.role !== 'system').map(toAnthropic), ...(sys ? { system: sys } : {}) };
  } else {
    url = base + '/chat/completions';
    headers = { 'content-type': 'application/json', ...(cfg.key ? { authorization: 'Bearer ' + cfg.key } : {}) };
    body = { model: cfg.model || p.model, messages, temperature, max_tokens: maxTokens, stream: true };
  }
  let r;
  try { r = await fetch(url, { method: 'POST', headers, body: JSON.stringify(body), signal }); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    throw new Error('连不上这个服务商。可能是网络不通，或者它不允许网页直接调用。换一个服务商试试。');
  }
  if (!r.ok) {
    let msg = '';
    try { const j = await r.json(); msg = (j.error && (j.error.message || j.error)) || j.message || JSON.stringify(j); } catch (e) { msg = await r.text().catch(() => ''); }
    const hint = r.status === 401 || r.status === 403 ? 'Key 不对或没有权限。' : r.status === 429 ? '请求太频繁或免费额度用完了，稍后再试或换一个服务商。' : r.status === 404 ? '模型名或地址不对。' : '';
    if (p.hosted) throw new Error(String(msg || ('平台模型返回 ' + r.status)).slice(0, 200));
    throw new Error(`服务商返回 ${r.status}。${hint}${msg ? '（' + String(msg).slice(0, 160) + '）' : ''}`);
  }
  if (p.hosted && r.headers.get('x-ai-format') === 'anthropic') fmt = 'anthropic';
  let text = '', usage = { in: 0, out: 0 };
  // 元数据仅显式启用时附加；缺失原因保持未知，不由 token 或 [DONE] 推断。
  const completion = { finishReason: null, refusal: null };
  const capture = (reason, refusal, append = false) => {
    if (!captureCompletion) return;
    if (typeof reason === 'string' && reason.length) completion.finishReason = reason;
    if (typeof refusal === 'string' && refusal.length) completion.refusal = append ? (completion.refusal || '') + refusal : refusal;
  };
  const ct = r.headers.get('content-type') || '';
  if (!/event-stream/.test(ct) || !r.body) {   // 有的服务商忽略 stream，直接返回 JSON
    const j = await r.json();
    const choice = (j.choices || [])[0];
    text = fmt === 'anthropic' ? (j.content || []).map(c => c.text || '').join('') : choice?.message?.content || '';
    if (fmt === 'anthropic') capture(j.stop_reason === 'end_turn' ? 'stop' : j.stop_reason);
    else capture(choice?.finish_reason, choice?.message?.refusal);
    if (j.usage) usage = { in: j.usage.prompt_tokens || j.usage.input_tokens || 0, out: j.usage.completion_tokens || j.usage.output_tokens || 0 };
    if (onDelta && text) onDelta(text);
  } else {
    const rd = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    const consumeLine = raw => {
      const line = raw.trim();
      if (!line.startsWith('data:')) return;
      const data = line.slice(5).trim();
      if (!data || data === '[DONE]') return;
      let j; try { j = JSON.parse(data); } catch (e) { return; }
      let d = '';
      if (fmt === 'anthropic') {
        if (j.type === 'content_block_delta' && j.delta && j.delta.text) d = j.delta.text;
        if (j.type === 'message_start' && j.message && j.message.usage) usage.in = j.message.usage.input_tokens || 0;
        if (j.type === 'message_delta') {
          if (j.usage) usage.out = j.usage.output_tokens || 0;
          capture(j.delta?.stop_reason === 'end_turn' ? 'stop' : j.delta?.stop_reason);
        }
        if (j.type === 'error') throw new Error((j.error && j.error.message) || '服务商返回错误');
      } else {
        const c = (j.choices || [])[0];
        if (c && c.delta && typeof c.delta.content === 'string') d = c.delta.content;
        capture(c?.finish_reason, c?.delta?.refusal, true);
        if (j.usage) usage = { in: j.usage.prompt_tokens || usage.in, out: j.usage.completion_tokens || usage.out };
      }
      if (d) { text += d; if (onDelta) onDelta(d); }
    };
    for (;;) {
      const { value, done } = await rd.read();
      if (done) { buf += dec.decode(); break; }
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        consumeLine(buf.slice(0, i)); buf = buf.slice(i + 1);
      }
    }
    // 兼容流尾没有换行的最后一条 finish_reason/refusal，哪怕没有 content。
    if (buf) consumeLine(buf);
  }
  // 推理模型可能把思考过程放在 <think> 里，去掉
  text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
  let estimated = false;
  if (!usage.in && !usage.out) {  // 没返回用量时按字数粗估（中文约 1.5 字 / token）
    usage = { in: Math.ceil(messages.reduce((a, m) => a + msgText(m).length, 0) / 1.5), out: Math.ceil(text.length / 1.5) };
    estimated = true;
  }
  return { text, usage, estimated, ...(captureCompletion ? { completion } : {}) };
}

export const MAX_AUDIO_BYTES = 25 * 1024 * 1024;

function checkAudioAbort(signal) {
  if (signal?.aborted) throw new DOMException('语音请求已取消', 'AbortError');
}
function checkAudioBlob(blob) {
  if (!blob || typeof blob.arrayBuffer !== 'function' || !Number.isFinite(blob.size)) throw new Error('请选择有效的音频文件');
  if (blob.size <= 0) throw new Error('音频不能为空');
  if (blob.size > MAX_AUDIO_BYTES) throw new Error('音频不能超过 25 MiB');
}

// 语音转文字：/audio/transcriptions。hosted 不继承 URL/Key，不宣称平台已有此能力。
export async function transcribe(cfg, blob, opts = {}) {
  checkAudioAbort(opts.signal);
  checkAudioBlob(blob);
  const p = PROVIDERS[cfg.provider] || PROVIDERS.custom;
  const base = String(opts.base || cfg.sttBase || (!p.hosted && p.fmt === 'openai' ? cfg.base || p.base : '') || '').trim().replace(/\/+$/, '');
  const key = opts.key ?? cfg.sttKey ?? (!p.hosted ? cfg.key : '');
  if (!base) throw new Error('还没有填语音转文字的接口地址（平台模型不代表支持转写）');
  if (!key && cfg.provider !== 'custom' && !opts.base && !cfg.sttBase) throw new Error('还没有填语音转文字的 API Key');
  const fd = new FormData();
  fd.append('file', blob, opts.name || 'audio.webm');
  fd.append('model', opts.model || cfg.sttModel || 'whisper-1');
  let r;
  try { r = await fetch(base + '/audio/transcriptions', { method: 'POST', headers: key ? { authorization: 'Bearer ' + key } : {}, body: fd, signal: opts.signal }); }
  catch (e) {
    if (e.name === 'AbortError') throw e;
    checkAudioAbort(opts.signal);
    throw new Error('连不上语音转文字接口。换个网络，或在设置里换一个服务商。');
  }
  checkAudioAbort(opts.signal);
  if (!r.ok) {
    let msg = '';
    try { const j = await r.json(); msg = (j.error && (j.error.message || j.error)) || j.message || JSON.stringify(j); }
    catch (e) { if (e.name === 'AbortError') throw e; checkAudioAbort(opts.signal); }
    throw new Error(`语音转文字失败（${r.status}）${msg ? '：' + String(msg).slice(0, 160) : ''}`);
  }
  let j;
  try { j = await r.json(); }
  catch (e) { if (e.name === 'AbortError') throw e; checkAudioAbort(opts.signal); throw new Error('语音转文字接口没有返回有效 JSON'); }
  checkAudioAbort(opts.signal);
  const text = String(j.text || (j.data && j.data.text) || '').trim();
  if (!text) throw new Error('没有听清，换个安静一点的环境再试');
  return text;
}

// 直听：独立 OpenAI 兼容 Chat Completions 配置，真实音频 input_audio，绝不调用转写或静默降级。
// context 是文字上下文摘要；浏览器 webm 录音需由调用方显式转为 WAV。
// 共享预算校验供 UI 在录音/转换前拒绝；缺省不改变通用模型能力。
export function audioBudget(cfg = {}) {
  const result = {};
  for (const [key, ceiling] of [['audioMaxTokens',32768], ['audioContextChars',1000000], ['audioMaxSeconds',3600]]) {
    const value = cfg[key];
    if (value === undefined) continue;
    if (!Number.isInteger(value) || value < 1 || value > ceiling) throw new Error(`音频预算 ${key} 必须是 1–${ceiling} 的整数`);
    result[key] = value;
  }
  return result;
}

export async function understandAudio(cfg, blob, { signal, context = '', onDelta, temperature = 0.4, maxTokens, durationMs } = {}) {
  checkAudioAbort(signal);
  checkAudioBlob(blob);
  const base = String(cfg.audioBase || '').trim().replace(/\/+$/, '');
  const model = String(cfg.audioModel || '').trim();
  if (!base || !model) throw new Error('直接理解语音需要独立配置 audioBase 和 audioModel，不会复用聊天或平台模型');
  if (typeof context !== 'string') throw new Error('语音上下文 context 必须是字符串');
  const budget = audioBudget(cfg);
  maxTokens = maxTokens === undefined ? (budget.audioMaxTokens ?? 2048) : maxTokens;
  if (!Number.isInteger(maxTokens) || maxTokens < 1 || maxTokens > 32768) throw new Error('音频输出预算必须是 1–32768 的整数');
  if (budget.audioMaxTokens && maxTokens > budget.audioMaxTokens) throw new Error(`音频输出超过模型 ${budget.audioMaxTokens} token 限制，不会自动降低`);
  const languageRule = replyRule();
  const prompt = '请直接聆听并理解音频，回应其中的问题或意图。不要只返回转写。' + (context ? '\n\n对话上下文：\n' + context : '') + (languageRule ? '\n\n' + languageRule : '');
  if (budget.audioContextChars && prompt.length > budget.audioContextChars) throw new Error(`音频完整提示超过 ${budget.audioContextChars} 字符，请使用较少上下文；未截断或发送`);
  if (durationMs !== undefined && (!Number.isFinite(durationMs) || durationMs <= 0)) throw new Error('音频时长无效');
  if (budget.audioMaxSeconds && (durationMs === undefined || durationMs > budget.audioMaxSeconds * 1000)) throw new Error(`请提供不超过 ${budget.audioMaxSeconds} 秒的音频，超限不会截断或发送`);
  const mime = String(blob.type || '').split(';')[0].trim().toLowerCase();
  const format = ({ 'audio/wav': 'wav', 'audio/x-wav': 'wav', 'audio/wave': 'wav', 'audio/vnd.wave': 'wav', 'audio/mpeg': 'mp3', 'audio/mp3': 'mp3' })[mime];
  if (!format) throw new Error('直接理解语音仅支持 WAV/MP3；不支持 WebM 等格式，请先显式转换为 WAV');
  const bytes = new Uint8Array(await blob.arrayBuffer());
  checkAudioAbort(signal);
  // 小块编码避免大录音触发函数参数/调用栈上限；浏览器和 Node 均有 btoa。
  let binary = '';
  for (let i = 0; i < bytes.length; i += 0x8000) binary += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
  const messages = [{ role: 'user', content: [
    { type: 'text', text: prompt },
    { type: 'input_audio', input_audio: { data: btoa(binary), format } }
  ] }];
  const result = await chat({ provider: 'custom', base, model, key: cfg.audioKey || '' }, messages, { signal, onDelta, temperature, maxTokens, feat: 'audio', captureCompletion: true, applyReplyRule: false });
  checkAudioAbort(signal);
  // 不暴露服务端拒绝原文或自定义原因；残余正文不能冒充完整成功回答。
  if (result.completion.refusal) throw new Error('音频模型拒绝回答本次请求；不会自动转写');
  if (result.completion.finishReason && result.completion.finishReason !== 'stop') throw new Error('音频模型回答不完整，请重试或调整音频；不会自动转写');
  if (!String(result.text || '').trim()) throw new Error('音频模型没有返回文字回答，请检查服务或重新录音；不会自动转写');
  // 缺少服务端 usage 时 chat 的估算只包含文字，不是音频 token 的精确计费。
  return result;
}

export function cost(cfg, usage) {
  const p = PROVIDERS[cfg.provider] || PROVIDERS.custom;
  const [pi, po] = cfg.price || p.price;
  return ((usage.in * (+pi || 0) + usage.out * (+po || 0)) / 1e6) * USD_CNY;  // 人民币
}
