// 公共区域：看别人公开的路线和笔记，引用（复制到自己的方向里），公开自己的。
// 只在登录腾讯云开发后可用；不走离线同步，每次打开都直接读服务端。
// 公开的只有路线结构或你选的那篇笔记；进度、学习方法档案、对话纪要永远不公开。
import { $, esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import * as cloud from '../store/cloud.js';
import * as P from '../store/public.js';
import { snapshot, toTrack, validBody, sensitive, bodyText, sortItems, adoptedMap, upstreamNewer } from '../core/public.js';
import { uid } from '../core/ids.js';
import { md } from '../core/md.js';
import { act, refresh, toast } from './kit.js';

let D = { items: [], notes: [], mine: [], recent: {}, err: '', view: null, vers: {} };
const PALETTE = ['#3C6E71', '#B5446E', '#5B7F1F', '#AF6E1A', '#2E6FA7', '#7A4E9C'];

// 进页面前取数据
export async function beforePublic(q) {
  D.err = '';
  if (!cloud.supportsPublic() || !cloud.signedIn()) return;
  try {
    const [items, notes, mine, rec] = await Promise.all([P.list({ kind: 'track', q: q.q || '' }), P.list({ kind: 'note', q: q.q || '' }), P.mine(), P.recent()]);
    D.items = items || []; D.notes = notes || []; D.mine = mine || [];
    D.recent = Object.fromEntries((rec || []).map(r => [r.item_id, +r.n]));
    D.view = q.id ? await P.get(q.id) : null;
    await checkUpstream();
  } catch (e) { D.err = e.message || String(e); }
}
// 引用过的方向：查上游有没有新版本（结果记在本机，方向页也会提示）
export async function checkUpstream() {
  const A = adoptedMap(store.all('tracks')), ids = Object.keys(A);
  if (!ids.length || !cloud.signedIn() || !cloud.supportsPublic()) return;
  const rows = await P.versions(ids).catch(() => []);
  D.vers = Object.fromEntries((rows || []).map(r => [r.id, r]));
  const U = store.ui(); U.upstream = Object.fromEntries((rows || []).filter(r => upstreamNewer(A[r.id], r) && r.status === 'published').map(r => [A[r.id].tid, r.version])); store.saveUi();
}

const sortBy = () => store.ui().pubSort || 'adopt';
function row(x, A) {
  const a = A[x.id], mine = x.author === cloud.uid();
  return `<div class="card mcard"><h4><a href="#/public?id=${x.id}" style="text-decoration:none">${esc(x.title)}</a>${a ? ' <span class="tag a">已引用</span>' : ''}${mine ? ' <span class="tag mine">我的</span>' : ''}${a && upstreamNewer(a, x) ? ' <span class="newp">有更新</span>' : ''}</h4>
    <p>${esc(x.summary || '')}</p>
    <div class="meta">${esc(x.author_name)} · 第 ${x.version} 版 · ${String(x.updated_at).slice(0, 10)} · ${x.adopt_count} 人引用${x.kind === 'track' ? ` · ${x.done_count} 人学完` : ''}${D.recent[x.id] ? ` · 近 30 天 ${D.recent[x.id]} 人` : ''}</div></div>`;
}

export function renderPublic(q = {}) {
  document.documentElement.style.setProperty('--c', '#1B2430');
  const head = `<div class="ph"><h1>公共区域</h1><span class="mut">其他人公开的学习路线和笔记。引用 = 复制一份到你自己的方向里，之后随便改，不影响原作者</span>
    ${cloud.signedIn() && cloud.publicWrite() ? '<span class="r"><button class="btn pri" data-act="pub-new">公开我的路线或笔记</button></span>' : ''}</div>`;
  if (!cloud.supportsPublic()) return head + '<div class="card" style="margin-top:14px;padding:16px 18px"><p>公共区域需要网站接入腾讯云开发。</p></div>';
  if (!cloud.signedIn()) return head + '<div class="card" style="margin-top:14px;padding:16px 18px"><p>先登录才能看和公开。</p><a class="btn" href="#/settings">去设置里登录</a></div>';
  if (D.err) return head + `<p class="note">读不到公共区域：${esc(D.err)}</p>`;
  if (q.id) return head + detail(D.view);
  const A = adoptedMap(store.all('tracks')), by = sortBy();
  const tab = q.tab === 'note' ? 'note' : q.tab === 'mine' ? 'mine' : 'track';
  const L = tab === 'note' ? sortItems(D.notes, by) : tab === 'mine' ? D.mine : sortItems(D.items, by);
  return head + `<nav class="tabs" style="margin-top:10px"><a href="#/public" aria-current="${tab === 'track'}">路线 ${D.items.length}</a><a href="#/public?tab=note" aria-current="${tab === 'note'}">笔记 ${D.notes.length}</a><a href="#/public?tab=mine" aria-current="${tab === 'mine'}">我公开的 ${D.mine.length}</a></nav>
    ${tab === 'mine' ? '' : `<div class="chips" style="margin:12px 0">${[['adopt', '引用最多'], ['done', '学完最多'], ['new', '最近更新']].map(([k, v]) => `<button class="chip" data-act="pub-sort" data-id="${k}" aria-pressed="${by === k}">${v}</button>`).join('')}
      <form data-pubq style="display:inline-flex;gap:6px;margin-left:auto"><input name="q" value="${esc(q.q || '')}" placeholder="搜索标题和简介" style="padding:4px 8px;border:1px solid var(--line);border-radius:8px"><button class="btn sm">搜索</button></form></div>`}
    <div class="g2" style="margin-top:8px">${tab === 'mine' ? L.map(mineRow).join('') : L.map(x => row(x, A)).join('') || '<p class="empty">还没有内容。</p>'}</div>
    <p class="fnt small" style="margin-top:12px">看到不合适的内容可以在详情页举报。公开前会自动检查联系方式、广告和违法内容。</p>`;
}

function mineRow(x) {
  return `<div class="card mcard"><h4><a href="#/public?id=${x.id}" style="text-decoration:none">${esc(x.title)}</a> <span class="tag">${x.kind === 'track' ? '路线' : '笔记'}</span>${x.status !== 'published' ? ` <span class="tag">${x.status === 'hidden' ? '已隐藏' : '已被下架'}</span>` : ''}</h4>
    <div class="meta">第 ${x.version} 版 · ${String(x.updated_at).slice(0, 10)} · ${x.adopt_count} 人引用 · ${x.done_count} 人学完</div>
    <div class="sa">${x.status === 'removed' ? '' : `${x.kind === 'track' ? `<button class="btn sm" data-act="pub-push" data-id="${x.id}">用我现在的路线更新</button>` : ''}
      <button class="btn sm gh" data-act="pub-hide" data-id="${x.id}" data-on="${x.status === 'published'}">${x.status === 'published' ? '隐藏' : '重新公开'}</button>`}
      <button class="btn sm gh" data-act="pub-del" data-id="${x.id}">删除</button></div></div>`;
}

function detail(x) {
  if (!x) return '<p class="empty">这条内容不存在或已被隐藏。<a href="#/public">回到公共区域</a></p>';
  const A = adoptedMap(store.all('tracks')), a = A[x.id], b = x.body || {};
  const content = x.kind === 'note' ? `<div class="md nbody">${md(String(b.text || ''))}</div>`
    : `<p class="lede">${esc(b.goal || '')}</p><ol class="pubst">${(b.stages || []).map(s => `<li><b>${esc(s.title)}</b><p class="small mut">${esc(s.goal)}</p><ul>${s.items.map(i => `<li>${i.mode === 'practice' ? '<span class="tag">实践验证</span> ' : ''}${esc(i.text)}</li>`).join('')}</ul>${s.resources.length ? `<p class="small">资源：${s.resources.map(r => r.url ? `<a href="${esc(r.url)}" target="_blank" rel="noopener">${esc(r.name)}</a>` : esc(r.name)).join('；')}</p>` : ''}</li>`).join('')}</ol>`;
  return `<div class="card" style="margin-top:14px;padding:16px 20px"><a class="fnt small" href="#/public">‹ 公共区域</a>
    <h2 style="margin-top:6px">${esc(x.title)}</h2><div class="meta">${esc(x.author_name)} · 第 ${x.version} 版 · ${String(x.updated_at).slice(0, 10)} · ${x.adopt_count} 人引用${x.kind === 'track' ? ` · ${x.done_count} 人学完` : ''}</div>
    ${x.summary ? `<p>${esc(x.summary)}</p>` : ''}
    <div class="sa">${x.kind === 'track' ? (a ? `<a class="btn sm" href="#/t/${a.tid}">打开我引用的这份</a>${upstreamNewer(a, x) ? `<button class="btn sm acc" data-act="pub-upgrade" data-id="${x.id}">更新到第 ${x.version} 版</button>` : ''}`
      : `<button class="btn sm pri" data-act="pub-adopt" data-id="${x.id}">引用这条路线</button>`) : `<button class="btn sm pri" data-act="pub-note" data-id="${x.id}">存进我的笔记</button>`}
      <button class="btn sm gh" data-act="agent-public" data-id="${x.id}">问 Agent 适不适合我</button>
      ${x.author !== cloud.uid() ? `<button class="btn sm gh" data-act="pub-report" data-id="${x.id}">举报</button>` : ''}</div>
    ${content}</div>`;
}

/* ---------- 公开 ---------- */
function publishForm() {
  const own = M.tracks(), cards = Object.entries(store.all('cards')).sort((a, b) => b[1].c - a[1].c).slice(0, 40);
  return `<div class="ob"><div class="ob-h"><h3>公开到公共区域</h3><button class="x" data-act="pub-close" aria-label="关闭">×</button></div><form class="ob-gen" data-pubform>
    <p class="hint">公开的是一份快照：路线只包括阶段、任务、资源和产出（你跳过的任务不公开，改写和新增的按改后的公开），不包括你的进度、笔记、学习方法和对话纪要。之后可以随时更新、隐藏或删除。</p>
    <label class="field"><span>公开什么</span><select name="src">${own.map(t => `<option value="t:${t.id}">路线：${esc(t.name)}</option>`).join('')}${cards.map(([id, c]) => `<option value="c:${id}">笔记：${esc(c.t.split('\n')[0].slice(0, 40))}</option>`).join('')}</select></label>
    <label class="field"><span>标题</span><input name="title" maxlength="120" required></label>
    <label class="field"><span>简介（适合谁、学完能做什么）</span><textarea name="summary" maxlength="600" rows="3"></textarea></label>
    <label class="field"><span>显示的作者名</span><input name="author" maxlength="40" value="${esc(store.ui().pubName || (cloud.email() || '').split('@')[0])}" required></label>
    <p id="pubMsg" class="small"></p><div class="ob-f"><button type="button" class="btn gh" data-act="pub-close">取消</button><button class="btn pri">公开</button></div></form></div>`;
}
function pubDlg() { let d = $('#pubDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'pubDlg'; document.body.appendChild(d); } return d; }
function payload(src) {
  const [k, id] = src.split(':');
  if (k === 't') { const t = M.track(id); return t && { kind: 'track', track: t.mine ? null : t.id, body: snapshot(t, store.all('overlay')), name: t.name }; }
  const c = store.get('cards', id); return c && { kind: 'note', track: c.at ? (M.findStage(c.at) || {}).t?.id || null : null, body: { text: c.t }, name: c.t.split('\n')[0].replace(/^#+\s*/, '').slice(0, 60) };
}
function check(p, title, summary) {
  if (!p || !validBody(p.kind, p.body)) return '内容是空的，或者格式不对';
  const hit = sensitive([title, summary, bodyText(p.kind, p.body)].join('\n'));
  return hit.length ? `检查到可能不合适的内容（${hit.join('、')}），改掉后再公开` : '';
}
act('pub-new', () => { const d = pubDlg(); d.innerHTML = publishForm(); d.showModal(); const f = d.querySelector('form'); const fill = () => { const p = payload(f.src.value); if (p) f.title.value = p.name; }; f.src.onchange = fill; fill(); });
act('pub-close', () => pubDlg().close());
document.addEventListener('submit', async e => {
  const f = e.target;
  if (f.matches && f.matches('form[data-pubq]')) { e.preventDefault(); location.hash = '#/public' + (f.q.value.trim() ? '?q=' + encodeURIComponent(f.q.value.trim()) : ''); return; }
  if (!(f.matches && f.matches('form[data-pubform]'))) return;
  e.preventDefault();
  const p = payload(f.src.value), title = f.title.value.trim(), summary = f.summary.value.trim(), author = f.author.value.trim(), m = $('#pubMsg');
  const bad = check(p, title, summary); if (bad) { m.innerHTML = `<span class="err">${esc(bad)}</span>`; return; }
  try {
    const r = await P.publish({ kind: p.kind, track: p.track, title, summary, author_name: author, body: p.body });
    store.ui().pubName = author; store.saveUi();
    if (p.kind === 'track') { const U = store.ui(); U.pubOf = { ...(U.pubOf || {}), [f.src.value.slice(2)]: r.id }; store.saveUi(); }
    pubDlg().close(); toast('已公开'); location.hash = '#/public?id=' + r.id;
  } catch (err) { m.innerHTML = `<span class="err">${esc(err.message)}</span>`; }
});
act('pub-push', async el => {
  const id = +el.dataset.id, U = store.ui(), tid = Object.keys(U.pubOf || {}).find(k => U.pubOf[k] === id);
  const t = tid && M.track(tid); if (!t) { toast('找不到对应的本地方向（可能是在别的设备上公开的）'); return; }
  const p = { kind: 'track', body: snapshot(t, store.all('overlay')) }, bad = check(p, '', ''); if (bad) { toast(bad); return; }
  try { const r = await P.update(id, { body: p.body }); toast(`已更新到第 ${r.version} 版`); await beforePublic({ tab: 'mine' }); refresh(); } catch (e) { toast(e.message); }
});
act('pub-hide', async el => { try { await P.update(+el.dataset.id, { status: el.dataset.on === 'true' ? 'hidden' : 'published' }); await beforePublic({}); refresh(); } catch (e) { toast(e.message); } });
act('pub-del', async el => { if (!confirm('删除这条公开内容？已经引用的人手里的副本不受影响。')) return; try { await P.remove(+el.dataset.id); await beforePublic({}); refresh(); toast('已删除'); } catch (e) { toast(e.message); } });

/* ---------- 引用 ---------- */
act('pub-adopt', async el => {
  const x = D.view; if (!x || x.id !== +el.dataset.id) return;
  const tid = 'u' + uid('').slice(0, 10), n = Object.keys(store.all('tracks')).length;
  store.put('tracks', tid, toTrack(x.body, { tid, item: x, color: PALETTE[n % PALETTE.length] }));
  try { await P.adopt(x.id, x.version); } catch (e) { /* 计数失败不影响引用 */ }
  toast('已引用，侧边栏里能看到这个方向'); location.hash = '#/t/' + tid;
});
act('pub-upgrade', async el => {
  const x = D.view || await P.get(el.dataset.id), A = adoptedMap(store.all('tracks')), a = x && A[x.id]; if (!a) return;
  const before = store.get('tracks', a.tid);
  store.put('tracks', a.tid, { ...toTrack(x.body, { tid: a.tid, item: x, color: before.color }), name: before.name });
  P.adopt(x.id, x.version).catch(() => {});
  const U = store.ui(); if (U.upstream) { delete U.upstream[a.tid]; store.saveUi(); }
  refresh(); toast(`已更新到第 ${x.version} 版。阶段和任务的编号不变，你的进度和笔记都保留`, () => { store.put('tracks', a.tid, before); refresh(); });
});
act('pub-note', el => {
  const x = D.view; if (!x) return;
  const id = 'c' + uid(''); store.put('cards', id, { t: `${x.body.text}\n\n——来自公共区域：${x.author_name}《${x.title}》`.slice(0, 20000), at: null, c: Date.now() });
  P.adopt(x.id, x.version).catch(() => {}); toast('已存进笔记');
});
act('pub-report', async el => {
  const why = prompt('举报原因（例如：广告、抄袭、内容违法）'); if (!why || !why.trim()) return;
  try { await P.report(el.dataset.id, why.trim()); toast('已提交，谢谢'); } catch (e) { toast(/duplicate|unique|23505/.test(e.message) ? '你已经举报过这条了' : e.message); }
});
act('pub-sort', el => { store.ui().pubSort = el.dataset.id; store.saveUi(); refresh(); });

// 学完一个引用的方向时，告诉服务端（用于“学完最多”排序）
export function reportDone() {
  if (!cloud.signedIn() || !cloud.supportsPublic()) return;
  const U = store.ui(); U.pubDone = U.pubDone || {};
  for (const [pid, a] of Object.entries(adoptedMap(store.all('tracks')))) {
    const t = M.track(a.tid); if (!t) continue;
    const st = M.state(a.tid), done = st.stages.length > 0 && st.doneStages === st.stages.length;
    if (!!U.pubDone[pid] !== done) { U.pubDone[pid] = done; P.setDone(pid, done).catch(() => {}); }
  }
  store.saveUi();
}
// 给学习 Agent 用：搜公共路线
export async function searchPublic(q) {
  if (!cloud.signedIn() || !cloud.supportsPublic()) return '公共区域需要登录腾讯云开发';
  const L = await P.list({ kind: 'track', q, limit: 8 }).catch(() => null);
  if (!L) return '读不到公共区域';
  return L.map(x => `- [${x.id}] ${x.title}（${x.author_name}，${x.adopt_count} 人引用，${x.done_count} 人学完）：${x.summary.slice(0, 160)}`).join('\n') || '没有找到相关的公共路线';
}
export async function publicText(id) {
  const x = await P.get(id).catch(() => null); if (!x) return '没有这条公共内容';
  if (x.kind === 'note') return `公共笔记《${x.title}》（${x.author_name}）：\n${String(x.body.text).slice(0, 4000)}`;
  return `公共路线《${x.title}》（${x.author_name}，第 ${x.version} 版，${x.adopt_count} 人引用，${x.done_count} 人学完）\n${x.summary}\n` + (x.body.stages || []).map((s, i) => `## 阶段 ${i + 1}：${s.title}\n目标：${s.goal}\n${s.items.map(it => `- ${it.mode === 'practice' ? '[实践] ' : ''}${it.text}`).join('\n')}`).join('\n');
}
