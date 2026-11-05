// 工作台：现在学什么
import { esc } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { stageStatus } from '../core/progress.js';
import { nextItems } from '../core/mastery.js';
import { newsRow, trackTag, routeTag, PICK } from './kit.js';
import { pendingSuggestions } from './suggest.js';
import * as cloud from '../store/cloud.js';
import { act } from './kit.js';

// 线路图：每个方向一条线，站点 = 理论阶段；从站点分出的虚线支线 = 前沿路线，黄点 = 7 天内有新进展
export function metroSvg(tracks, opts = {}) {
  const W = 1000, rowH = 78, top = 30, x0 = 150, labelW = 250;
  const maxN = Math.max(...tracks.map(t => t.stages.length), 5);
  const step = Math.min(96, (W - x0 - labelW - 40) / Math.max(maxN - 1, 1));
  let g = '';
  tracks.forEach((t, r) => {
    const st = M.state(t.id), y = top + r * rowH, n = st.stages.length, xe = x0 + (n - 1) * step;
    const c = t.color;
    g += `<a href="#/t/${t.id}" aria-label="${esc(t.name)}"><text x="0" y="${y + 5}" font-size="15" font-weight="700" fill="#1B2430">${esc(t.short || t.name)}</text>
      <text x="0" y="${y + 23}" font-size="11.5" fill="#8A94A3">${st.doneStages}/${n} 理论 · ${M.routes(t.id).filter(x => !x.stopped).length} 前沿</text></a>`;
    g += `<line x1="${x0}" y1="${y}" x2="${xe}" y2="${y}" stroke="${c}" stroke-width="6" stroke-linecap="round"/>`;
    const brs = M.routes(t.id).filter(x => !x.stopped).sort((a, b) => (M.routeHasNew(b.id) - M.routeHasNew(a.id)) || (b.follow - a.follow));
    const shown = brs.slice(0, 3), offs = { 1: [0], 2: [-11, 11], 3: [-20, 0, 20] }[shown.length] || [];
    const lx = W - labelW + 14;
    shown.forEach((b, k) => {
      const si = Math.max(0, st.stages.findIndex(s => s.id === b.from)), sx = x0 + si * step, ey = y + offs[k];
      const nw = M.routeHasNew(b.id);
      g += `<path d="M${sx} ${y} C ${sx + 40} ${y}, ${sx + 40} ${ey}, ${sx + 80} ${ey} L ${lx - 10} ${ey}" fill="none" stroke="${c}" stroke-width="2.5" stroke-dasharray="6 5" opacity=".5"/>`;
      g += `<a class="brl" href="#/r/${encodeURIComponent(b.id)}"><circle cx="${lx - 4}" cy="${ey}" r="4.5" fill="${nw ? '#F0B429' : '#fff'}" stroke="${c}" stroke-width="2"/>
        <text x="${lx + 8}" y="${ey + 4}" font-size="12" fill="#3F4956">${esc(b.title.length > 16 ? b.title.slice(0, 15) + '…' : b.title)}</text></a>`;
    });
    if (brs.length > 3) g += `<a href="#/t/${t.id}"><text x="${lx + 8}" y="${y + 36}" font-size="11" fill="#8A94A3">还有 ${brs.length - 3} 条</text></a>`;
    st.stages.forEach((s, i) => {
      const x = x0 + i * step, k = stageStatus(s, st.current), rad = k === 'now' ? 10 : 7;
      g += `<a class="stn" href="#/t/${t.id}?s=${encodeURIComponent(s.id)}"><title>${esc(s.title)}（${s.prog.n}/${s.prog.total}）</title>
        <circle cx="${x}" cy="${y}" r="${rad}" fill="${k === 'done' ? c : '#fff'}" stroke="${c}" stroke-width="3.5" ${k === 'mastered' ? 'stroke-dasharray="3 3"' : ''}/>
        ${k === 'now' ? `<circle cx="${x}" cy="${y}" r="16" fill="none" stroke="${c}" stroke-width="2" opacity=".25"/>` : ''}</a>`;
    });
  });
  const h = top + tracks.length * rowH - 28;
  return `<svg viewBox="0 0 ${W} ${h}" role="img" aria-label="各方向的学习线路图">${g}</svg>`;
}

// 还没有任何方向：引导用户自己设计路线
function emptyHome() {
  return `<div class="ph"><h1>开始设计你的学习路线</h1></div>
    <div class="card start" style="margin-top:14px;padding:20px 22px">
      <p class="lede" style="margin-top:0">这里还没有任何学习方向。方向和路线都由你决定，三种开始方式：</p>
      <div class="g3" style="margin-top:12px">
        <div class="opt"><b>和 Agent 一起规划</b><p class="small mut">说说你想学什么、学到哪了。Agent 会追问到清楚为止，你确认后才生成路线。</p><button class="btn pri" data-act="onboard">开始规划</button></div>
        <div class="opt"><b>从路线库挑</b><p class="small mut">现成的理论路线和前沿路线，加进来后可以随意裁剪、改写。</p><a class="btn" href="#/library">打开路线库</a></div>
        <div class="opt"><b>导入已有的</b><p class="small mut">把手上的学习大纲、课程目录、文档（HTML、PDF、Word、Markdown）导进来，生成你自己的路线。</p><a class="btn" href="#/import">导入文档</a></div>
      </div></div>`;
}

export function renderHome() {
  const T = M.tracks(), doing = M.doing(), sugs = pendingSuggestions(), un = M.unread();
  if (!T.length) return emptyHome();
  un.sort((a, b) => (M.related(b) - M.related(a)) || (a.d < b.d ? 1 : -1));
  const cards = store.all('cards'), recent = Object.entries(cards).sort((a, b) => b[1].c - a[1].c).slice(0, 4);
  const doingHtml = doing.map(x => {
    if (x.kind === 'stage') {
      // 先是等批改的自测题，再是第一个没掌握的任务（参考 DeepTutor 的下一步优先级）
      const pend = store.ui().quizPending || {}, next = nextItems(x.s, store.all('tests'), store.done(), pend).slice(0, 2);
      const waiting = Object.values(pend).filter(p => p.at === x.s.id).length;
      return `<div class="card dc" style="--lc:${x.t.color}"><div class="k">${esc(x.t.short || x.t.name)} · 理论阶段 ${x.idx}</div><h4>${esc(x.s.title)}</h4>
        ${waiting ? `<p class="small"><button class="lnk" data-act="agent-quiz" data-id="${x.s.id}">有 ${waiting} 道自测题等你作答</button></p>` : ''}
        ${next.map(i => `<label class="it"><input type="checkbox" data-done="${i.id}"><span class="tx">${pend[i.id] ? '<span class="tag ai">待作答</span> ' : ''}${i.mode === 'practice' ? '<span class="tag">实践</span> ' : ''}${esc(i.text)}</span></label>`).join('')}
        <div class="row"><a class="btn sm" href="#/t/${x.t.id}?s=${encodeURIComponent(x.s.id)}">打开</a><button class="btn sm gh" data-act="agent-stage" data-id="${x.s.id}">和 Agent 聊</button><span class="pg">${x.s.prog.n}/${x.s.prog.total} 项</span></div></div>`;
    }
    const left = x.r.learn.filter(i => !store.isDone(i.id));
    return `<div class="card dc" style="--lc:#8C63C8"><div class="k">${esc(x.t.short || x.t.name)} · 前沿路线</div><h4>${esc(x.r.title)} ${M.routeHasNew(x.r.id) ? '<span class="newp">新</span>' : ''}</h4>
      ${left.slice(0, 2).map(i => `<label class="it"><input type="checkbox" data-done="${i.id}"><span class="tx">${esc(i.text)}</span></label>`).join('') || '<p class="small fnt">跟踪学习清单都完成了，有新进展时会自动补充。</p>'}
      <div class="row"><a class="btn sm" href="#/r/${encodeURIComponent(x.r.id)}">打开</a></div></div>`;
  }).join('');
  return mobileHome({ T, doing, sugs, un, recent }) + `<div class="pc-only"><div class="ph"><h1>现在学什么</h1><span class="mut">${doing.length} 项在学，${sugs.length} 条建议等你确认</span>
      <span class="r"><button class="btn" data-act="onboard">和 Agent 规划我的路线</button></span></div>
    <div class="card metro">${metroSvg(T)}
      <div class="legend"><span><i class="f"></i>已学完</span><span><i></i>未学</span><span><i class="d"></i>你标为已掌握</span><span>虚线支线：自动整理出的前沿路线</span><span><i class="y"></i>7 天内有新进展</span></div></div>
    <div class="sh"><h3>在学</h3><span class="fnt small">每个方向的当前理论阶段，以及你在跟踪学习的前沿路线</span></div>
    <div class="doing">${doingHtml || '<div class="card empty">所有阶段都学完了。去各方向的前沿路线挑一条“跟踪学习”。</div>'}</div>
    <div class="g2">
      <div><div class="sh"><h3>等你确认</h3><span class="fnt small">只有你点“应用”才会改路线</span></div>
        <div class="card">${sugs.slice(0, 4).map(sugRow).join('') || '<p class="empty">没有待确认的建议。每周一的自动更新和学习 Agent 会在这里提出建议。</p>'}
        ${sugs.length > 4 ? `<a class="btn gh" style="margin:6px 10px" href="#/suggestions">还有 ${sugs.length - 4} 条</a>` : ''}</div>
        <div class="sh"><h3>最近笔记</h3><span class="r"><a class="btn sm gh" href="#/notes">全部笔记</a></span></div>
        <div class="card"><ul class="lst">${recent.map(([id, c]) => `<li><a href="#/notes/${id}" style="text-decoration:none">${esc(c.t.split('\n')[0].slice(0, 80))}</a>
          <div class="meta">${c.at ? esc(stageLabel(c.at)) : '没有归类'}<span class="act"><button data-act="agent-card" data-id="${id}">和 Agent 聊</button></span></div></li>`).join('') || '<li class="fnt">还没有笔记。按 ⌘J / Ctrl+J 或点右下角“随手记”。</li>'}</ul></div></div>
      <div><div class="sh"><h3>未读资讯</h3><span class="r"><button class="chip" data-act="${PICK.on ? 'pick-cancel' : 'pick-start'}" aria-pressed="${PICK.on}" title="勾选几条你觉得有关联的资讯，让 Agent 讲清楚它们之间的关系">${PICK.on ? '退出多选' : '多选解析'}</button><button class="btn sm gh" data-act="read-all">全部标为已读</button></span></div>
        <div class="card"><ul class="nlist compact">${un.slice(0, 7).map(n => newsRow(n, { showTrack: true, compact: true })).join('') || '<li><span></span><div class="fnt">都读完了。资讯每天早上 8 点更新。</div><span></span></li>'}</ul>
        <div class="chips" style="padding:8px 12px;border-top:1px solid var(--soft)">${T.map(t => `<a class="chip" href="#/t/${t.id}/news" style="text-decoration:none">${esc(t.short || t.name)}资讯</a>`).join('')}</div></div></div>
    </div></div>`;
}

/* ---------- 手机首页：顶部横滑（目前在学 / 最新资讯 / 公共区域），其下最近笔记和待你确认 ---------- */
const PANES = [['doing', '目前在学'], ['news', '最新资讯'], ['pub', '公共区域']];
function ring(x) {
  const isS = x.kind === 'stage', t = x.t;
  const learn = isS ? null : x.r.learn || [], dn = isS ? x.s.prog.n : learn.filter(i => store.isDone(i.id)).length, tot = isS ? x.s.prog.total : learn.length;
  const p = tot ? dn / tot : 0, C = 2 * Math.PI * 29, nw = !isS && M.routeHasNew(x.r.id);
  const href = isS ? `#/t/${t.id}?s=${encodeURIComponent(x.s.id)}` : `#/r/${encodeURIComponent(x.r.id)}`;
  return `<a class="rg" href="${href}" style="--lc:${t.color}"><svg width="72" height="72" viewBox="0 0 72 72" aria-hidden="true"><circle cx="36" cy="36" r="29" fill="none" stroke="var(--line)" stroke-width="5"/>
      <circle cx="36" cy="36" r="29" fill="none" stroke="${t.color}" stroke-width="5" stroke-linecap="round" stroke-dasharray="${(C * p).toFixed(1)} ${C.toFixed(1)}" transform="rotate(-90 36 36)"/>
      ${nw ? '<circle cx="60" cy="12" r="6" fill="var(--sig)" stroke="var(--card)" stroke-width="2"/>' : ''}<text x="36" y="41" text-anchor="middle" font-size="14" font-weight="600" fill="var(--ink)">${dn}/${tot}</text></svg>
    <span class="rg-t">${esc(isS ? x.s.title : x.r.title)}</span><span class="rg-k"><span>${esc(t.short || t.name)}</span> · <span>${isS ? '理论' : '前沿'}</span></span></a>`;
}
function mobileHome({ T, doing, sugs, un, recent }) {
  const pub = cloud.supportsPublic();
  const doingP = doing.length ? `<div class="rgs">${doing.map(ring).join('')}</div>` : '<p class="empty">所有阶段都学完了。去领域里挑一条前沿路线“跟踪学习”。</p>';
  const newsP = `<ul class="nlist compact">${un.slice(0, 4).map(n => newsRow(n, { showTrack: true, compact: true })).join('') || '<li><span></span><div class="fnt">都读完了。资讯每天早上 8 点更新。</div><span></span></li>'}</ul>
    <div class="chips pane-f">${T.map(t => `<a class="chip" href="#/t/${t.id}/news" style="text-decoration:none">${esc(t.short || t.name)}</a>`).join('')}</div>`;
  const pubP = `<p class="mut">别人公开的学习路线，可以采用到自己的方向里，也可以看到他们的更新。</p>
    <p class="fnt small" style="margin:6px 0 12px">${pub ? '正式版开放发布和收藏，现在可以预览。' : '登录云端之后才能使用。'}</p>
    <a class="btn pri" href="${pub ? '#/public' : '#/settings'}">${pub ? '打开公共区域' : '去登录'}</a>`;
  const body = { doing: doingP, news: newsP, pub: pubP };
  return `<div class="m-only mh">
    <div class="hseg" role="tablist">${PANES.map(([k, n], i) => `<button role="tab" data-act="h-go" data-i="${i}" aria-selected="${i === 0}">${n}</button>`).join('')}</div>
    <div class="hstrip" id="hstrip">${PANES.map(([k, n]) => `<section class="hpane card" aria-label="${n}">${body[k]}</section>`).join('')}</div>
    <div class="sh"><h3>最近笔记</h3><span class="r"><a class="btn sm gh" href="#/notes">全部</a></span></div>
    <div class="card"><ul class="lst">${recent.slice(0, 4).map(([id, c]) => `<li><a href="#/notes/${id}" style="text-decoration:none">${esc(c.t.split('\n')[0].slice(0, 80))}</a>
      <div class="meta">${c.at ? esc(stageLabel(c.at)) : '没有归类'}</div></li>`).join('') || '<li class="fnt">还没有笔记。点右下角的“＋”随手记一条。</li>'}</ul></div>
    <div class="sh"><h3>待你确认</h3><span class="fnt small">点“应用”才会改路线</span></div>
    <div class="card">${sugs.slice(0, 3).map(sugRow).join('') || '<p class="empty">没有待确认的建议。每周一的自动更新和学习 Agent 会在这里提出建议。</p>'}
      ${sugs.length > 3 ? `<a class="btn gh" style="margin:6px 10px" href="#/suggestions">还有 ${sugs.length - 3} 条</a>` : ''}</div></div>`;
}
act('h-go', el => { const s = document.getElementById('hstrip'); if (s) s.scrollTo({ left: s.clientWidth * +el.dataset.i * 0.9, behavior: 'smooth' }); });
document.addEventListener('scroll', e => {
  const s = e.target; if (!(s && s.id === 'hstrip')) return;
  const w = s.firstElementChild ? s.firstElementChild.offsetWidth + 10 : 1, i = Math.min(PANES.length - 1, Math.round(s.scrollLeft / w));
  document.querySelectorAll('.hseg [role=tab]').forEach((b, k) => b.setAttribute('aria-selected', k === i));
}, true);

// 手机：每个方向一个圆环，圆环 = 理论进度，黄点 = 前沿有新进展
export function ringsHtml(tracks) {
  return tracks.map(t => {
    const st = M.state(t.id), p = st.stages.length ? st.doneStages / st.stages.length : 0, C = 2 * Math.PI * 22;
    const nw = M.routes(t.id).some(r => !r.stopped && M.routeHasNew(r.id));
    return `<a href="#/t/${t.id}"><svg width="58" height="58" viewBox="0 0 58 58" aria-hidden="true"><circle cx="29" cy="29" r="22" fill="none" stroke="#DDE2E8" stroke-width="6"/>
      <circle cx="29" cy="29" r="22" fill="none" stroke="${t.color}" stroke-width="6" stroke-linecap="round" stroke-dasharray="${C * p} ${C}" transform="rotate(-90 29 29)"/>
      ${nw ? '<circle cx="49" cy="9" r="5" fill="#F0B429" stroke="#fff" stroke-width="2"/>' : ''}<text x="29" y="34" text-anchor="middle" font-size="13" font-weight="700" fill="#1B2430">${st.doneStages}/${st.stages.length}</text></svg>
      ${esc(t.short || t.name)}</a>`;
  }).join('');
}

export function stageLabel(id) {
  const f = M.findStage(id); if (f) return `${f.t.short || f.t.name} / ${f.s.title}`;
  const r = M.route(id); if (r) return `${(M.track(r.track) || {}).short || ''} / 前沿：${M.routeName(id)}`;
  return id;
}

export function sugRow(s) {
  return `<div class="sug"><span class="ic">${s.from === 'weekly' ? '周' : 'AI'}</span><div class="bd"><b>${esc(s.title)}</b> ${s.track ? trackTag(s.track) : ''} ${s.route ? routeTag(s.route) : ''}<p>${esc(s.why || '')}</p></div>
    <div class="acts"><button class="btn sm" data-act="sug-view" data-id="${esc(s.id)}">看详情</button><button class="btn sm pri" data-act="sug-apply" data-id="${esc(s.id)}">应用</button><button class="btn sm gh" data-act="sug-drop" data-id="${esc(s.id)}">忽略</button></div></div>`;
}
