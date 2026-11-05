// 资讯渠道：看到所有来源，关掉不想要的，添加自己订阅的（RSS / Atom / JSON Feed）。
// 添加和删除可以手动点，也可以让学习 Agent 来做（Agent 只给出方案，点确认才生效）；做不到时会说明原因。
import { $, esc, ago } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { isNative } from '../native.js';
import { uid } from '../core/ids.js';
import { MAX_USER, offKey, checkUrl, parseFeed, feedLinkFromHtml, looksHtml, httpReason, fail, REASONS } from '../core/channels.js';
import { act, refresh, toast } from './kit.js';

let CACHE = {};   // 每个自选渠道最近一次读取的结果 { id: { at, items, err } }，只存在这台设备
const TTL = 3600e3, KEEP_DAYS = 45;

/* ---------- 读网页 ---------- */
const nativeFetch = () => { const c = window.Capacitor; return isNative() && c && ((c.Plugins && c.Plugins.AppUpdate) || (c.registerPlugin && c.registerPlugin('AppUpdate'))); };
async function getText(url) {
  const up = nativeFetch();
  if (up) {
    try { return (await up.fetchText({ url })).text; }
    catch (e) {
      const m = String((e && e.message) || e), s = m.match(/服务器返回 (\d+)/);
      if (s) throw httpReason(+s[1]);
      if (/timed? ?out|超时/i.test(m)) throw fail('timeout', REASONS.timeout);
      throw fail('net', `读取失败：${m}`);
    }
  }
  const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 12000);
  try {
    const r = await fetch(url, { signal: ctl.signal, credentials: 'omit' });
    if (!r.ok) throw httpReason(r.status);
    return await r.text();
  } catch (e) {
    if (e && e.code) throw e;
    throw e && e.name === 'AbortError' ? fail('timeout', REASONS.timeout) : fail('cors', REASONS.cors);
  } finally { clearTimeout(tm); }
}
// 检查一个地址能不能当订阅源；给的是网站首页时，试着找页面里的订阅链接。成功返回 { feedUrl, title, items }，失败抛出带原因的错误
export async function probeFeed(url) {
  url = String(url || '').trim();
  const bad = checkUrl(url); if (bad) throw bad;
  let body = await getText(url), feedUrl = url;
  if (looksHtml(body)) {
    const alt = feedLinkFromHtml(body, url);
    if (!alt) throw fail('not-feed', REASONS['not-feed']);
    const b2 = checkUrl(alt); if (b2) throw b2;
    feedUrl = alt; body = await getText(alt);
  }
  const r = parseFeed(body, { base: feedUrl, today: new Date().toISOString().slice(0, 10) });
  if (!r.items.length) throw fail('empty', REASONS.empty);
  return { feedUrl, title: r.title, items: r.items };
}

/* ---------- 自选渠道的条目 ---------- */
export const userChannels = () => Object.entries(store.all('channels')).filter(([k]) => k[0] === 'u');
function flatten(C) {
  const out = [];
  for (const [id, c] of userChannels()) {
    const e = CACHE[id]; if (!e || !e.items) continue;
    for (const x of e.items) out.push({ t: x.t, u: x.u, d: x.d, s: x.s || undefined, src: c.name, k: c.tracks.slice(), mine: true });
  }
  C.userNews = out;
}
export async function loadUserNews(C) { CACHE = (await store.localGet('chnNews')) || {}; flatten(C); }
// 读取各个自选渠道（1 小时内读过的不再读）。有变化返回 true
export async function refreshChannels(C, { force = false, only = null } = {}) {
  const cut = new Date(Date.now() - KEEP_DAYS * 864e5).toISOString().slice(0, 10);
  const jobs = userChannels().filter(([id]) => (!only || id === only) && (force || !CACHE[id] || Date.now() - CACHE[id].at > TTL));
  if (!jobs.length) return false;
  await Promise.all(jobs.map(async ([id, c]) => {
    try { const r = await probeFeed(c.url); CACHE[id] = { at: Date.now(), items: r.items.filter(x => x.d >= cut), err: '' }; }
    catch (e) { CACHE[id] = { at: Date.now(), items: (CACHE[id] && CACHE[id].items) || [], err: e.message || String(e) }; }
  }));
  await store.localSet('chnNews', CACHE);
  flatten(C); return true;
}
const content = () => M.C;

/* ---------- 添加 / 关闭 / 恢复 / 删除 ---------- */
export async function addChannel({ name, url, tracks }) {
  if (userChannels().length >= MAX_USER) throw fail('limit', REASONS.limit);
  const r = await probeFeed(url);
  if (userChannels().some(([, c]) => c.url === r.feedUrl)) throw fail('dup', REASONS.dup);
  const ok = (tracks || []).filter(t => M.track(t)), first = (M.tracks()[0] || {}).id;
  const id = 'u' + uid('').slice(0, 14);
  let host = ''; try { host = new URL(r.feedUrl).hostname; } catch (e) {}
  store.put('channels', id, { name: String(name || r.title || host).trim().slice(0, 40) || host, url: r.feedUrl, tracks: ok.length ? ok : (first ? [first] : []), c: Date.now() });
  CACHE[id] = { at: Date.now(), items: r.items, err: '' }; await store.localSet('chnNews', CACHE);
  flatten(content()); M.invalidate();
  return { id, count: r.items.length, feedUrl: r.feedUrl };
}
export function setBuiltin(name, off) { store.put('channels', offKey(name), off ? name : null); }
export function removeUser(id) { const before = store.get('channels', id); store.del('channels', id); delete CACHE[id]; store.localSet('chnNews', CACHE); flatten(content()); M.invalidate(); return before; }

/* ---------- Agent 用 ---------- */
export function allNames() { return [...M.sourceCounts().keys()]; }
export function channelsText() {
  const off = M.offSources(), names = allNames();
  const mine = userChannels().map(([id, c]) => `- ${c.name}｜${c.url}｜方向 ${c.tracks.join('、') || '无'}${CACHE[id] && CACHE[id].err ? '｜上次读取失败：' + CACHE[id].err : ''}`).join('\n') || '（没有）';
  return `内置渠道（共 ${names.length} 个，下面标“已关闭”的用户已经关掉）：\n${names.map(n => n + (off.has(n) ? '（已关闭）' : '')).join('；')}\n\n用户自己添加的渠道：\n${mine}\n\n方向 ID：${M.tracks().map(t => `${t.id}=${t.name}`).join('，')}`;
}
export function channelCard(d) {
  const op = d && d.op === 'remove' ? 'remove' : 'add';
  if (op === 'remove') {
    const key = String(d.name || '').trim();
    const hit = key ? [...new Set([...allNames().filter(n => n === key || n.includes(key)), ...userChannels().map(([, c]) => c.name).filter(n => n === key || n.includes(key))])] : [];
    if (!hit.length) return `<div class="blk"><span class="tag ai">关闭渠道</span> <p class="err small">做不到：现有渠道里没有叫“${esc(key)}”的。可以到“资讯渠道”页看完整清单。</p></div>`;
    return `<div class="blk"><span class="tag ai">关闭渠道</span> <b>${hit.length}</b><ul>${hit.slice(0, 12).map(n => `<li>${esc(n)}</li>`).join('')}</ul>${hit.length > 12 ? `<p class="fnt small">还有 ${hit.length - 12} 个…</p>` : ''}
      <p class="fnt small">只是不再出现在你的资讯里，随时可以在“资讯渠道”页恢复；自己添加的渠道会被删除。</p>
      <div class="pf"><button class="btn sm acc" data-act="blk-channel" data-op="remove" data-name="${esc(key)}">确认关闭</button></div><p class="small chk"></p></div>`;
  }
  const url = String(d.url || '').trim().slice(0, 500), name = String(d.name || '').trim().slice(0, 40);
  const tracks = (Array.isArray(d.tracks) ? d.tracks : []).filter(t => M.track(t));
  const bad = !url ? fail('bad-url', '没有给出订阅地址。') : checkUrl(url) || (userChannels().length >= MAX_USER ? fail('limit', REASONS.limit) : userChannels().some(([, c]) => c.url === url) ? fail('dup', REASONS.dup) : null);
  return `<div class="blk"><span class="tag ai">添加渠道</span> <b>${esc(name || url)}</b><div class="small fnt" style="overflow-wrap:anywhere">${esc(url)}</div>
    ${bad ? `<p class="err small">做不到：${esc(bad.message)}</p>` : `<p class="fnt small">放进：${(tracks.length ? tracks : [(M.tracks()[0] || {}).id]).map(t => esc((M.track(t) || {}).name || t)).join('、')}。点“检查并添加”会先读一遍确认能用。</p>
      <div class="pf"><button class="btn sm acc" data-act="blk-channel" data-op="add" data-name="${esc(name)}" data-url="${esc(url)}" data-tracks="${esc(tracks.join(','))}">检查并添加</button></div><p class="small chk"></p>`}</div>`;
}
act('blk-channel', async el => {
  const d = el.dataset, msg = el.closest('.blk').querySelector('.chk');
  el.disabled = true;
  try {
    if (d.op === 'add') {
      msg.textContent = '正在检查…';
      const r = await addChannel({ name: d.name, url: d.url, tracks: d.tracks ? d.tracks.split(',') : [] });
      msg.innerHTML = `<span style="color:var(--ok)">已添加，读到 ${r.count} 条。</span>`; el.textContent = '已添加'; refresh();
    } else {
      const key = d.name, names = [...new Set(allNames().filter(n => n === key || n.includes(key)))];
      names.forEach(n => setBuiltin(n, true));
      for (const [id, c] of userChannels()) if (c.name === key || c.name.includes(key)) removeUser(id);
      msg.innerHTML = '<span style="color:var(--ok)">已关闭。</span>'; el.textContent = '已关闭'; refresh();
    }
  } catch (e) { el.disabled = false; msg.innerHTML = `<span class="err">做不到：${esc(e.message || e)}</span>`; }
});

/* ---------- 渠道管理页 ---------- */
export function renderChannels() {
  document.documentElement.style.setProperty('--c', '#1B2430');
  const off = M.offSources(), counts = M.sourceCounts(), mine = userChannels(), T = M.tracks();
  const names = [...counts.keys()].sort((a, b) => (off.has(a) - off.has(b)) || (counts.get(b) - counts.get(a)) || a.localeCompare(b, 'zh'));
  const userRow = ([id, c]) => {
    const e = CACHE[id], st = !e ? '还没有读取' : e.err ? `<span class="err">读取失败：${esc(e.err)}</span>` : `${e.items.length} 条 · ${esc(ago(e.at))}`;
    let host = ''; try { host = new URL(c.url).hostname; } catch (er) {}
    return `<li class="chrow"><div class="chm"><b>${esc(c.name)}</b><div class="fnt small">${esc(host)} · ${st}</div><div class="chips" style="margin-top:4px">${c.tracks.map(t => `<span class="tag">${esc((M.track(t) || {}).name || t)}</span>`).join('')}</div></div>
      <div class="cha"><button class="btn sm gh" data-act="chn-refresh" data-id="${id}">刷新</button><button class="btn sm gh" data-act="chn-del" data-id="${id}">删除</button></div></li>`;
  };
  return `<div class="ph"><h1>资讯渠道</h1><span class="mut">决定哪些来源出现在你的资讯里，也可以订阅你自己关注的</span>
      <span class="r"><button class="btn" data-act="chn-agent">让 Agent 帮我管理</button></span></div>
    <div class="g2" style="margin-top:14px;align-items:start">
      <section class="card set"><h3>添加渠道</h3>
        <p class="hint">填订阅地址（RSS、Atom 或 JSON Feed）。填网站首页也行，会试着找页面里的订阅链接。读不了的话会告诉你原因：没有订阅源、需要登录、网站拒绝、地址不对，或网页版的跨域限制。</p>
        <form id="chnForm"><label class="field"><span>订阅地址</span><input name="url" inputmode="url" autocomplete="off" placeholder="https://example.com/feed.xml" required></label>
          <label class="field"><span>名称（可以不填）</span><input name="name" maxlength="40"></label>
          <div class="field"><span>放进哪些方向</span><div class="chips">${T.map((t, i) => `<label class="chip chk"><input type="checkbox" name="tr" value="${t.id}"${i === 0 ? ' checked' : ''}> ${esc(t.short || t.name)}</label>`).join('')}</div></div>
          <div class="sa"><button class="btn pri">检查并添加</button><span id="chnMsg" class="small"></span></div></form>
        <p class="hint">X（推特）账号、微信公众号没有公开的订阅地址，不能直接添加；可以用第三方把它们转成订阅链接的服务，把链接填在这里。这类服务不稳定。</p>
        <h3 style="margin-top:18px">我添加的（${mine.length}/${MAX_USER}）</h3>
        <ul class="lst">${mine.map(userRow).join('') || '<li class="fnt">还没有。</li>'}</ul></section>
      <section class="card set"><h3>内置渠道（${names.length}）</h3>
        <p class="hint">关掉的渠道不再出现在你的资讯、搜索和推荐里，只影响你自己，随时能恢复。</p>
        <input class="nq" id="chnQ" type="search" placeholder="按名称筛选" aria-label="筛选渠道">
        <ul class="lst" id="chnList">${names.map(n => `<li class="chrow${off.has(n) ? ' off' : ''}" data-n="${esc(n.toLowerCase())}"><div class="chm"><b>${esc(n)}</b><div class="fnt small">${counts.get(n)} 条</div></div>
          <div class="cha"><button class="btn sm${off.has(n) ? '' : ' gh'}" data-act="chn-toggle" data-name="${esc(n)}">${off.has(n) ? '恢复' : '关掉'}</button></div></li>`).join('')}</ul></section>
    </div>`;
}
document.addEventListener('input', e => {
  if (e.target.id !== 'chnQ') return;
  const q = e.target.value.trim().toLowerCase();
  document.querySelectorAll('#chnList .chrow').forEach(li => { li.hidden = !!q && !li.dataset.n.includes(q); });
});
document.addEventListener('submit', async e => {
  const f = e.target; if (!(f.matches && f.matches('#chnForm'))) return;
  e.preventDefault();
  const msg = $('#chnMsg'), btn = f.querySelector('button.pri');
  btn.disabled = true; msg.textContent = '正在检查…';
  try {
    const r = await addChannel({ name: f.name.value, url: f.url.value, tracks: [...f.querySelectorAll('input[name=tr]:checked')].map(x => x.value) });
    toast(`已添加，读到 ${r.count} 条`); refresh();
  } catch (er) { btn.disabled = false; msg.innerHTML = `<span class="err">添加不了：${esc(er.message || er)}</span>`; }
});
act('chn-toggle', el => { const n = el.dataset.name, on = !M.offSources().has(n); setBuiltin(n, on); refresh(); toast(on ? `已关闭“${n}”` : `已恢复“${n}”`, () => { setBuiltin(n, !on); refresh(); }); });
act('chn-del', el => { const before = removeUser(el.dataset.id), id = el.dataset.id; refresh(); toast('已删除', () => { store.put('channels', id, before); refreshChannels(content(), { force: true, only: id }).then(() => { M.invalidate(); refresh(); }); refresh(); }); });
act('chn-refresh', async el => { el.disabled = true; await refreshChannels(content(), { force: true, only: el.dataset.id }); M.invalidate(); refresh(); });
act('chn-agent', () => window.dispatchEvent(new CustomEvent('agent:free', { detail: '我想调整资讯渠道：' })));
