// 实时动态：打开页面时从公开接口直接拉取，1 小时内用缓存。
// 依赖：C（公共内容，用于快照兜底）、curTab（当前板块，用来丢弃切走后的结果）。
import { $, esc, link, rlink, iso, ago } from './util.js';

let C = {}, curTab = () => '';
export function setupLive(content, getTab) { C = content; curTab = getTab; }

const KW = {
  llm: /language model|\bLLMs?\b|reasoning|pre-?train|RLHF|RLVR|distill|attention|mixture-of-experts|\bMoE\b|scaling|interpretab/i,
  slm: /small (language )?models?|\bSLMs?\b|on-device|edge device|distill|quantiz|pruning|fine-?tun|LoRA|domain-specific|\b[0-9](\.[0-9])?B\b/i,
  agent: /agent|tool[- ]use|\bGUI\b|computer[- ]use|web navigation|\bMCP\b|multi-agent/i,
  quant: /financ|trading|\bstocks?\b|portfolio|alpha factor|quantitative|asset pric|hedge fund|backtest/i
};
const TTL = 3600e3;
const cacheGet = k => { try { const c = JSON.parse(localStorage.getItem('lh.c.' + k)); return c && Date.now() - c.t < TTL ? c.v : null; } catch (e) { return null; } };
const cacheSet = (k, v) => { try { localStorage.setItem('lh.c.' + k, JSON.stringify({ t: Date.now(), v })); } catch (e) {} };
const getJSON = async u => {
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(u, { signal: ctl.signal });
    if (r.status === 403 && /api\.github\.com/.test(u)) throw new Error('GitHub 匿名访问次数已用完');
    if (!r.ok) throw new Error('HTTP ' + r.status);
    return await r.json();
  } catch (e) { throw e.name === 'AbortError' ? new Error('连接超时') : e; }
  finally { clearTimeout(tm); }
};
// 部分网络打不开 huggingface.co，先试主站，失败后换 hf-mirror.com（同一份数据的国内镜像），记住能用的那个
let HF_BASE = null;
async function hfJSON(path) {
  const order = HF_BASE ? [HF_BASE] : ['https://huggingface.co', 'https://hf-mirror.com'];
  let err;
  for (const b of order) {
    try { const d = await getJSON(b + path); HF_BASE = b; return d; } catch (e) { err = e; }
  }
  HF_BASE = null; throw err;
}
const hfLink = p => (HF_BASE || 'https://huggingface.co') + p;
const snap = () => (C.sources && C.sources.items) || [];
// 预取数据 6 小时内算新
const fresh = () => C.github && C.github.updated && (Date.now() - new Date(C.github.updated.replace(' ', 'T') + ':00+08:00')) < 6 * 3600e3;

const SOURCES = {
  async hf(t) {
    let daily, fromSnap = false;
    try { daily = await hfJSON('/api/daily_papers?limit=100'); }
    catch (e) {
      if (!(C.sources && C.sources.hf && C.sources.hf.length)) throw e;
      daily = C.sources.hf.map(x => ({ publishedAt: x.d, paper: { id: x.id, title: x.t, summary: x.s, upvotes: x.v } })); fromSnap = true;
    }
    const re = KW[t.id];
    let list = daily.filter(x => re.test(x.paper.title + (t.id === 'quant' ? '' : ' ' + (x.paper.summary || '').slice(0, 300))))
      .sort((a, b) => (b.paper.upvotes || 0) - (a.paper.upvotes || 0))
      .map(x => ({ t: x.paper.title, u: (fromSnap ? 'https://arxiv.org/abs/' : hfLink('/papers/')) + x.paper.id, m: `${x.paper.upvotes || 0} 赞 · ${ago(x.publishedAt)}${fromSnap ? ' · 来自每日快照' : ''}` }));
    if (list.length < 6 && !fromSnap) {
      const s = await hfJSON('/api/papers/search?q=' + encodeURIComponent(t.live.hf)).catch(() => []);
      s.sort((a, b) => new Date(b.paper.publishedAt) - new Date(a.paper.publishedAt));
      for (const x of s) {
        if (list.length >= 6) break;
        if (!list.some(y => y.u.endsWith(x.paper.id)))
          list.push({ t: x.paper.title, u: hfLink('/papers/') + x.paper.id, m: String(x.paper.publishedAt).slice(0, 10) });
      }
    }
    return list.slice(0, 6);
  },
  async hn(t) {
    // 只匹配标题、关闭模糊匹配，多个关键词合并后按时间排序
    const since = Math.floor(Date.now() / 1000) - 21 * 86400;
    const res = await Promise.all(HNQ[t.id].map(q => getJSON('https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=10&restrictSearchableAttributes=title&typoTolerance=false'
      + `&numericFilters=${encodeURIComponent(`points>20,created_at_i>${since}`)}&query=` + encodeURIComponent(q))));
    const seen = new Set();
    return res.flatMap(d => d.hits).filter(h => !seen.has(h.objectID) && seen.add(h.objectID) && (!HNX[t.id] || !HNX[t.id].test(h.title)))
      .sort((a, b) => b.created_at_i - a.created_at_i).slice(0, 6)
      .map(h => ({ t: h.title, u: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, m: `${h.points} 分 · ${ago(h.created_at)}` }));
  },
  async gh(t) {
    const pre = fresh() && (C.github.gh || {})[t.id];
    if (pre && pre.length) return pre.map(r => ({ t: r.t, u: r.u, m: `★ ${r.stars}${r.desc ? ' · ' + r.desc.slice(0, 60) : ''}` }));
    const since = iso(new Date(Date.now() - 30 * 864e5));
    const d = await getJSON(`https://api.github.com/search/repositories?sort=stars&order=desc&per_page=6&q=${encodeURIComponent(`topic:${t.live.gh} created:>${since}`)}`);
    return d.items.map(r => ({ t: r.full_name, u: r.html_url, m: `★ ${r.stargazers_count}${r.description ? ' · ' + r.description.slice(0, 60) : ''}` }));
  },
  // Hugging Face 热门模型：官方仓库里正在被大量下载和点赞的模型
  async hfm(t) {
    const ex = '&expand[]=safetensors&expand[]=pipeline_tag&expand[]=trendingScore&expand[]=createdAt';
    const q = HFM[t.id];
    const lists = await Promise.all(q.urls.map(u => hfJSON('/api/models?sort=trendingScore&limit=100' + u + ex)));
    const seen = new Set();
    return lists.flat().sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0)).filter(m => {
      if (seen.has(m.id)) return false; seen.add(m.id);
      if (/uncensored|abliterat|heretic|obliterat/i.test(m.id)) return false;  // 过滤社区去对齐改版
      if (/gguf|exl[23]|awq|gptq|-mlx|fp8|nvfp4|bnb|\d+bpw/i.test(m.id)) return false;  // 过滤量化转换版，只看原始发布
      const fam = m.id.replace(/[-_]?\d+(\.\d+)?[BMK](-[A-Za-z0-9.]+)?$/i, '');  // 同一家族不同尺寸只保留热度最高的一个
      if (seen.has('fam:' + fam)) return false; seen.add('fam:' + fam);
      if ((m.trendingScore || 0) < 5) return false;
      if (m.createdAt && Date.now() - new Date(m.createdAt) > 180 * 864e5) return false;  // 只看近半年发布的模型
      const p = (m.safetensors || {}).total;
      return q.ok(m, p ? p / 1e9 : null);
    }).sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0)).slice(0, 6).map(m => {
      const p = (m.safetensors || {}).total;
      const size = !p ? '' : p < 1e9 ? Math.round(p / 1e6) + 'M · ' : (p / 1e9).toFixed(p < 1e10 ? 1 : 0) + 'B · ';
      return { t: m.id, u: hfLink('/') + m.id, m: `${size}热度 ${m.trendingScore || 0} · ${String(m.createdAt || '').slice(0, 10)}` };
    });
  },
  // OpenRouter：各家模型上架到统一 API 的时间与价格，相当于“模型发布与价格”的官方记录
  async or(t) {
    const d = (await getJSON('https://openrouter.ai/api/v1/models')).data;
    const f = OR_FILTER[t.id] || (() => true);
    return d.filter(m => !/:free$/.test(m.id) && f(m)).sort((a, b) => b.created - a.created).slice(0, 6).map(m => {
      const pi = +m.pricing.prompt * 1e6, po = +m.pricing.completion * 1e6;
      return { t: m.name, u: 'https://openrouter.ai/' + m.id, m: `${iso(new Date(m.created * 1000))} 上架 · 输入 $${pi.toFixed(2)} / 输出 $${po.toFixed(2)} 每百万 token · ${Math.round(m.context_length / 1000)}K 上下文` };
    });
  },
  // 关键开源项目的正式版本发布（一手来源）
  async rel(t) {
    // 先用 Actions 预取的结果（带令牌，不受网页匿名 60 次的限制），太旧或没有时才直接调接口
    const pre = fresh() && (C.github.rel || {})[t.id];
    if (pre && pre.length) return pre.map(x => ({ t: x.t, u: x.u, m: `${ago(x.at)} · ${x.r}` }));
    const repos = REPOS[t.id];
    let failed = 0;
    const res = await Promise.all(repos.map(r => getJSON(`https://api.github.com/repos/${r}/releases?per_page=3`).catch(() => { failed++; return []; })));
    if (failed === repos.length) {  // 全部失败（多半是匿名次数用完）：先用旧一点的预取结果，再用每日快照
      const old = C.github && (C.github.rel || {})[t.id];
      if (old && old.length) return old.map(x => ({ t: x.t, u: x.u, m: `${ago(x.at)} · ${x.r} · ${C.github.updated} 抓取` }));
      const its = snap().filter(x => / Release$/.test(x.src) && x.k.includes(t.id)).slice(0, 7);
      if (!its.length) throw new Error('GitHub 匿名访问次数已用完，约 1 小时后恢复');
      return its.map(x => ({ t: `${x.src.replace(/ Release$/, '')} ${x.t}`.slice(0, 80), u: x.u, m: `${x.d} · 来自每日快照` }));
    }
    return res.flatMap((list, i) => list.filter(x => !x.prerelease && !x.draft).slice(0, 1).map(x => ({ r: repos[i], x })))
      .sort((a, b) => new Date(b.x.published_at) - new Date(a.x.published_at)).slice(0, 7)
      .map(({ r, x }) => ({ t: `${r.split('/')[1]} ${x.tag_name}`, u: x.html_url, m: `${ago(x.published_at)} · ${r}` }));
  }
};
const HNQ = {
  llm: ['LLM', 'GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'language model'],
  slm: ['small model', 'local LLM', 'llama.cpp', 'Ollama', 'fine-tuning', 'on-device', 'quantization'],
  agent: ['AI agent', 'agents', 'MCP', 'agentic', 'Claude Code', 'Codex'],
  quant: ['trading', 'quantitative', 'stock market', 'hedge fund', 'backtest', 'portfolio']
};
const HNX = { quant: /quantum|insider trading|kalshi|polymarket|crypto|bitcoin/i };
const HFM = {
  llm: { urls: ['&filter=text-generation', '&filter=image-text-to-text'], ok: (m, b) => b === null || b >= 20 },
  slm: { urls: ['&filter=text-generation', '&filter=image-text-to-text', '&filter=feature-extraction'], ok: (m, b) => b !== null && b <= 12 },
  agent: { urls: ['&filter=text-generation', '&filter=image-text-to-text', '&search=agent'], ok: m => /agent|gui|computer|browser|coder|code|tool|swe|terminal/i.test(m.id) },
  quant: { urls: ['&filter=time-series-forecasting', '&search=finance', '&search=fin'], ok: () => true }
};
const OR_FILTER = {
  llm: () => true,
  slm: m => /\b([0-9]|1[0-2])(\.\d)?b\b|mini|small|nano|flash-lite|haiku|tiny|-a[0-9]b/i.test(m.id + ' ' + m.name),
  agent: m => (m.supported_parameters || []).includes('tools'),
  quant: m => (m.supported_parameters || []).includes('tools') && +m.pricing.prompt * 1e6 <= 0.5  // 跑交易智能体时更看重低价、能调用工具的模型
};
const REPOS = {
  llm: ['vllm-project/vllm', 'sgl-project/sglang', 'huggingface/transformers', 'huggingface/trl'],
  slm: ['ollama/ollama', 'ggml-org/llama.cpp', 'ml-explore/mlx-lm', 'unslothai/unsloth', 'hiyouga/LlamaFactory', 'huggingface/peft'],
  agent: ['openai/openai-agents-python', 'langchain-ai/langgraph', 'modelcontextprotocol/python-sdk', 'browser-use/browser-use', 'OpenHands/OpenHands', 'huggingface/smolagents'],
  quant: ['TauricResearch/TradingAgents', 'microsoft/qlib', 'microsoft/RD-Agent', 'vnpy/vnpy', 'akfamily/akshare', 'polakowo/vectorbt']
};
export const LIVE = [
  { id: 'hf', name: 'Hugging Face 热门论文', kind: '论文' },
  { id: 'rel', name: '关键项目新版本', kind: '一手来源' },
  { id: 'hfm', name: 'Hugging Face 热门模型', kind: '模型热度' },
  { id: 'or', name: 'OpenRouter 新上架模型', kind: '价格与上架' },
  { id: 'hn', name: 'Hacker News 讨论', kind: '社区热度' },
  { id: 'gh', name: 'GitHub 近 30 天新星项目', kind: '社区热度' }
];
export async function loadOne(t, src, force) {
  const el = $('#live-' + src); if (!el) return;
  const ck = `${src}.${t.id}`;
  let v = force ? null : cacheGet(ck);
  if (!v) {
    const btn = document.querySelector(`[data-reload="${src}"]`);
    el.className = 'msg'; el.textContent = force ? '正在重新拉取…' : '加载中…';
    if (btn) { btn.disabled = true; btn.textContent = '拉取中'; }
    try { v = await SOURCES[src](t); cacheSet(ck, v); }
    catch (e) {
      if (curTab() !== t.id) return;
      el.className = 'msg';
      const why = /Failed to fetch|NetworkError|Load failed|连接超时/.test(e.message) ? '当前网络连不上这个接口' : e.message;
      el.textContent = `没有拉取到数据：${why}。换个网络或稍后再点刷新。`
        + `（${new Date().toLocaleTimeString('zh-CN', { hour12: false })} 尝试）`;
      return;
    } finally { if (btn) { btn.disabled = false; btn.textContent = '刷新'; } }
  }
  if (curTab() !== t.id) return;
  el.className = '';
  el.innerHTML = v.length ? `<ol>${v.map(x => `<li>${rlink(x.t, x.u, (LIVE.find(c => c.id === src) || {}).name)}<small>${esc(x.m)}</small></li>`).join('')}</ol>`
    : '<span class="msg">最近没有匹配的条目。</span>';
}
export function loadLive(t, force) { LIVE.forEach(c => loadOne(t, c.id, force)); }
