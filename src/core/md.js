// 极简、安全的 Markdown 渲染：先整体转义，再识别少量语法。
// 不执行任何 HTML，链接只允许 http/https，所以笔记和 AI 回复里的内容不会注入脚本。
const esc = s => s.replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));

function inline(s) {
  const codes = [];
  s = s.replace(/`([^`]+)`/g, (_, c) => { codes.push(c); return `\u0000${codes.length - 1}\u0000`; });
  s = esc(s);
  s = s.replace(/\[([^\]]+)\]\((https?:\/\/[^\s)]+)\)/g, (_, t, u) => `<a href="${u}" target="_blank" rel="noopener">${t}</a>`);
  // 裸链接：前面可以是任何不属于网址的字符（中文冒号、括号等）；网址遇到空白、中文或中文标点就结束，末尾的英文标点不算
  s = s.replace(/(^|[^\w\/"=>:.\-])(https?:\/\/[^\s<>"'）)\]】，。；、！？「」《》\u3400-\u9fff]+)/g, (_, p, u) => {
    const tail = (u.match(/[.,;:!?]+$/) || [''])[0]; u = u.slice(0, u.length - tail.length);
    return `${p}<a href="${u}" target="_blank" rel="noopener">${u.replace(/^https?:\/\//, '').slice(0, 60)}${u.length > 68 ? '…' : ''}</a>${tail}`;
  });
  s = s.replace(/\*\*([^*]+)\*\*/g, '<b>$1</b>').replace(/(^|[^*])\*([^*\s][^*]*)\*/g, '$1<i>$2</i>');
  return s.replace(/\u0000(\d+)\u0000/g, (_, i) => `<code>${esc(codes[+i])}</code>`);
}

export function md(src) {
  const lines = String(src || '').replace(/\r\n?/g, '\n').split('\n');
  const out = [];
  let list = null, para = [], code = null;
  const flushPara = () => { if (para.length) { out.push(`<p>${inline(para.join(' '))}</p>`); para = []; } };
  const flushList = () => { if (list) { out.push(`<${list.t}>${list.items.map(x => `<li>${inline(x)}</li>`).join('')}</${list.t}>`); list = null; } };
  for (const raw of lines) {
    if (code) {
      if (/^```/.test(raw)) { out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`); code = null; } else code.push(raw);
      continue;
    }
    if (/^```/.test(raw)) { flushPara(); flushList(); code = []; continue; }
    const line = raw.trimEnd();
    let m;
    if (!line.trim()) { flushPara(); flushList(); continue; }
    if ((m = line.match(/^(#{1,4})\s+(.*)$/))) { flushPara(); flushList(); const n = Math.min(m[1].length + 2, 6); out.push(`<h${n}>${inline(m[2])}</h${n}>`); continue; }
    if ((m = line.match(/^>\s?(.*)$/))) { flushPara(); flushList(); out.push(`<blockquote>${inline(m[1])}</blockquote>`); continue; }
    if ((m = line.match(/^\s*[-*+]\s+(.*)$/)) || (m = line.match(/^\s*\d+[.)、]\s+(.*)$/))) {
      flushPara();
      const t = /^\s*\d/.test(line) ? 'ol' : 'ul';
      if (!list || list.t !== t) { flushList(); list = { t, items: [] }; }
      list.items.push(m[1]); continue;
    }
    flushList(); para.push(line.trim());
  }
  if (code) out.push(`<pre><code>${esc(code.join('\n'))}</code></pre>`);
  flushPara(); flushList();
  return out.join('');
}
