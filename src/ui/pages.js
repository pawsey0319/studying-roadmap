// 前沿路线详情、落地与商机、待确认列表、稍后读
import { esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { act, refresh, toast, newsRow, trackTag, routeTag } from './kit.js';
import { pendingSuggestions, planCard } from './suggest.js';
import { sugRow, stageLabel } from './home.js';
import { reactBar, refsHtml } from './react.js';

const SEGS = [['tl', '进展'], ['learn', '跟踪学习'], ['read', '已读'], ['notes', '笔记']];
export function renderRoute(id) {
  const r = M.routes().find(x => x.id === id);
  if (!r) return `<p class="empty">没有这条前沿路线，可能已被合并。<a href="#/">回到首页</a></p>`;
  const t = M.track(r.track), mine = store.get('routes', id) || {};
  document.documentElement.style.setProperty('--c', t ? t.color : '#8C63C8');
  const news = M.routeNews(id), cut = new Date(M.today.getTime() - 7 * 864e5).toISOString().slice(0, 10);
  const from = M.findStage(r.from);
  const cards = Object.entries(store.all('cards')).filter(([, c]) => c.at === id).sort((a, b) => b[1].c - a[1].c);
  const learn = r.learn || [], un = news.filter(n => !M.isRead(n.id)), rd = news.filter(n => M.isRead(n.id));
  const lim = store.ui().tlMore === id ? 200 : 12;
  const seg = (store.ui().routeSeg || {})[id] || 'tl';
  const cnt = { tl: un.length, learn: learn.length, read: rd.length, notes: cards.length };
  const pane = (k, inner) => `<section class="rpane" data-pane="${k}" aria-label="${SEGS.find(x => x[0] === k)[1]}">${inner}</section>`;
  return `<div class="fnt small crumb"><a href="#/t/${r.track}/frontier">${esc(t ? t.name : '')}</a> / 前沿路线</div>
    <div class="ph rhead"><h1>${esc(mine.name || r.title)}</h1>
      <span class="r"><button class="btn ${mine.follow ? '' : 'acc'}" data-act="route-follow" data-id="${id}">${mine.follow ? '取消跟踪学习' : '跟踪学习'}</button>
        <button class="btn gh" data-act="route-rename" data-id="${id}">改名</button>
        <button class="btn gh" data-act="route-stop" data-id="${id}">${mine.stopped ? '恢复跟踪' : '停止跟踪'}</button></span></div>
    <p class="fnt small">${mine.name ? `原名：${esc(r.title)} · ` : ''}${from ? `从理论阶段“${esc(from.s.title)}”分出 · ` : ''}${news.length} 条进展</p>
    <p class="lede">${esc(r.desc)}</p><div class="rx-row">${reactBar('stage', id)}</div>${refsHtml('stage', id)}
    <div class="rseg seg" role="tablist">${SEGS.map(([k, n]) => `<button role="tab" data-act="route-seg" data-id="${esc(id)}" data-v="${k}" aria-selected="${seg === k}">${n}<em>${cnt[k]}</em></button>`).join('')}</div>
    <div class="dual rview" data-seg="${seg}">
      <div class="rcol">
        ${pane('tl', `<div class="colh"><b>进展时间线</b>未读的在这里，读过的移到“已读”${un.length >= 2 || news.length >= 2 ? `<button class="btn sm acc" style="margin-left:auto" data-act="route-explain" data-id="${id}" title="把最近 8 条进展交给 Agent，讲清楚这条路线最近发生了什么">一键解析最近进展</button>` : ''}</div>
          ${tlist(un, lim, id, cut, news.length ? '这条路线的进展都读过了。' : '还没有进展。新资讯命中这条路线的关键词后会出现在这里。')}`)}
        ${pane('read', `<div class="colh"><b>已读</b>读过的进展</div>${tlist(rd, lim, id, cut, '还没有读过的。')}`)}
      </div>
      <div class="rcol">
        ${pane('learn', `<div class="colh"><b>跟踪学习</b>根据进展整理的学习清单，打勾记录进度</div>
          <div class="card" style="padding:12px 14px">
            <div class="items">${learn.map(i => `<div class="it ${store.isDone(i.id) ? 'on' : ''}"><input type="checkbox" data-done="${i.id}"${store.isDone(i.id) ? ' checked' : ''}><span class="tx">${i.mode === 'practice' ? '<span class="tag">实践验证</span> ' : ''}${i.url ? `<a href="${esc(i.url)}" target="_blank" rel="noopener">${esc(i.text)}</a>` : esc(i.text)}</span></div>`).join('') || '<p class="fnt small">还没有学习清单，每周一的自动更新会补上。</p>'}</div>
            <div class="sa"><button class="btn sm acc" data-act="agent-route" data-id="${id}">让 Agent 根据最新进展更新清单</button></div></div>`)}
        ${pane('notes', `<div class="colh"><b>这条路线上的笔记</b><button class="btn sm gh" style="margin-left:auto" data-act="quick-note" data-id="${id}">＋ 随手记</button></div>
          <div class="card"><ul class="lst">${cards.map(([cid, c]) => `<li><a href="#/notes/${cid}" style="text-decoration:none">${esc(c.t.slice(0, 120))}</a><div class="meta">${new Date(c.c).toLocaleDateString('zh-CN')}</div></li>`).join('') || '<li class="fnt">还没有笔记。</li>'}</ul></div>`)}
      </div>
    </div>`;
}
act('route-seg', el => { const U = store.ui(); U.routeSeg = U.routeSeg || {}; U.routeSeg[el.dataset.id] = el.dataset.v; store.saveUi(); document.querySelectorAll('.rseg [role=tab]').forEach(b => b.setAttribute('aria-selected', b === el)); const v = document.querySelector('.rview'); if (v) v.dataset.seg = el.dataset.v; });

// 落地与商机的一张卡片（双列瀑布流里的一项）：色块封面的高度随内容错落，不用图片
export function bizCard(x) {
  const t = M.track(x.track), h = [56, 84, 112][[...String(x.id || x.title)].reduce((a, c) => a + c.charCodeAt(0), 0) % 3];
  return `<article class="wc biz" style="--lc:${t ? t.color : 'var(--accent)'}"><div class="wc-cover" style="height:${h}px"><span class="wc-kind">${x.kind === 'new' ? '新商机' : '老商机改造'}</span><span class="wc-glyph" aria-hidden="true">${esc(String(x.title).slice(0, 1))}</span></div>
    <div class="wc-b"><h4>${esc(x.title)}</h4><p>${esc(x.desc)}</p>
    <div class="meta">${trackTag(x.track)}${(x.r || []).filter(rid => M.route(rid)).map(routeTag).join('')}${(x.links || []).map(l => `<a href="${esc(l.url)}" target="_blank" rel="noopener">${esc(l.name)}</a>`).join(' ')}</div></div>
    <div class="wc-f"><button class="btn sm acc" data-act="agent-biz" data-id="${esc(x.id)}" title="Agent 先问你三件事，再整理成需求包">做成 demo</button><button class="btn sm gh" data-act="export-open" data-biz="${esc(x.id)}" data-scene="prd">写 PRD</button></div></article>`;
}
export function bizFilter(kf) {
  return [['all', '全部'], ['new', '新商机'], ['old', '老商机改造']].map(([k, v]) => `<button class="chip" data-act="biz-kind" data-id="${k}" aria-pressed="${kf === k}">${v}</button>`).join('');
}

export function renderBiz(q) {
  document.documentElement.style.setProperty('--c', '#1B2430');
  const U = store.ui(), tf = U.bizTrack || 'all', kf = U.bizKind || 'all';
  const items = M.C.biz.items.filter(x => (tf === 'all' || x.track === tf) && (kf === 'all' || x.kind === kf) && M.track(x.track));
  return `<div class="ph"><h1>落地与商机</h1><span class="mut">AI 真正落地的机会：新出现的商机，以及老业务怎么用 AI 改造</span></div>
    <div class="chips" style="margin:14px 0">${[['all', '全部方向'], ...M.tracks().map(t => [t.id, t.short || t.name])].map(([k, v]) => `<button class="chip" data-act="biz-track" data-id="${k}" aria-pressed="${tf === k}">${esc(v)}</button>`).join('')}
      <span style="width:12px"></span>${bizFilter(kf)}</div>
    <div class="wf">${items.map(bizCard).join('') || '<p class="empty">没有符合筛选的条目。</p>'}</div>`;
}

export function renderSuggestions(q = {}) {
  const s = pendingSuggestions();
  const one = s => `<div class="card" id="sug-${esc(s.id)}" style="margin-top:12px;padding:12px 14px${q.id === s.id ? ';outline:2px solid var(--sig)' : ''}">
      <div class="small mut">${s.from === 'weekly' ? `每周自动更新 · ${esc(s.at || '')}` : '学习 Agent 的方案'} ${s.track ? trackTag(s.track) : ''}</div>
      <b>${esc(s.title)}</b>${s.why ? `<p class="small" style="margin:4px 0 0">${esc(s.why)}</p>` : ''}${planCard(s)}</div>`;
  return `<div class="ph"><h1>等你确认</h1><span class="mut">每周自动更新和学习 Agent 提出的修改建议，逐条勾选后点“应用”才会改你的路线，随时能恢复原版</span></div>
    ${s.map(one).join('') || '<div class="card" style="margin-top:14px"><p class="empty">没有待确认的建议。</p></div>'}`;
}

// 路线库：所有公共方向，加进来 / 移出（移出只是不显示，进度和笔记都保留）
export function renderLibrary() {
  document.documentElement.style.setProperty('--c', '#1B2430');
  const L = M.library();
  const card = t => { const on = M.adopted(t.id), rs = M.C.routes.routes.filter(r => r.track === t.id && r.status === 'active');
    return `<div class="card mcard" style="--lc:${t.color}"><h4><span class="dot" style="background:${t.color}"></span> ${esc(t.name)}${on ? ' <span class="tag a">已加入</span>' : ''}</h4>
      <p>${esc(t.goal || '')}</p>
      <p class="small mut">理论路线 ${t.stages.length} 个阶段：${t.stages.map(s => esc(s.title)).join(' → ')}</p>
      <p class="small mut">前沿路线 ${rs.length} 条：${rs.slice(0, 5).map(r => esc(r.title)).join('、')}${rs.length > 5 ? '…' : ''}</p>
      <div class="sa">${on ? `<a class="btn sm" href="#/t/${t.id}">打开</a><button class="btn sm gh" data-act="lib-remove" data-id="${t.id}">移出我的方向</button>`
        : `<button class="btn sm pri" data-act="lib-add" data-id="${t.id}">加入我的方向</button>`}</div></div>`; };
  return `<div class="ph"><h1>路线库</h1><span class="mut">现成的学习方向。加进来后在方向页里可以跳过、改写、新增任务，或者让 Agent 按你的情况调整</span></div>
    <p class="sa" style="margin-top:12px"><button class="btn pri" data-act="new-track">＋ 新建空白路线</button><span class="fnt small">自己定阶段和任务，不经过 Agent；建好后随时能加阶段。</span></p>
    <div class="g2" style="margin-top:14px">${L.map(card).join('')}</div>
    <p class="fnt small" style="margin-top:12px">没有合适的？<a href="#" data-act="onboard">和 Agent 规划一个新方向</a>，或者<a href="#/import">导入你自己的大纲</a>。登录后还可以去<a href="#/public">公共区域</a>看其他人公开的路线。</p>`;
}
act('lib-add', el => { store.setAdopted(el.dataset.id, true); refresh(); toast('已加入，侧边栏里能看到这个方向'); });
act('lib-remove', el => { const id = el.dataset.id; store.setAdopted(id, false); refresh(); toast('已移出。进度和笔记都保留，重新加入就能恢复', () => { store.setAdopted(id, true); refresh(); }); });

// 前沿路线的时间线（一个列表）
function tlist(L, lim, id, cut, empty) {
  const row = n => `<li class="${n.d >= cut ? 'nw' : ''}"><time>${esc(n.d)}${n.d >= cut ? ' · 新' : ''}</time><a href="${esc(n.u)}" target="_blank" rel="noopener" data-act="rd-open" data-id="${n.id}">${esc(n.t)}</a>
    <div class="meta">${n.lvl ? `<span class="tag ${n.lvl.toLowerCase()}">${{ A: '一手来源', B: '权威媒体', C: '社区讨论' }[n.lvl]}</span>` : ''}<span>${esc(n.src || '')}</span>${n.rAuto ? '<span class="tag" title="按关键词自动归类，每周一会由 AI 复核">自动归类</span>' : ''}</div></li>`;
  return L.length ? `<ul class="tline">${L.slice(0, lim).map(row).join('')}</ul>${L.length > lim ? `<button class="btn gh" style="margin:0 0 10px" data-act="tl-more" data-id="${id}">还有 ${L.length - lim} 条</button>` : ''}` : `<p class="fnt small">${esc(empty)}</p>`;
}

export function renderLater() {
  const L = Object.entries(store.all('later')).sort((a, b) => (b[1].at || 0) - (a[1].at || 0));
  return `<div class="ph"><h1>稍后读</h1><span class="mut">在手机上标记的长文和论文，回到电脑上再读</span></div>
    <div class="card" style="margin-top:14px"><ul class="lst">${L.map(([id, x]) => `<li class="${M.isRead(id) ? 'is-read' : ''}"><a href="${esc(x.u)}" target="_blank" rel="noopener" data-act="${M.findItem(id) ? 'rd-open' : 'read'}" data-id="${id}">${esc(x.t)}</a>
      <div class="meta">${new Date(x.at).toLocaleDateString('zh-CN')}<span class="act"><button data-act="later" data-id="${id}">移出</button></span></div></li>`).join('') || '<li class="fnt">没有待读内容。资讯旁的“稍后读”会把它放到这里。</li>'}</ul></div>`;
}

/* ---------- 动作 ---------- */
act('route-follow', el => { const id = el.dataset.id, m = store.get('routes', id) || {}; store.put('routes', id, { ...m, follow: !m.follow, stopped: false }); refresh(); toast(m.follow ? '已取消跟踪学习' : '已加入“在学”'); });
act('route-stop', el => { const id = el.dataset.id, m = store.get('routes', id) || {}; store.put('routes', id, { ...m, stopped: !m.stopped, follow: false }); refresh(); });
act('route-rename', el => {
  const id = el.dataset.id, m = store.get('routes', id) || {};
  const name = prompt('给这条前沿路线起个名字（留空恢复原名）', m.name || M.routeName(id));
  if (name === null) return;
  const next = { ...m }; if (name.trim()) next.name = name.trim().slice(0, 40); else delete next.name;
  store.put('routes', id, Object.keys(next).length ? next : null); refresh();
});
act('sug-view', el => { location.hash = '#/suggestions?id=' + encodeURIComponent(el.dataset.id); });
act('tl-more', el => { store.ui().tlMore = el.dataset.id; store.saveUi(); refresh(); });
act('biz-track', el => { store.ui().bizTrack = el.dataset.id; store.saveUi(); refresh(); });
act('biz-kind', el => { store.ui().bizKind = el.dataset.id; store.saveUi(); refresh(); });
export const _stageLabel = stageLabel;
