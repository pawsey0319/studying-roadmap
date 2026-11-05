// 中英双语。界面文字和固定内容（路线、精选资讯、商机、知识树分类）用 src/i18n-en.json 的词典，切到 English 时整页替换；
// 资讯快照、笔记这些不固定的内容，每个板块有“翻译”按钮，用你设置的模型翻译，结果存在这台设备上，下次直接显示。
// 做法：页面照常用中文渲染，再把文字节点和 title/placeholder 换成目标语言。用户自己写的内容（笔记正文、输入框、Agent 对话）不动。
const KEY = 'lh.lang';
export function lang() {
  let v = null; try { v = localStorage.getItem(KEY); } catch (e) {}
  if (v === 'zh' || v === 'en') return v;
  return /^zh/i.test(navigator.language || 'zh') ? 'zh' : 'en';
}
export const isEn = () => lang() === 'en';
export function setLang(v) { try { localStorage.setItem(KEY, v); } catch (e) {} location.reload(); }

const CJK = /[㐀-鿿]/;
const norm = s => String(s || '').replace(/\s+/g, ' ').trim();
let DICT = {}, TPL = [], RUN = {}, ready = false;
const cache = new Map();

// 带 {} 的词条变成正则；先用最长的固定片段做 includes 预筛，免得每个文字节点都跑几百个正则
function compile(dict) {
  const out = [];
  for (const [k, v] of Object.entries(dict)) {
    if (!k.includes('{}')) continue;
    const parts = k.split('{}');
    if (!parts.some(p => CJK.test(p))) continue;
    const re = new RegExp('^' + parts.map(p => p.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')).join('(.*?)') + '$');
    out.push({ re, v, hint: parts.slice().sort((a, b) => b.length - a.length)[0], w: parts.join('').length });
  }
  return out.sort((a, b) => b.w - a.w);
}
export async function initI18n() {
  document.documentElement.lang = isEn() ? 'en' : 'zh-CN';
  try { RUN = JSON.parse(localStorage.getItem('lh.tr.' + lang()) || '{}'); } catch (e) { RUN = {}; }
  if (isEn()) {
    try { DICT = await (await fetch('src/i18n-en.json', { cache: 'no-cache' })).json(); } catch (e) { DICT = {}; }
    TPL = compile(DICT);
  }
  ready = true;
  if (isEn() || Object.keys(RUN).length) observe();
}

// 查一段文字的译文；没有就返回 null。
// 依次试：整句词典 → 带 {} 的句式（空位里的内容再查一次）→ 数字换成 {} 再查 → 按“ · ”“，”“（）”切开逐段查
const NUM = /\d+(?:[-:./,]\d+)*/g;
const SEP = /(\s*·\s*|\s+\/\s+|，|；|：|（|）|、|。|\s*→\s*|›)/;
const PUNCT = { '，': ', ', '；': '; ', '：': ': ', '（': ' (', '）': ')', '、': ', ', '。': '. ' };
export function lookup(text, depth = 0) {
  const k = norm(text); if (!k) return null;
  if (!depth && cache.has(k)) return cache.get(k);
  let r = RUN[k] || null;
  if (!r && isEn() && CJK.test(k)) {
    r = DICT[k] || null;
    // 句式匹配上了，但空位里的中文翻不出来时不用它，换下一个句式（避免半中半英）
    if (!r && depth < 4) for (const t of TPL) {
      if (t.hint && !k.includes(t.hint)) continue;
      const m = k.match(t.re); if (!m) continue;
      let i = 0;
      const v = t.v.replace(/\{\}/g, () => { const g = m[++i]; return CJK.test(g) ? (lookup(g, depth + 1) || g) : g; });
      if (!CJK.test(v)) { r = v; break; }
    }
    if (!r && /\d/.test(k)) {
      const nums = k.match(NUM), v = DICT[k.replace(NUM, '{}')];
      if (v && v.split('{}').length - 1 === nums.length) { let i = 0; r = v.replace(/\{\}/g, () => nums[i++]); }
    }
    if (!r && depth < 3 && SEP.test(k)) {
      // 按分隔符切开，再尽量把相邻的几段拼回去整体查（“从 Transformer 到 GPT：亲手搭一遍”是一个词条，不能从冒号处断开）
      const T = k.split(SEP).filter(x => x !== ''), out = [];
      for (let a = 0; a < T.length;) {
        let done = false;
        for (let b = T.length; b > a; b--) {
          const seg = T.slice(a, b).join('').trim();
          if (!seg || !CJK.test(seg)) continue;
          const x = b - a === 1 && PUNCT[seg.trim()] ? null : lookup(seg, depth + 1);
          if (x) { out.push((/^\s/.test(T[a]) ? ' ' : '') + x + (/\s$/.test(T[b - 1]) ? ' ' : '')); a = b; done = true; break; }
        }
        if (!done) { out.push(PUNCT[T[a]] || T[a]); a++; }
      }
      const joined = out.join('').replace(/\s+([,;:)])/g, '$1').replace(/\(\s+/g, '(').replace(/\s{2,}/g, ' ').trim();
      // 每一段都要有译文才用，避免出现半中半英的句子
      if (!CJK.test(joined)) r = joined;
    }
    // 截断过的（以“…”结尾）：去掉省略号再查；查不到就找词典里以它开头的那条
    if (!r && /…$/.test(k) && k.length > 2) {
      const pre = k.slice(0, -1).trim(), x = lookup(pre, depth + 1);
      if (x) r = x + '…';
      else if (pre.length >= 4) { const hitK = Object.keys(DICT).find(y => y.startsWith(pre)); if (hitK) r = DICT[hitK].slice(0, Math.max(8, Math.round(pre.length * 1.8))) + '…'; }
    }
  }
  if (!depth) cache.set(k, r);
  return r;
}
// 给代码里拼出来的字符串用（confirm、prompt、导出文件等）
export const t = s => (isEn() ? lookup(s) || s : s);

/* ---------- 替换页面上的文字 ---------- */
// 不翻的：输入框、你写的笔记正文、Agent 的回复（它本来就按界面语言回答）
const SKIP = 'textarea,input,script,style,pre,code,[contenteditable],[data-notr],.ai > .md,.me,.ned,.nbody';
const ATTRS = ['title', 'placeholder', 'aria-label'];
// 点了“看原文”的板块（.trorig）里，按需翻译的结果不替换（界面词典照常）
// 内容（资讯标题、摘要、链接文字），区别于按钮和说明这些界面文字：看原文时只还原内容
export const CONTENT = '.tt,.ts,.rdl,.rd-t,.rd-s,.tline a,.live li a,.lst.hot a,.tr-p .rdl,.dsrc a';
function fixText(node) {
  const v = node.nodeValue; if (!v || !v.trim()) return;
  if (node.__orig != null) return;
  if (isEn() ? !CJK.test(v) && !RUN[norm(v)] : !RUN[norm(v)]) return;
  const p = node.parentElement; if (!p || p.closest(SKIP)) return;
  if (p.closest('.trorig') && (RUN[norm(v)] || p.closest(CONTENT))) return;
  const r = lookup(v); if (!r) return;
  node.__orig = v;
  const lead = v.match(/^\s*/)[0], tail = v.match(/\s*$/)[0];
  node.nodeValue = lead + r + tail;
}
function fixAttrs(el) {
  for (const a of ATTRS) { const v = el.getAttribute && el.getAttribute(a); if (v && (CJK.test(v) || RUN[norm(v)])) { const r = lookup(v); if (r) el.setAttribute(a, r); } }
}
export function translateTree(root) {
  if (!ready || !root) return;
  if (root.nodeType === 3) { fixText(root); return; }
  if (root.nodeType !== 1 && root.nodeType !== 11) return;
  if (root.nodeType === 1) { fixAttrs(root); if (root.closest && root.closest(SKIP)) return; }
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT | NodeFilter.SHOW_ELEMENT, {
    acceptNode: n => { if (n.nodeType === 1 && n.matches(SKIP)) { fixAttrs(n); return NodeFilter.FILTER_REJECT; } return NodeFilter.FILTER_ACCEPT; }
  });
  let n; while ((n = w.nextNode())) { if (n.nodeType === 3) fixText(n); else fixAttrs(n); }
}
let obs = null, busy = false;
function observe() {
  if (obs) return;
  obs = new MutationObserver(list => {
    if (busy) return; busy = true;
    for (const m of list) {
      if (m.type === 'characterData') { if (!busyRestore) fixText(m.target); }
      else if (m.type === 'attributes') fixAttrs(m.target);
      else m.addedNodes.forEach(translateTree);
    }
    obs.takeRecords(); busy = false;
  });
  obs.observe(document.body, { subtree: true, childList: true, characterData: true, attributes: true, attributeFilter: ATTRS });
  translateTree(document.body);
  for (const f of ['confirm', 'prompt', 'alert']) { const o = window[f].bind(window); window[f] = (m, ...a) => o(t(m), ...a); }
  document.title = t(document.title);
}

/* ---------- 不固定的内容：按板块用模型翻译，存在这台设备 ---------- */
// 需要翻译的文字：切到英文时是含中文的，中文界面时是外文标题（至少 3 个英文单词）
export const needs = s => { const k = norm(s); if (!k || RUN[k] || (isEn() && DICT[k])) return false; return isEn() ? CJK.test(k) : !CJK.test(k) && (k.match(/[A-Za-z]{2,}/g) || []).length >= 3; };
// 把一块区域里翻译过的文字换回原文
export function restore(root) {
  const w = document.createTreeWalker(root, NodeFilter.SHOW_TEXT); let n;
  while ((n = w.nextNode())) if (n.__orig != null && (RUN[norm(n.__orig)] || (n.parentElement && n.parentElement.closest(CONTENT)))) { const o = n.__orig; delete n.__orig; busyRestore = true; n.nodeValue = o; busyRestore = false; }
}
let busyRestore = false;
export const hasRuntime = s => !!RUN[norm(s)];
export const isContentNode = n => !!(n.parentElement && n.parentElement.closest(CONTENT));
export const originalOf = n => n.__orig;
export function saveRuntime(map) {
  for (const [k, v] of Object.entries(map)) if (v) RUN[norm(k)] = v;
  const keys = Object.keys(RUN); if (keys.length > 4000) for (const k of keys.slice(0, keys.length - 4000)) delete RUN[k];
  try { localStorage.setItem('lh.tr.' + lang(), JSON.stringify(RUN)); } catch (e) {}
  cache.clear(); observe(); translateTree(document.body);
}
export const trPrompt = () => isEn()
  ? 'Translate each string into concise natural English. Keep names of models, companies and products in their official English form. Return one JSON object mapping every input string exactly to its translation. Output only the JSON.'
  : '把每一条翻译成简洁自然的中文。模型、公司、产品名保留通用写法（英文原名或通行中文名）。只输出一个 JSON 对象，键是原文（一字不改），值是译文。';
// 给模型的语言要求（学习 Agent、一键解析等都跟随界面语言）
export const replyRule = () => (isEn() ? 'The user reads this site in English. Reply in English, even though the instructions above are in Chinese.' : '');
