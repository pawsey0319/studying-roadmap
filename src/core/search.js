// 站内搜索（纯函数）：关键词全部命中才算匹配，不区分大小写。
export const tokens = q => String(q || '').toLowerCase().split(/\s+/).filter(Boolean).slice(0, 8);
export const matches = (text, toks) => { const s = String(text || '').toLowerCase(); return toks.length > 0 && toks.every(t => s.includes(t)); };

// 命中位置附近的一段文字
export function snippet(text, toks, len = 120) {
  const s = String(text || '').replace(/\s+/g, ' ').trim(), low = s.toLowerCase();
  const i = Math.min(...toks.map(t => low.indexOf(t)).filter(i => i >= 0), s.length);
  const start = Math.max(0, Math.min(i - 30, s.length - len));
  return (start > 0 ? '…' : '') + s.slice(start, start + len) + (start + len < s.length ? '…' : '');
}

// 先转义再高亮，避免注入
const esc = s => String(s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export function highlight(text, toks) {
  let h = esc(text);
  for (const t of [...toks].sort((a, b) => b.length - a.length)) {
    const et = esc(t).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
    h = h.replace(new RegExp(`(${et})(?![^<]*>)`, 'gi'), '<mark>$1</mark>');
  }
  return h;
}
