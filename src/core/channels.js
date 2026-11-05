// 资讯渠道（纯函数）：渠道文档的校验、网址检查、订阅源解析、失败原因。
// channels 文档有两种键：
//   u<随机> → { name, url, tracks[], c }   用户自己加的订阅源（RSS / Atom / JSON Feed）
//   off.<名称哈希> → 名称                  用户关掉的内置渠道（只是不再显示，不影响别人，随时能恢复）
import { hash } from './ids.js';

export const MAX_USER = 20;
export const offKey = name => 'off.' + hash(String(name));
const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
export function channelOk(k, v) {
  if (/^off\.[0-9a-f]{12}$/.test(k)) return typeof v === 'string' && v.length > 0 && v.length <= 80;
  if (/^u[0-9a-z]{6,24}$/.test(k)) {
    return isObj(v) && typeof v.name === 'string' && v.name.length > 0 && v.name.length <= 40 && typeof v.url === 'string' && /^https:\/\/\S{4,480}$/.test(v.url)
      && Array.isArray(v.tracks) && v.tracks.length <= 8 && v.tracks.every(t => /^[a-z0-9][a-z0-9-]{1,30}$/.test(t)) && typeof v.c === 'number';
  }
  return false;
}

/* ---------- 失败原因：每一种都写清是没有权限、地址不对还是别的 ---------- */
export const fail = (code, reason) => Object.assign(new Error(reason), { code });
export const REASONS = {
  'bad-url': '这不是有效的网址。订阅地址应该以 https:// 开头。',
  'not-https': '只支持 https 开头的地址。http 没有加密，手机系统也不允许读取，可以试试把 http 改成 https。',
  'x-site': 'X（推特）没有公开的订阅地址，官方接口需要付费的 API 权限，所以不能直接订阅某个账号。可以用第三方把账号转成订阅链接的服务，把得到的链接填进来；这类服务不稳定，随时可能失效。',
  'login-site': '这个站点没有公开的订阅地址，内容需要登录才能看，程序读不到。',
  'wechat': '微信公众号没有公开的订阅地址。可以用第三方把公众号转成订阅链接的服务，把得到的链接填进来；这类服务不稳定，随时可能失效。',
  'private': '这是内网或本机地址，读不到。',
  'cors': '网页版受浏览器限制，不能直接读取这个网站（对方没有开放跨域访问），也可能是网络不通。用手机 App 添加可以读取；或者换一个地址。',
  'timeout': '连接超时：对方网站太慢或在你的网络下打不开。',
  'not-feed': '这个地址返回的不是订阅源（RSS、Atom 或 JSON Feed），网页里也没有找到订阅链接。',
  'empty': '订阅源可以读取，但里面没有文章。',
  'limit': `最多添加 ${MAX_USER} 个自己的渠道，请先删掉不用的。`,
  'dup': '这个渠道已经添加过了。'
};
export function httpReason(status) {
  if (status === 401 || status === 403) return fail('http-' + status, `网站拒绝了程序访问（${status}）：需要登录或付费，或者网站禁止自动读取。这种情况换不了权限，只能换一个公开的订阅地址。`);
  if (status === 404 || status === 410) return fail('http-' + status, `地址不存在（${status}）：订阅地址可能写错了或已经下线。`);
  if (status === 429) return fail('http-429', '访问太频繁被对方限流（429），稍后再试。');
  if (status >= 500) return fail('http-' + status, `对方服务器出错（${status}），稍后再试。`);
  return fail('http-' + status, `对方返回了 ${status}。`);
}
export function checkUrl(url) {
  let u; try { u = new URL(String(url).trim()); } catch (e) { return fail('bad-url', REASONS['bad-url']); }
  if (u.protocol === 'http:') return fail('not-https', REASONS['not-https']);
  if (u.protocol !== 'https:') return fail('bad-url', REASONS['bad-url']);
  const h = u.hostname.toLowerCase();
  if (/(^|\.)(x|twitter)\.com$/.test(h)) return fail('x-site', REASONS['x-site']);
  if (h === 'mp.weixin.qq.com' || h === 'weixin.qq.com') return fail('wechat', REASONS['wechat']);
  if (/(^|\.)(weibo\.com|instagram\.com|facebook\.com|linkedin\.com|tiktok\.com|douyin\.com|xiaohongshu\.com)$/.test(h)) return fail('login-site', REASONS['login-site']);
  if (/^(localhost|127\.|10\.|192\.168\.|169\.254\.)/.test(h) || /^172\.(1[6-9]|2\d|3[01])\./.test(h)) return fail('private', REASONS['private']);
  return null;
}

/* ---------- 解析订阅源 ---------- */
const ENT = { amp: '&', lt: '<', gt: '>', quot: '"', apos: "'", nbsp: ' ' };
const dec = s => s.replace(/&(#x[0-9a-f]+|#\d+|[a-z]+);/gi, (m, e) => {
  if (e[0] === '#') { const n = e[1].toLowerCase() === 'x' ? parseInt(e.slice(2), 16) : parseInt(e.slice(1), 10); return n > 0 && n < 0x110000 ? String.fromCodePoint(n) : ''; }
  return ENT[e.toLowerCase()] ?? m;
});
// 订阅源里的正文常常是转义过的 HTML（&lt;p&gt;…）：先去掉真标签，解码，再去一次标签
const text = s => dec(dec(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1').replace(/<[^>]*>/g, ' ')).replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
const raw = s => dec(String(s || '').replace(/<!\[CDATA\[([\s\S]*?)\]\]>/g, '$1')).trim();
const tag = (s, name) => { const m = s.match(new RegExp(`<${name}(?:\\s[^>]*)?>([\\s\\S]*?)</${name}>`, 'i')); return m ? m[1] : ''; };
const day = v => { const t = Date.parse(raw(v)); return Number.isFinite(t) ? new Date(t).toISOString().slice(0, 10) : ''; };
const abs = (u, base) => { if (!u) return ''; try { const x = new URL(u, base); return /^https?:$/.test(x.protocol) ? x.href : ''; } catch (e) { return ''; } };

export function parseFeed(body, { base = 'https://example.com/', today = new Date().toISOString().slice(0, 10) } = {}) {
  const t = String(body || '').replace(/^﻿/, '').trim();
  let title = '', items = [];
  if (t.startsWith('{')) {
    let j; try { j = JSON.parse(t); } catch (e) { throw fail('not-feed', REASONS['not-feed']); }
    if (!j || !Array.isArray(j.items)) throw fail('not-feed', REASONS['not-feed']);
    title = String(j.title || '');
    items = j.items.map(x => ({ t: text(x.title), u: abs(x.url || x.external_url, base), d: day(x.date_published || x.date_modified) || today, s: text(x.summary || x.content_text || x.content_html).slice(0, 300) }));
  } else {
    const atom = /<feed[\s>]/i.test(t);
    if (!atom && !/<(rss|rdf:RDF|channel)[\s>]/i.test(t)) throw fail('not-feed', REASONS['not-feed']);
    const blocks = t.match(atom ? /<entry[\s>][\s\S]*?<\/entry>/gi : /<item[\s>][\s\S]*?<\/item>/gi) || [];
    const head = t.slice(0, t.search(atom ? /<entry[\s>]/i : /<item[\s>]/i) >= 0 ? t.search(atom ? /<entry[\s>]/i : /<item[\s>]/i) : t.length);
    title = text(tag(head, 'title'));
    items = blocks.map(b => {
      let link = '';
      if (atom) {
        const ls = [...b.matchAll(/<link\b[^>]*>/gi)].map(m => m[0]);
        const pick = ls.find(l => /rel=["']alternate["']/i.test(l)) || ls.find(l => !/rel=/i.test(l)) || ls[0] || '';
        link = (pick.match(/href=["']([^"']+)["']/i) || [])[1] || '';
      } else link = raw(tag(b, 'link')) || (b.match(/<guid[^>]*isPermaLink=["']true["'][^>]*>([\s\S]*?)<\/guid>/i) || [])[1] || '';
      const when = tag(b, 'pubDate') || tag(b, 'dc:date') || tag(b, 'published') || tag(b, 'updated');
      return { t: text(tag(b, 'title')), u: abs(raw(link), base), d: day(when) || today, s: text(tag(b, 'description') || tag(b, 'summary') || tag(b, 'content:encoded') || tag(b, 'content')).slice(0, 300) };
    });
  }
  items = items.filter(x => x.t && x.u).slice(0, 40);
  return { title, items };
}
// 网页里的订阅链接：<link rel="alternate" type="application/rss+xml" href="…">
export function feedLinkFromHtml(html, base) {
  for (const m of String(html || '').matchAll(/<link\b[^>]*>/gi)) {
    const l = m[0];
    if (/rel=["']alternate["']/i.test(l) && /type=["']application\/(rss|atom)\+xml["']|type=["']application\/(feed|json)\+json["']|type=["']application\/json["']/i.test(l)) {
      const h = (l.match(/href=["']([^"']+)["']/i) || [])[1];
      const u = h && abs(dec(h), base); if (u && u.startsWith('https://')) return u;
    }
  }
  return '';
}
export const looksHtml = s => /^\s*(<!doctype html|<html)/i.test(String(s || ''));
