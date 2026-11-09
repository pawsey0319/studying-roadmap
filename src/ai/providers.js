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
export async function chat(cfg, messages, { onDelta, signal, temperature = 0.4, maxTokens = 2048, feat = 'other' } = {}) {
  // 界面是英文时，所有模型回复都用英文（提示词本身是中文）
  const rule = replyRule();
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
    body = { model: cfg.model || p.model, max_tokens: maxTokens, temperature, stream: true, messages: messages.filter(m => m.role !== 'system'), ...(sys ? { system: sys } : {}) };
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
  const ct = r.headers.get('content-type') || '';
  if (!/event-stream/.test(ct) || !r.body) {   // 有的服务商忽略 stream，直接返回 JSON
    const j = await r.json();
    text = fmt === 'anthropic' ? (j.content || []).map(c => c.text || '').join('') : ((j.choices || [])[0] || {}).message?.content || '';
    if (j.usage) usage = { in: j.usage.prompt_tokens || j.usage.input_tokens || 0, out: j.usage.completion_tokens || j.usage.output_tokens || 0 };
    if (onDelta && text) onDelta(text);
  } else {
    const rd = r.body.getReader(), dec = new TextDecoder();
    let buf = '';
    for (;;) {
      const { value, done } = await rd.read();
      if (done) break;
      buf += dec.decode(value, { stream: true });
      let i;
      while ((i = buf.indexOf('\n')) >= 0) {
        const line = buf.slice(0, i).trim(); buf = buf.slice(i + 1);
        if (!line.startsWith('data:')) continue;
        const data = line.slice(5).trim();
        if (!data || data === '[DONE]') continue;
        let j; try { j = JSON.parse(data); } catch (e) { continue; }
        let d = '';
        if (fmt === 'anthropic') {
          if (j.type === 'content_block_delta' && j.delta && j.delta.text) d = j.delta.text;
          if (j.type === 'message_start' && j.message && j.message.usage) usage.in = j.message.usage.input_tokens || 0;
          if (j.type === 'message_delta' && j.usage) usage.out = j.usage.output_tokens || 0;
          if (j.type === 'error') throw new Error((j.error && j.error.message) || '服务商返回错误');
        } else {
          const c = (j.choices || [])[0];
          if (c && c.delta && typeof c.delta.content === 'string') d = c.delta.content;
          if (j.usage) usage = { in: j.usage.prompt_tokens || usage.in, out: j.usage.completion_tokens || usage.out };
        }
        if (d) { text += d; if (onDelta) onDelta(d); }
      }
    }
  }
  // 推理模型可能把思考过程放在 <think> 里，去掉
  text = text.replace(/<think>[\s\S]*?<\/think>\s*/g, '');
  let estimated = false;
  if (!usage.in && !usage.out) {  // 没返回用量时按字数粗估（中文约 1.5 字 / token）
    usage = { in: Math.ceil(messages.reduce((a, m) => a + String(m.content).length, 0) / 1.5), out: Math.ceil(text.length / 1.5) };
    estimated = true;
  }
  return { text, usage, estimated };
}

export function cost(cfg, usage) {
  const p = PROVIDERS[cfg.provider] || PROVIDERS.custom;
  const [pi, po] = cfg.price || p.price;
  return ((usage.in * (+pi || 0) + usage.out * (+po || 0)) / 1e6) * USD_CNY;  // 人民币
}
