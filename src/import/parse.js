// 文档导入：把各种格式提取成“带结构的文本”，再用规则或 Agent 转成路线。
// 文件都在浏览器里解析，不上传；只有提取出的文字会在你点“让 Agent 整理”时发给模型服务商。
import { guessMode, uid } from '../core/ids.js';

export const MAX_BYTES = 20 * 1024 * 1024;

/* ---------- 提取：统一输出 blocks = [{type:'h', level, text} | {type:'li', text, depth, links} | {type:'p', text, links}] ---------- */
function blocksFromDom(doc) {
  const out = [];
  const linksOf = el => [...el.querySelectorAll('a[href]')].map(a => ({ name: a.textContent.trim(), url: a.href })).filter(l => /^https?:/.test(l.url));
  const walk = (el, depth) => {
    for (const ch of el.children) {
      const tag = ch.tagName;
      if (/^(SCRIPT|STYLE|NOSCRIPT|SVG|TEMPLATE|NAV|FOOTER|HEADER|FORM|BUTTON|SELECT|DIALOG)$/.test(tag)) continue;
      if (/^H[1-6]$/.test(tag)) { const t = ch.textContent.trim(); if (t) out.push({ type: 'h', level: +tag[1], text: t }); continue; }
      if (tag === 'LI') {
        const own = [...ch.childNodes].filter(n => !(n.nodeType === 1 && /^(UL|OL)$/.test(n.tagName))).map(n => n.textContent).join(' ').replace(/\s+/g, ' ').trim();
        if (own) out.push({ type: 'li', text: own, depth, links: linksOf(ch).slice(0, 4) });
        for (const sub of ch.querySelectorAll(':scope > ul, :scope > ol')) walk(sub, depth + 1);
        continue;
      }
      if (/^(P|TD|DT|DD|BLOCKQUOTE|LABEL)$/.test(tag)) { const t = ch.textContent.replace(/\s+/g, ' ').trim(); if (t) out.push({ type: 'p', text: t, links: linksOf(ch).slice(0, 4) }); continue; }
      walk(ch, /^(UL|OL)$/.test(tag) ? depth + 1 : depth);
    }
  };
  walk(doc.body || doc.documentElement, 0);
  return out;
}

function blocksFromMarkdown(src) {
  const out = [];
  for (const raw of String(src).replace(/\r\n?/g, '\n').split('\n')) {
    const line = raw.replace(/\s+$/, '');
    let m;
    if (!line.trim()) continue;
    const links = [...line.matchAll(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g)].map(x => ({ name: x[1], url: x[2] }))
      .concat([...line.matchAll(/(?<!\()(https?:\/\/[^\s)）]+)/g)].map(x => ({ name: x[1], url: x[1] })));
    const text = line.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, '$1').replace(/[*_`]/g, '');
    if ((m = text.match(/^(#{1,6})\s+(.*)$/))) out.push({ type: 'h', level: m[1].length, text: m[2].trim() });
    else if ((m = text.match(/^(\s*)([-*+]|\d+[.)、]|\[[ xX]\])\s+(.*)$/))) out.push({ type: 'li', depth: Math.floor(m[1].replace(/\t/g, '  ').length / 2), text: m[3].replace(/^\[[ xX]\]\s*/, '').trim(), links });
    else out.push({ type: 'p', text: text.trim(), links });
  }
  return out;
}

// 纯文本：识别“第 X 阶段 / 一、/ 1.”这类行作为标题
function blocksFromText(src) {
  return String(src).replace(/\r\n?/g, '\n').split('\n').map(s => s.trim()).filter(Boolean).map(t => {
    if (/^(第[一二三四五六七八九十\d]+[阶段章部分周]|[一二三四五六七八九十]+[、.]|Stage\s*\d|Part\s*\d|Module\s*\d|阶段\s*\d)/i.test(t) && t.length < 60) return { type: 'h', level: 2, text: t };
    const m = t.match(/^([-*•·]|\d+[.)、])\s*(.*)$/);
    return m ? { type: 'li', depth: 0, text: m[2], links: [] } : { type: 'p', text: t, links: [] };
  });
}

let pdfjs = null;
async function pdfText(buf) {
  if (!pdfjs) {
    pdfjs = await import('../../vendor/pdf.min.mjs');
    pdfjs.GlobalWorkerOptions.workerSrc = new URL('../../vendor/pdf.worker.min.mjs', import.meta.url).href;
  }
  const doc = await pdfjs.getDocument({ data: buf }).promise;
  const lines = [];
  for (let p = 1; p <= Math.min(doc.numPages, 300); p++) {
    const page = await doc.getPage(p), tc = await page.getTextContent();
    let lastY = null, cur = '';
    for (const it of tc.items) {
      const y = Math.round(it.transform[5]);
      if (lastY !== null && Math.abs(y - lastY) > 2) { if (cur.trim()) lines.push(cur.trim()); cur = ''; }
      cur += it.str; lastY = y;
    }
    if (cur.trim()) lines.push(cur.trim());
  }
  return lines.join('\n');
}
let mammothP = null;
async function docxHtml(buf) {
  if (!mammothP) mammothP = new Promise((res, rej) => {
    if (window.mammoth) return res(window.mammoth);
    const s = document.createElement('script'); s.src = new URL('../../vendor/mammoth.browser.min.js', import.meta.url).href;
    s.onload = () => res(window.mammoth); s.onerror = () => rej(new Error('Word 解析组件加载失败')); document.head.appendChild(s);
  });
  const m = await mammothP;
  return (await m.convertToHtml({ arrayBuffer: buf })).value;
}

// 返回 { title, kind, text（纯文本，用于资料和发给 AI）, blocks, v1? }
export async function extractFile(file) {
  if (file.size > MAX_BYTES) throw new Error('文件超过 20 MB，请拆分后再导入');
  const name = file.name, ext = (name.match(/\.([a-z0-9]+)$/i) || [])[1]?.toLowerCase() || '';
  const title = name.replace(/\.[^.]+$/, '');
  if (ext === 'pdf') {
    const text = await pdfText(await file.arrayBuffer());
    if (text.replace(/\s/g, '').length < 40) throw new Error('这个 PDF 里提取不到文字，可能是扫描件。这一版不支持图片识别，请换成文字版。');
    return { title, kind: 'pdf', text, blocks: blocksFromText(text) };
  }
  if (ext === 'docx') {
    const html = await docxHtml(await file.arrayBuffer());
    return fromHtml(html, title, 'docx');
  }
  if (ext === 'doc') throw new Error('旧版 .doc 文件无法在浏览器里解析，请在 Word 里另存为 .docx 再导入');
  const text = await file.text();
  if (/^html?$/.test(ext) || /^\s*<(!doctype|html)/i.test(text)) return fromHtml(text, title, 'html');
  if (ext === 'json') return fromJson(text, title);
  if (/^(md|markdown)$/.test(ext)) return { title, kind: 'md', text, blocks: blocksFromMarkdown(text) };
  return { title, kind: 'txt', text, blocks: /(^|\n)#{1,4}\s|\n\s*[-*]\s/.test(text) ? blocksFromMarkdown(text) : blocksFromText(text) };
}

export function fromHtml(html, title, kind = 'html') {
  const doc = new DOMParser().parseFromString(html, 'text/html');
  const v1 = detectV1(doc, html);
  const t = (doc.querySelector('title') && doc.querySelector('title').textContent.trim()) || title || '导入的网页';
  const blocks = blocksFromDom(doc);
  const text = blocks.map(b => (b.type === 'h' ? '#'.repeat(b.level) + ' ' : b.type === 'li' ? '  '.repeat(b.depth) + '- ' : '') + b.text).join('\n');
  return { title: t, kind, text, blocks, v1 };
}
export function fromPaste(text, title = '粘贴的内容') {
  if (/^\s*</.test(text)) return fromHtml(text, title, 'html');
  if (/^\s*[{[]/.test(text)) { try { return fromJson(text, title); } catch (e) {} }
  return { title, kind: 'txt', text, blocks: /(^|\n)#{1,4}\s|\n\s*[-*]\s/.test(text) ? blocksFromMarkdown(text) : blocksFromText(text) };
}
function fromJson(text, title) {
  const j = JSON.parse(text);
  if (j && Array.isArray(j.stages)) return { title: j.name || title, kind: 'json', text, blocks: [], track: j };
  return { title, kind: 'txt', text, blocks: blocksFromText(text) };
}

/* ---------- 识别本站 v1 的网页（旧版学习路线网站的 HTML） ---------- */
// v1 页面结构：.stage > .s-sum h4 标题，.s-goal 目标，.col 里 h5“技术/产品” + .task 任务，.res li 资源，.out 产出
function detectV1(doc) {
  const stages = doc.querySelectorAll('li.stage');
  if (!stages.length) return null;
  const name = (doc.querySelector('.panel-head h2') || {}).textContent || '';
  return [...stages].map(li => ({
    title: (li.querySelector('.s-sum h4') || {}).textContent?.trim() || '未命名阶段',
    goal: (li.querySelector('.s-goal') || {}).textContent?.trim() || '',
    items: [...li.querySelectorAll('.col')].flatMap(col => {
      const prod = /产品/.test((col.querySelector('h5') || {}).textContent || '');
      return [...col.querySelectorAll('.task span')].map(s => ({ text: s.textContent.trim(), kind: prod ? 'prod' : 'tech' }));
    }),
    resources: [...li.querySelectorAll('.res li')].map(r => { const a = r.querySelector('a'); return { name: (a || r).textContent.replace(/（无链接，按名称查找）/, '').trim(), url: a ? a.href : '' }; }),
    output: ((li.querySelector('.out') || {}).textContent || '').replace(/^阶段产出/, '').trim(),
    checked: [...li.querySelectorAll('.task input')].map(i => i.checked),
    track: name.trim()
  }));
}

/* ---------- 规则解析：blocks → 路线 ---------- */
// 结构清楚的文档（有标题分节、列表）不需要 AI。返回 null 表示结构不清楚，交给 Agent。
const RES_HINT = /^(资源|学习资源|资料|参考|推荐阅读|阅读|课程|Resources|References|Reading)/i;
const OUT_HINT = /^(产出|阶段产出|作业|交付|项目|Output|Deliverable)/i;
const GOAL_HINT = /^(目标|学习目标|Goal|Objective)[:：]?/i;
export function ruleParse(ex) {
  if (ex.track) return normalizeTrack(ex.track);
  if (ex.v1) return normalizeTrack({ name: ex.v1[0].track || ex.title, stages: ex.v1.map(s => ({ ...s, items: s.items.map(i => ({ text: i.text, mode: guessMode(i.text) })) })) });
  const B = ex.blocks || [];
  const hs = B.filter(b => b.type === 'h');
  if (!hs.length) return null;
  // 选“阶段级”的标题：出现 2–30 次、下面有列表项的那一级
  const levels = [...new Set(hs.map(h => h.level))].sort();
  let lv = null;
  for (const l of levels) {
    const n = hs.filter(h => h.level === l).length;
    if (n >= 2 && n <= 30) { lv = l; break; }
  }
  if (lv === null) return null;
  const stages = []; let cur = null, sub = 'item';
  for (const b of B) {
    if (b.type === 'h' && b.level === lv) { cur = { title: b.text.replace(/^[#\s]+/, ''), goal: '', items: [], resources: [], output: '' }; stages.push(cur); sub = 'item'; continue; }
    if (!cur) continue;
    if (b.type === 'h') { sub = RES_HINT.test(b.text) ? 'res' : OUT_HINT.test(b.text) ? 'out' : 'item'; continue; }
    if (b.type === 'p') {
      if (GOAL_HINT.test(b.text)) { cur.goal = b.text.replace(GOAL_HINT, '').trim(); continue; }
      if (OUT_HINT.test(b.text)) { cur.output = b.text.replace(OUT_HINT, '').replace(/^[:：]/, '').trim(); continue; }
      if (RES_HINT.test(b.text)) { sub = 'res'; (b.links || []).forEach(l => cur.resources.push(l)); continue; }
      if (!cur.goal && b.text.length < 200) { cur.goal = b.text; continue; }
    }
    if (b.type === 'li' || b.type === 'p') {
      if (sub === 'out') { cur.output = (cur.output ? cur.output + '；' : '') + b.text; continue; }
      const isRes = sub === 'res' || ((b.links || []).length && b.text.replace(/https?:\/\/\S+/g, '').trim().length < 60 && !/^(读|看|写|做|跑|搭|实现)/.test(b.text));
      if (isRes) { const l = (b.links || [])[0]; cur.resources.push({ name: b.text.replace(/https?:\/\/\S+/g, '').replace(/[:：\s]+$/, '').trim() || (l && l.name) || '资源', url: l ? l.url : '' }); }
      else if (b.type === 'li') cur.items.push({ text: b.text, mode: guessMode(b.text) });
    }
  }
  const good = stages.filter(s => s.items.length || s.resources.length);
  if (good.length < 2) return null;
  const h1 = B.find(b => b.type === 'h' && b.level < lv);
  return normalizeTrack({ name: (h1 && h1.text) || ex.title, stages: good });
}

// 统一成站内路线结构，并分配 ID：u<随机>.sNN.iNN
export function normalizeTrack(raw, opts = {}) {
  const id = opts.id || 'u' + uid('').slice(0, 10);
  const pad = n => String(n).padStart(2, '0');
  const stages = (raw.stages || []).slice(0, 30).map((s, si) => {
    const sid = `${id}.s${pad(si + 1)}`;
    let items = (s.items || []).map(i => typeof i === 'string' ? { text: i } : i).filter(i => i && String(i.text || '').trim());
    if (items.length && !items.some(i => (i.mode || guessMode(i.text)) === 'practice')) items = items.map(i => ({ ...i }));
    return {
      id: sid, title: String(s.title || `阶段 ${si + 1}`).slice(0, 120), goal: String(s.goal || '').slice(0, 600),
      items: items.slice(0, 40).map((i, k) => ({ id: `${sid}.i${pad(k + 1)}`, kind: i.kind || 'tech', mode: i.mode === 'practice' || i.mode === 'theory' ? i.mode : guessMode(i.text), text: String(i.text).trim().slice(0, 500) })),
      resources: (s.resources || []).slice(0, 40).map((r, k) => ({ id: `${sid}.r${pad(k + 1)}`, name: String(r.name || r.url || '资源').slice(0, 200), ...(/^https?:\/\//.test(r.url || '') ? { url: r.url } : {}) })),
      output: String(s.output || '').slice(0, 300),
      ...(s.checked ? { _checked: s.checked } : {})
    };
  }).filter(s => s.items.length || s.resources.length);
  return { id, domain: 'mine', name: String(raw.name || '导入的方向').slice(0, 40), short: String(raw.short || raw.name || '导入').slice(0, 8), color: opts.color || '#3C6E71', goal: String(raw.goal || '').slice(0, 400), source: opts.source || '', stages };
}

// 合并进已有方向时，找出和现有阶段重复的阶段（标题相似度）
export function dupStages(imported, existing) {
  const norm = s => s.toLowerCase().replace(/[\s:：、，,.。/（）()\-—]+/g, '');
  const bigrams = s => { const n = norm(s), set = new Set(); for (let i = 0; i < n.length - 1; i++) set.add(n.slice(i, i + 2)); return set; };
  const sim = (a, b) => { const A = bigrams(a), B = bigrams(b); if (!A.size || !B.size) return 0; let x = 0; A.forEach(g => B.has(g) && x++); return 2 * x / (A.size + B.size); };
  return imported.stages.map(s => {
    let best = null, score = 0;
    for (const e of existing.stages) { const v = sim(s.title, e.title); if (v > score) { score = v; best = e; } }
    return { stage: s, dup: score >= 0.5 ? best : null, score };
  });
}
