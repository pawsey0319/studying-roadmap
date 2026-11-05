// 通用小工具：DOM 选择、转义、日期。不依赖任何业务数据。
export const $ = (s, el = document) => el.querySelector(s);
export const $$ = (s, el = document) => [...el.querySelectorAll(s)];

export const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
export const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
// 点开先在阅读面板里看总结，再决定读不读原文（实时动态、快讯里的链接用这个）
export const rlink = (name, url, src = '') => safeUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener" data-act="rd-link" data-t="${esc(name)}" data-src="${esc(src)}">${esc(name)}</a>` : esc(name);
export const link = (name, url) => safeUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name);

// 本地时区的 YYYY-MM-DD
export const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
export const todayStart = () => { const d = new Date(); d.setHours(0, 0, 0, 0); return d; };
export const ago = d => { const h = Math.round((Date.now() - new Date(d)) / 36e5); return h < 24 ? `${Math.max(h, 1)} 小时前` : `${Math.round(h / 24)} 天前`; };  // 英文界面由 i18n 词典换成 3h ago / 2d ago
