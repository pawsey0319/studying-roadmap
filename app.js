/* 学习路线站点逻辑。数据在 data/*.js，进度和笔记存在浏览器 localStorage（可导出备份）。 */
(function () {
  'use strict';
  const WEEKS = 26;
  const KEY = 'learning-hub.v1';
  const T = HUB.tracks;
  const $ = (s, el = document) => el.querySelector(s);
  const esc = s => String(s ?? '').replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const safeUrl = u => /^https?:\/\//i.test(u || '') ? u : '';
  const link = (name, url) => safeUrl(url) ? `<a href="${esc(url)}" target="_blank" rel="noopener">${esc(name)}</a>` : esc(name);

  /* ---------- 状态 ---------- */
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const iso = d => new Date(d.getTime() - d.getTimezoneOffset() * 6e4).toISOString().slice(0, 10);
  let S;
  try { S = JSON.parse(localStorage.getItem(KEY)) || {}; } catch (e) { S = {}; }
  S = Object.assign({ start: iso(today), done: {}, notes: {}, open: {}, tab: T[0].id, filter: {}, mt: {} }, S);
  // mt 记录每项进度最后修改的时间，用于多设备合并：同一项以较新的修改为准
  const touch = k => { S.mt[k] = Date.now(); };
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(S)); } catch (e) {} };
  save();

  const curWeek = () => {
    const st = new Date(S.start + 'T00:00:00');
    return Math.floor((today - st) / 864e5 / 7) + 1;
  };
  const tkey = (t, si, kind, i) => `${t.id}.${si}.${kind}.${i}`;
  const stageTasks = (t, si) => {
    const s = t.stages[si];
    return [...s.tech.map((_, i) => tkey(t, si, 'tech', i)), ...s.prod.map((_, i) => tkey(t, si, 'prod', i))];
  };
  const pct = keys => keys.length ? keys.filter(k => S.done[k]).length / keys.length : 0;
  const trackKeys = t => t.stages.flatMap((_, si) => stageTasks(t, si));

  /* ---------- 顶部 26 周总图 ---------- */
  function renderGantt() {
    const w = curWeek();
    $('#weekLabel').textContent = w < 1 ? '尚未开始' : w > WEEKS ? `已走完 ${WEEKS} 周` : `第 ${w} 周 / ${WEEKS}`;
    $('#startDate').value = S.start;
    $('#ticks').innerHTML = Array.from({ length: WEEKS }, (_, i) =>
      `<span>${(i + 1) % 2 === 1 || i === WEEKS - 1 ? i + 1 : ''}</span>`).join('');
    const rows = T.map(t => {
      const segs = t.stages.map((s, si) => {
        const p = Math.round(pct(stageTasks(t, si)) * 100);
        const now = w >= s.w[0] && w <= s.w[1];
        return `<span class="seg${now ? ' now' : ''}" style="grid-column:${s.w[0]}/${s.w[1] + 1}" title="${esc(s.t)}：完成 ${p}%"><i style="width:${p}%"></i><b>${esc(s.t)}</b></span>`;
      }).join('');
      const p = Math.round(pct(trackKeys(t)) * 100);
      return `<button class="g-row" data-tab="${t.id}" style="--rc:${t.color}" aria-current="${S.tab === t.id}">
        <span class="g-name">${esc(t.name)}</span><span class="g-bar">${segs}</span><span class="g-pct">${p}%</span></button>`;
    }).join('');
    const needle = w >= 1 && w <= WEEKS
      ? `<div class="needle-wrap"><span class="needle" style="left:calc(${(w - 0.5) / WEEKS * 100}% - 1px)" aria-hidden="true"></span></div>` : '';
    $('#gBody').innerHTML = rows + needle;
    const all = T.flatMap(trackKeys), doneN = all.filter(k => S.done[k]).length;
    const nowStages = T.map(t => {
      const s = t.stages.find(s => w >= s.w[0] && w <= s.w[1]);
      return s ? `${t.short}：${s.t}（${t.hours} 小时）` : '';
    }).filter(Boolean);
    $('#gFoot').innerHTML = `<span><strong>总进度 ${doneN}/${all.length}</strong> 个任务</span>` +
      (nowStages.length ? `<span>本周：${nowStages.map(esc).join('，')}</span>` : '');
  }

  /* ---------- 板块切换 ---------- */
  function renderTabs() {
    $('#tabs').innerHTML = T.map(t =>
      `<button class="tab" role="tab" id="tab-${t.id}" data-tab="${t.id}" style="--tc:${t.color}" aria-selected="${S.tab === t.id}" aria-controls="panel">${esc(t.name)}<small>每周 ${t.hours} 小时</small></button>`).join('');
  }
  function setTab(id, scroll) {
    S.tab = id; save();
    renderTabs(); renderGantt(); renderPanel();
    if (scroll) $('nav.tabs').scrollIntoView({ behavior: 'smooth', block: 'start' });
  }
  /* ---------- 板块正文 ---------- */
  function taskHtml(t, si, kind, i, text) {
    const k = tkey(t, si, kind, i), on = !!S.done[k];
    return `<label class="task${on ? ' on' : ''}"><input type="checkbox" data-k="${k}"${on ? ' checked' : ''}><span>${esc(text)}</span></label>`;
  }
  function stageHtml(t, s, si, w) {
    const keys = stageTasks(t, si), p = pct(keys), n = keys.filter(k => S.done[k]).length;
    const now = w >= s.w[0] && w <= s.w[1];
    const okey = `${t.id}.${si}`;
    const open = S.open[okey] ?? now;
    const res = s.res.map(r => r[1]
      ? `<li>${link(r[0], r[1])}</li>`
      : `<li class="nolink">${esc(r[0])}<em>（无链接，按名称查找）</em></li>`).join('');
    return `<li class="stage${p === 1 ? ' done' : ''}${now ? ' now' : ''}" data-open="${open}">
      <div class="wk"><b>${s.w[0]}–${s.w[1]}</b>周</div>
      <div class="card">
        <button class="s-sum" data-open-key="${okey}" aria-expanded="${open}">
          <h4>${esc(s.t)}</h4><span class="prog">${n}/${keys.length}${now ? ' · 进行中' : ''}</span><span class="chev" aria-hidden="true">›</span>
        </button>
        <div class="minibar"><i style="width:${p * 100}%"></i></div>
        <div class="s-body">
          <p class="s-goal">${esc(s.goal)}</p>
          <div class="cols">
            <div class="col"><h5>技术<span>${s.tech.length} 项</span></h5>${s.tech.map((x, i) => taskHtml(t, si, 'tech', i, x)).join('')}</div>
            <div class="col"><h5>产品<span>${s.prod.length} 项</span></h5>${s.prod.map((x, i) => taskHtml(t, si, 'prod', i, x)).join('')}</div>
          </div>
          <div class="res"><h5>学习资源</h5><ul>${res}</ul></div>
          <div class="out"><b>阶段产出</b>${esc(s.out)}</div>
          <div class="notes"><textarea data-note="${okey}" placeholder="写下这一阶段的笔记、卡点或心得，自动保存">${esc(S.notes[okey] || '')}</textarea></div>
        </div>
      </div></li>`;
  }
  const itemHtml = x => `<div class="card item"><h4>${esc(x.t)}</h4><p>${esc(x.d)}</p>${x.l && x.l.length ? `<div class="links">${x.l.map(l => link(l[0], l[1])).join('')}</div>` : ''}</div>`;

  const TYPES = { news: '资讯', paper: '论文', dir: '新方向', biz: '商机' };
  const LVL = { A: '一手来源', B: '权威媒体', C: '社区讨论' };
  const LVL_TIP = { A: '官方发布、论文原文、监管机构或项目仓库', B: '权威媒体、研究机构或知名研究者', C: 'Reddit、Lobsters 等社区的高票讨论，只代表关注度，内容未经核实' };
  const daysAgo = d => (today - new Date((d.length === 7 ? d + '-01' : d.length === 4 ? d + '-01-01' : d) + 'T00:00:00')) / 864e5;
  // 时间分组：近 7 天、近 30 天默认展开，其余折叠
  const GROUPS = [
    { id: 'w', name: '最近 7 天', max: 7, open: true },
    { id: 'm', name: '最近 30 天', max: 30, open: true },
    { id: 'q', name: '1–3 个月前', max: 92, open: false },
    { id: 'o', name: '3 个月以前', max: Infinity, open: false }
  ];
  const lvlBadge = l => l ? `<span class="lvl lvl-${String(l).toLowerCase()}" title="${esc(LVL_TIP[l] || '')}">${esc(LVL[l] || l)}</span>` : '';
  function feedRow(x) {
    return `<li><time>${esc(x.d)}</time><div>
        <div class="ft"><span class="tag">${TYPES[x.type] || '资讯'}</span>${link(x.t, x.u)}</div>
        <div class="fs">${esc(x.s)}</div>
        <div class="fsrc">${lvlBadge(x.lvl)}<span>${esc(x.src || '')}</span></div></div></li>`;
  }
  function feedHtml(t) {
    const f = S.filter[t.id] || 'all';
    const all = HUB.feed.items.filter(x => x.k === t.id);
    const items = all.filter(x => f === 'all' || x.type === f).sort((a, b) => (a.d < b.d ? 1 : -1));
    const chips = ['all', ...Object.keys(TYPES)].map(k => {
      const n = k === 'all' ? all.length : all.filter(x => x.type === k).length;
      return `<button class="chip" data-filter="${k}" aria-pressed="${f === k}">${k === 'all' ? '全部' : TYPES[k]} ${n}</button>`;
    }).join('');
    if (!items.length) return `<div class="feedbar">${chips}</div><div class="feed-groups"><p class="fs">这个分类暂时没有条目。每周一的自动更新会补充新内容，也可以直接编辑 data/feed.js 添加。</p></div>`;
    let lo = -Infinity;
    const groups = GROUPS.map(g => {
      const its = items.filter(x => { const a = daysAgo(x.d); return a > lo && a <= g.max; });
      lo = g.max;
      if (!its.length) return '';
      const key = `${t.id}.${g.id}`;
      const open = S.open['feed.' + key] ?? g.open;
      return `<details class="fgroup" data-gkey="${key}"${open ? ' open' : ''}><summary><span>${g.name}</span><small>${its.length} 条</small></summary><ul class="feed">${its.map(feedRow).join('')}</ul></details>`;
    }).join('');
    return `<div class="feedbar">${chips}</div><div class="feed-groups">${groups}</div>`;
  }

  /* ---------- 官方博客与媒体快照（tools/fetch_sources.py 每天生成 data/sources.js） ---------- */
  function snapHtml(t) {
    const H = HUB.sources;
    if (!H || !H.items) return `<p class="msg">还没有快照。在“学习”文件夹运行 <code>python3 learning-hub/tools/fetch_sources.py</code> 生成，或等每日定时任务运行。</p>`;
    const lvF = S.snapLvl && S.snapLvl[t.id] || 'all';
    const its = H.items.filter(x => x.k.includes(t.id) && (lvF === 'all' || x.lvl === lvF));
    const srcF = S.snapSrc && S.snapSrc[t.id] || 'all';
    const names = [...new Set(its.map(x => x.src))];
    const shown = its.filter(x => srcF === 'all' || x.src === srcF);
    const limit = S.snapMore && S.snapMore[t.id] ? 60 : 12;
    const sel = `<select data-snapsrc aria-label="按来源筛选"><option value="all">全部来源（${its.length}）</option>${names.map(n =>
      `<option value="${esc(n)}"${n === srcF ? ' selected' : ''}>${esc(n)}（${its.filter(x => x.src === n).length}）</option>`).join('')}</select>`;
    const rows = shown.slice(0, limit).map(x => `<li><time>${esc(x.d.slice(5))}</time><div>${lvlBadge(x.lvl)}<span class="ssrc">${esc(x.src)}</span>${link(x.t, x.u)}</div></li>`).join('');
    const more = shown.length > limit ? `<button class="btn" data-snapmore>显示更多（共 ${shown.length} 条）</button>`
      : (limit > 12 && shown.length > 12 ? `<button class="btn" data-snapmore>收起</button>` : '');
    const base = H.items.filter(x => x.k.includes(t.id));
    const lvls = ['all', 'A', 'B', 'C'].map(l => `<button class="chip" data-snaplvl="${l}" aria-pressed="${lvF === l}">${l === 'all' ? '全部' : LVL[l]} ${l === 'all' ? base.length : base.filter(x => x.lvl === l).length}</button>`).join('');
    return `<div class="snapbar">${lvls}${sel}<span class="msg">快照时间 ${esc(H.updated)}，共 ${H.sources.length} 个来源，只保留近 45 天</span></div>
      ${rows ? `<ul class="snap">${rows}</ul>` : `<p class="msg snapempty">${lvF === 'C' ? '最近一次抓取没有拿到与本板块相关的社区讨论（Reddit 有时会限流），明天自动重试。' : '这个来源近期没有与本板块相关的内容。'}</p>`}${more}`;
  }

  function renderPanel() {
    const t = T.find(x => x.id === S.tab) || T[0];
    document.documentElement.style.setProperty('--c', t.color);
    $('#panel').setAttribute('aria-labelledby', 'tab-' + t.id);
    const w = curWeek(), p = Math.round(pct(trackKeys(t)) * 100);
    $('#panel').innerHTML = `
      <div class="panel-head">
        <div><h2>${esc(t.name)}</h2><p>${esc(t.goal)}</p></div>
        <div class="stat"><b>${p}%</b>本板块完成度</div>
      </div>
      ${t.note ? `<p class="note">${esc(t.note)}</p>` : ''}
      <div class="jump"><a href="#b-route">学习路线</a><a href="#b-live">实时动态</a><a href="#b-feed">精选资讯与论文</a><a href="#b-front">前沿方向</a><a href="#b-biz">落地与商机</a></div>
      <section class="blk" id="b-route"><h3>学习路线</h3><p class="sub">每个阶段分技术和产品两列任务，勾选即记录进度；当前周所在阶段会自动展开。</p>
        <ol class="stages">${t.stages.map((s, si) => stageHtml(t, s, si, w)).join('')}</ol></section>
      <section class="blk" id="b-live"><h3>实时动态</h3><p class="sub">上面 6 个渠道在打开页面时直接从公开接口拉取（1 小时内用缓存），下面的快照由 GitHub 每天北京时间 8 点抓取，包括官方博客、权威媒体、量化研究博客，以及 Reddit、Hacker News、Lobsters 的高票讨论。标签说明来源类型：一手来源指官方或项目原始发布；社区讨论和社区热度只代表关注度，内容未经核实。</p>
        <div class="live">${LIVE.map(c => `<div class="card"><h4><span>${esc(c.name)}<em class="kind">${esc(c.kind)}</em></span><button data-reload="${c.id}" aria-label="刷新${esc(c.name)}">刷新</button></h4><div id="live-${c.id}" class="msg">加载中…</div></div>`).join('')}</div>
        <div class="card snapcard"><h4 class="snaph">官方博客、权威媒体与社区讨论</h4><div id="snap">${snapHtml(t)}</div></div></section>
      <section class="blk" id="b-feed"><h3>精选资讯与论文</h3><p class="sub">逐条打开原文核对过日期和内容，只收一手来源和权威媒体。最近 30 天默认展开，更早的折叠起来。最后更新：${esc(HUB.feed.updated)}。</p>${feedHtml(t)}</section>
      <section class="blk" id="b-front"><h3>前沿方向</h3><p class="sub">学完路线后值得继续深入的方向。</p><div class="grid2">${t.frontier.map(itemHtml).join('')}</div></section>
      <section class="blk" id="b-biz"><h3>落地与商机</h3><p class="sub">AI 真正落地的机会：新出现的商机，以及老业务怎么用 AI 改造。</p>
        <div class="biz"><div><h4 class="cap">新商机</h4>${t.biz.fresh.map(itemHtml).join('')}</div>
        <div><h4 class="cap">老商机改造</h4>${t.biz.old.map(itemHtml).join('')}</div></div></section>`;
    loadLive(t, false);
  }
  /* ---------- 实时动态（公开接口，无需密钥） ---------- */
  const KW = {
    llm: /language model|\bLLMs?\b|reasoning|pre-?train|RLHF|RLVR|distill|attention|mixture-of-experts|\bMoE\b|scaling|interpretab/i,
    slm: /small (language )?models?|\bSLMs?\b|on-device|edge device|distill|quantiz|pruning|fine-?tun|LoRA|domain-specific|\b[0-9](\.[0-9])?B\b/i,
    agent: /agent|tool[- ]use|\bGUI\b|computer[- ]use|web navigation|\bMCP\b|multi-agent/i,
    quant: /financ|trading|\bstocks?\b|portfolio|alpha factor|quantitative|asset pric|hedge fund|backtest/i
  };
  const TTL = 3600e3;
  const cacheGet = k => { try { const c = JSON.parse(localStorage.getItem('lh.c.' + k)); return c && Date.now() - c.t < TTL ? c.v : null; } catch (e) { return null; } };
  const cacheSet = (k, v) => { try { localStorage.setItem('lh.c.' + k, JSON.stringify({ t: Date.now(), v })); } catch (e) {} };
  const getJSON = async u => {
    const ctl = new AbortController(), tm = setTimeout(() => ctl.abort(), 12000);
    try {
      const r = await fetch(u, { signal: ctl.signal });
      if (r.status === 403 && /api\.github\.com/.test(u)) throw new Error('GitHub 匿名访问次数已用完');
      if (!r.ok) throw new Error('HTTP ' + r.status);
      return await r.json();
    } catch (e) { throw e.name === 'AbortError' ? new Error('连接超时') : e; }
    finally { clearTimeout(tm); }
  };
  // 部分网络打不开 huggingface.co，先试主站，失败后换 hf-mirror.com（同一份数据的国内镜像），记住能用的那个
  let HF_BASE = null;
  async function hfJSON(path) {
    const order = HF_BASE ? [HF_BASE] : ['https://huggingface.co', 'https://hf-mirror.com'];
    let err;
    for (const b of order) {
      try { const d = await getJSON(b + path); HF_BASE = b; return d; } catch (e) { err = e; }
    }
    HF_BASE = null; throw err;
  }
  const hfLink = p => (HF_BASE || 'https://huggingface.co') + p;
  const snap = () => (HUB.sources && HUB.sources.items) || [];
  const ago = d => { const h = Math.round((Date.now() - new Date(d)) / 36e5); return h < 24 ? `${Math.max(h, 1)} 小时前` : `${Math.round(h / 24)} 天前`; };

  const SOURCES = {
    async hf(t) {
      let daily, fromSnap = false;
      try { daily = await hfJSON('/api/daily_papers?limit=100'); }
      catch (e) {
        if (!(HUB.sources && HUB.sources.hf && HUB.sources.hf.length)) throw e;
        daily = HUB.sources.hf.map(x => ({ publishedAt: x.d, paper: { id: x.id, title: x.t, summary: x.s, upvotes: x.v } })); fromSnap = true;
      }
      const re = KW[t.id];
      let list = daily.filter(x => re.test(x.paper.title + (t.id === 'quant' ? '' : ' ' + (x.paper.summary || '').slice(0, 300))))
        .sort((a, b) => (b.paper.upvotes || 0) - (a.paper.upvotes || 0))
        .map(x => ({ t: x.paper.title, u: (fromSnap ? 'https://arxiv.org/abs/' : hfLink('/papers/')) + x.paper.id, m: `${x.paper.upvotes || 0} 赞 · ${ago(x.publishedAt)}${fromSnap ? ' · 来自每日快照' : ''}` }));
      if (list.length < 6 && !fromSnap) {
        const s = await hfJSON('/api/papers/search?q=' + encodeURIComponent(t.live.hf)).catch(() => []);
        s.sort((a, b) => new Date(b.paper.publishedAt) - new Date(a.paper.publishedAt));
        for (const x of s) {
          if (list.length >= 6) break;
          if (!list.some(y => y.u.endsWith(x.paper.id)))
            list.push({ t: x.paper.title, u: hfLink('/papers/') + x.paper.id, m: String(x.paper.publishedAt).slice(0, 10) });
        }
      }
      return list.slice(0, 6);
    },
    async hn(t) {
      // 只匹配标题、关闭模糊匹配，多个关键词合并后按时间排序
      const since = Math.floor(Date.now() / 1000) - 21 * 86400;
      const res = await Promise.all(HNQ[t.id].map(q => getJSON('https://hn.algolia.com/api/v1/search_by_date?tags=story&hitsPerPage=10&restrictSearchableAttributes=title&typoTolerance=false'
        + `&numericFilters=${encodeURIComponent(`points>20,created_at_i>${since}`)}&query=` + encodeURIComponent(q))));
      const seen = new Set();
      return res.flatMap(d => d.hits).filter(h => !seen.has(h.objectID) && seen.add(h.objectID) && (!HNX[t.id] || !HNX[t.id].test(h.title)))
        .sort((a, b) => b.created_at_i - a.created_at_i).slice(0, 6)
        .map(h => ({ t: h.title, u: h.url || `https://news.ycombinator.com/item?id=${h.objectID}`, m: `${h.points} 分 · ${ago(h.created_at)}` }));
    },
    async gh(t) {
      const since = iso(new Date(Date.now() - 30 * 864e5));
      const d = await getJSON(`https://api.github.com/search/repositories?sort=stars&order=desc&per_page=6&q=${encodeURIComponent(`topic:${t.live.gh} created:>${since}`)}`);
      return d.items.map(r => ({ t: r.full_name, u: r.html_url, m: `★ ${r.stargazers_count}${r.description ? ' · ' + r.description.slice(0, 60) : ''}` }));
    },
    // Hugging Face 热门模型：官方仓库里正在被大量下载和点赞的模型
    async hfm(t) {
      const ex = '&expand[]=safetensors&expand[]=pipeline_tag&expand[]=trendingScore&expand[]=createdAt';
      const q = HFM[t.id];
      const lists = await Promise.all(q.urls.map(u => hfJSON('/api/models?sort=trendingScore&limit=100' + u + ex)));
      const seen = new Set();
      return lists.flat().sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0)).filter(m => {
        if (seen.has(m.id)) return false; seen.add(m.id);
        if (/uncensored|abliterat|heretic|obliterat/i.test(m.id)) return false;  // 过滤社区去对齐改版
        if (/gguf|exl[23]|awq|gptq|-mlx|fp8|nvfp4|bnb|\d+bpw/i.test(m.id)) return false;  // 过滤量化转换版，只看原始发布
        const fam = m.id.replace(/[-_]?\d+(\.\d+)?[BMK](-[A-Za-z0-9.]+)?$/i, '');  // 同一家族不同尺寸只保留热度最高的一个
        if (seen.has('fam:' + fam)) return false; seen.add('fam:' + fam);
        if ((m.trendingScore || 0) < 5) return false;
        if (m.createdAt && Date.now() - new Date(m.createdAt) > 180 * 864e5) return false;  // 只看近半年发布的模型
        const p = (m.safetensors || {}).total;
        return q.ok(m, p ? p / 1e9 : null);
      }).sort((a, b) => (b.trendingScore || 0) - (a.trendingScore || 0)).slice(0, 6).map(m => {
        const p = (m.safetensors || {}).total;
        const size = !p ? '' : p < 1e9 ? Math.round(p / 1e6) + 'M · ' : (p / 1e9).toFixed(p < 1e10 ? 1 : 0) + 'B · ';
        return { t: m.id, u: hfLink('/') + m.id, m: `${size}热度 ${m.trendingScore || 0} · ${String(m.createdAt || '').slice(0, 10)}` };
      });
    },
    // OpenRouter：各家模型上架到统一 API 的时间与价格，相当于“模型发布与价格”的官方记录
    async or(t) {
      const d = (await getJSON('https://openrouter.ai/api/v1/models')).data;
      const f = OR_FILTER[t.id] || (() => true);
      return d.filter(m => !/:free$/.test(m.id) && f(m)).sort((a, b) => b.created - a.created).slice(0, 6).map(m => {
        const pi = +m.pricing.prompt * 1e6, po = +m.pricing.completion * 1e6;
        return { t: m.name, u: 'https://openrouter.ai/' + m.id, m: `${iso(new Date(m.created * 1000))} 上架 · 输入 $${pi.toFixed(2)} / 输出 $${po.toFixed(2)} 每百万 token · ${Math.round(m.context_length / 1000)}K 上下文` };
      });
    },
    // 关键开源项目的正式版本发布（一手来源）
    async rel(t) {
      const repos = REPOS[t.id];
      let failed = 0;
      const res = await Promise.all(repos.map(r => getJSON(`https://api.github.com/repos/${r}/releases?per_page=3`).catch(() => { failed++; return []; })));
      if (failed === repos.length) {  // 全部失败（多半是匿名次数用完），改用每日快照
        const its = snap().filter(x => / Release$/.test(x.src) && x.k.includes(t.id)).slice(0, 7);
        if (!its.length) throw new Error('GitHub 匿名访问次数已用完，约 1 小时后恢复');
        return its.map(x => ({ t: `${x.src.replace(/ Release$/, '')} ${x.t}`.slice(0, 80), u: x.u, m: `${x.d} · 来自每日快照` }));
      }
      return res.flatMap((list, i) => list.filter(x => !x.prerelease && !x.draft).slice(0, 1).map(x => ({ r: repos[i], x })))
        .sort((a, b) => new Date(b.x.published_at) - new Date(a.x.published_at)).slice(0, 7)
        .map(({ r, x }) => ({ t: `${r.split('/')[1]} ${x.tag_name}`, u: x.html_url, m: `${ago(x.published_at)} · ${r}` }));
    }
  };
  const HNQ = {
    llm: ['LLM', 'GPT', 'Claude', 'Gemini', 'DeepSeek', 'Qwen', 'language model'],
    slm: ['small model', 'local LLM', 'llama.cpp', 'Ollama', 'fine-tuning', 'on-device', 'quantization'],
    agent: ['AI agent', 'agents', 'MCP', 'agentic', 'Claude Code', 'Codex'],
    quant: ['trading', 'quantitative', 'stock market', 'hedge fund', 'backtest', 'portfolio']
  };
  const HNX = { quant: /quantum|insider trading|kalshi|polymarket|crypto|bitcoin/i };
  const HFM = {
    llm: { urls: ['&filter=text-generation', '&filter=image-text-to-text'], ok: (m, b) => b === null || b >= 20 },
    slm: { urls: ['&filter=text-generation', '&filter=image-text-to-text', '&filter=feature-extraction'], ok: (m, b) => b !== null && b <= 12 },
    agent: { urls: ['&filter=text-generation', '&filter=image-text-to-text', '&search=agent'], ok: m => /agent|gui|computer|browser|coder|code|tool|swe|terminal/i.test(m.id) },
    quant: { urls: ['&filter=time-series-forecasting', '&search=finance', '&search=fin'], ok: () => true }
  };
  const OR_FILTER = {
    llm: () => true,
    slm: m => /\b([0-9]|1[0-2])(\.\d)?b\b|mini|small|nano|flash-lite|haiku|tiny|-a[0-9]b/i.test(m.id + ' ' + m.name),
    agent: m => (m.supported_parameters || []).includes('tools'),
    quant: m => (m.supported_parameters || []).includes('tools') && +m.pricing.prompt * 1e6 <= 0.5  // 跑交易智能体时更看重低价、能调用工具的模型
  };
  const REPOS = {
    llm: ['vllm-project/vllm', 'sgl-project/sglang', 'huggingface/transformers', 'huggingface/trl'],
    slm: ['ollama/ollama', 'ggml-org/llama.cpp', 'ml-explore/mlx-lm', 'unslothai/unsloth', 'hiyouga/LlamaFactory', 'huggingface/peft'],
    agent: ['openai/openai-agents-python', 'langchain-ai/langgraph', 'modelcontextprotocol/python-sdk', 'browser-use/browser-use', 'OpenHands/OpenHands', 'huggingface/smolagents'],
    quant: ['TauricResearch/TradingAgents', 'microsoft/qlib', 'microsoft/RD-Agent', 'vnpy/vnpy', 'akfamily/akshare', 'polakowo/vectorbt']
  };
  const LIVE = [
    { id: 'hf', name: 'Hugging Face 热门论文', kind: '论文' },
    { id: 'rel', name: '关键项目新版本', kind: '一手来源' },
    { id: 'hfm', name: 'Hugging Face 热门模型', kind: '模型热度' },
    { id: 'or', name: 'OpenRouter 新上架模型', kind: '价格与上架' },
    { id: 'hn', name: 'Hacker News 讨论', kind: '社区热度' },
    { id: 'gh', name: 'GitHub 近 30 天新星项目', kind: '社区热度' }
  ];
  async function loadOne(t, src, force) {
    const el = $('#live-' + src); if (!el) return;
    const ck = `${src}.${t.id}`;
    let v = force ? null : cacheGet(ck);
    if (!v) {
      const btn = document.querySelector(`[data-reload="${src}"]`);
      el.className = 'msg'; el.textContent = force ? '正在重新拉取…' : '加载中…';
      if (btn) { btn.disabled = true; btn.textContent = '拉取中'; }
      try { v = await SOURCES[src](t); cacheSet(ck, v); }
      catch (e) {
        if (S.tab !== t.id) return;
        el.className = 'msg';
        const why = /Failed to fetch|NetworkError|Load failed|连接超时/.test(e.message) ? '当前网络连不上这个接口' : e.message;
        el.textContent = `没有拉取到数据：${why}。` + (src === 'gh' || src === 'rel' ? 'GitHub 未登录时每小时最多 60 次请求，过一会儿再点刷新。' : '换个网络或稍后再点刷新。')
          + `（${new Date().toLocaleTimeString('zh-CN', { hour12: false })} 尝试）`;
        return;
      } finally { if (btn) { btn.disabled = false; btn.textContent = '刷新'; } }
    }
    if (S.tab !== t.id) return;
    el.className = '';
    el.innerHTML = v.length ? `<ol>${v.map(x => `<li>${link(x.t, x.u)}<small>${esc(x.m)}</small></li>`).join('')}</ol>`
      : '<span class="msg">最近没有匹配的条目。</span>';
  }
  function loadLive(t, force) { LIVE.forEach(c => loadOne(t, c.id, force)); }

  /* ---------- 交互 ---------- */
  document.addEventListener('click', e => {
    const tab = e.target.closest('[data-tab]');
    if (tab) return setTab(tab.dataset.tab, tab.classList.contains('g-row'));
    const sum = e.target.closest('[data-open-key]');
    if (sum) {
      const li = sum.closest('.stage'), open = li.dataset.open !== 'true';
      li.dataset.open = open; sum.setAttribute('aria-expanded', open);
      S.open[sum.dataset.openKey] = open; save(); return;
    }
    const ch = e.target.closest('[data-filter]');
    if (ch) { S.filter[S.tab] = ch.dataset.filter; save(); renderFeedOnly(); return; }
    const rl = e.target.closest('[data-reload]');
    if (rl) { const t = T.find(x => x.id === S.tab); loadOne(t, rl.dataset.reload, true); return; }
    const sl = e.target.closest('[data-snaplvl]');
    if (sl) { S.snapLvl = S.snapLvl || {}; S.snapLvl[S.tab] = sl.dataset.snaplvl; S.snapSrc = S.snapSrc || {}; S.snapSrc[S.tab] = 'all'; save(); renderSnap(); return; }
    if (e.target.closest('[data-snapmore]')) {
      S.snapMore = S.snapMore || {}; S.snapMore[S.tab] = !S.snapMore[S.tab]; save(); renderSnap();
    }
  });
  function renderSnap() { const el = $('#snap'); if (el) el.innerHTML = snapHtml(T.find(x => x.id === S.tab)); }
  // 记住每个时间分组的展开/折叠状态
  document.addEventListener('toggle', e => {
    const d = e.target;
    if (d.matches && d.matches('details[data-gkey]')) { S.open['feed.' + d.dataset.gkey] = d.open; save(); }
  }, true);
  function renderFeedOnly() {
    const t = T.find(x => x.id === S.tab);
    const sec = $('#b-feed');
    sec.querySelector('.feedbar').remove(); sec.querySelector('.feed-groups').remove();
    sec.insertAdjacentHTML('beforeend', feedHtml(t));
  }
  document.addEventListener('change', e => {
    const cb = e.target.closest('input[data-k]');
    if (cb) {
      if (cb.checked) S.done[cb.dataset.k] = iso(new Date()); else delete S.done[cb.dataset.k];
      touch('done.' + cb.dataset.k); save(); queueSync();
      cb.closest('.task').classList.toggle('on', cb.checked);
      refreshCounts(); return;
    }
    if (e.target.matches('select[data-snapsrc]')) {
      S.snapSrc = S.snapSrc || {}; S.snapSrc[S.tab] = e.target.value; S.snapMore = S.snapMore || {}; S.snapMore[S.tab] = false; save(); renderSnap(); return;
    }
    if (e.target.id === 'startDate' && e.target.value) { S.start = e.target.value; touch('start'); save(); queueSync(); renderGantt(); renderPanel(); }
  });
  let noteTimer;
  document.addEventListener('input', e => {
    const ta = e.target.closest('textarea[data-note]');
    if (!ta) return;
    clearTimeout(noteTimer);
    noteTimer = setTimeout(() => { S.notes[ta.dataset.note] = ta.value; touch('notes.' + ta.dataset.note); save(); queueSync(); }, 300);
  });
  function refreshCounts() {
    const t = T.find(x => x.id === S.tab);
    document.querySelectorAll('#panel .stage').forEach((li, si) => {
      const keys = stageTasks(t, si), n = keys.filter(k => S.done[k]).length;
      li.querySelector('.minibar i').style.width = (n / keys.length * 100) + '%';
      li.querySelector('.prog').firstChild.textContent = `${n}/${keys.length}${li.classList.contains('now') ? ' · 进行中' : ''}`;
      li.classList.toggle('done', n === keys.length);
    });
    $('#panel .stat b').textContent = Math.round(pct(trackKeys(t)) * 100) + '%';
    renderGantt();
  }

  /* ---------- 多设备同步（私有 GitHub Gist） ----------
     令牌只存在本设备浏览器里，只发给 api.github.com。Gist 里只放进度和笔记。 */
  const SKEY = 'learning-hub.sync';
  const GIST_FILE = 'learning-hub-progress.json';
  const VALID = { done: /^[a-z]+\.\d+\.(tech|prod)\.\d+$/, notes: /^[a-z]+\.\d+$/ };
  let Y;
  try { Y = JSON.parse(localStorage.getItem(SKEY)) || {}; } catch (e) { Y = {}; }
  const saveY = () => { try { localStorage.setItem(SKEY, JSON.stringify(Y)); } catch (e) {} };
  const gh = (path, opt = {}) => fetch('https://api.github.com' + path, Object.assign({}, opt, {
    headers: { Authorization: 'Bearer ' + Y.token, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'Content-Type': 'application/json' }
  })).then(async r => {
    if (r.status === 401) throw new Error('令牌无效或已过期，请重新设置');
    if (r.status === 403 || r.status === 404) throw new Error('令牌没有 Gist 读写权限，或同步文件已被删除');
    if (!r.ok) throw new Error('GitHub 返回 ' + r.status);
    return r.json();
  });
  const payload = () => ({ v: 1, start: S.start, done: S.done, notes: S.notes, mt: S.mt });
  // 合并：每一项取修改时间较新的一方；没有时间戳的一方视为更旧
  function merge(remote) {
    if (!remote || typeof remote !== 'object') return false;
    const rm = remote.mt || {}; let changed = false;
    const newer = k => (rm[k] || 0) > (S.mt[k] || 0);
    if (/^\d{4}-\d{2}-\d{2}$/.test(remote.start || '') && newer('start') && remote.start !== S.start) { S.start = remote.start; S.mt.start = rm.start; changed = true; }
    for (const bag of ['done', 'notes']) {
      const r = remote[bag] && typeof remote[bag] === 'object' ? remote[bag] : {};
      const keys = new Set([...Object.keys(r), ...Object.keys(rm).filter(k => k.startsWith(bag + '.')).map(k => k.slice(bag.length + 1))]);
      for (const k of keys) {
        if (!VALID[bag].test(k) || !newer(bag + '.' + k)) continue;
        const has = Object.prototype.hasOwnProperty.call(r, k);
        if (has) { if (S[bag][k] !== r[k]) { S[bag][k] = bag === 'notes' ? String(r[k]) : r[k]; changed = true; } }
        else if (k in S[bag]) { delete S[bag][k]; changed = true; }
        S.mt[bag + '.' + k] = rm[bag + '.' + k];
      }
    }
    return changed;
  }
  let syncing = false, syncTimer, syncErr = '';
  function setSyncStatus(msg) {
    const el = $('#syncState'); if (!el) return;
    if (msg) el.textContent = msg;
    else if (!Y.token) el.textContent = '进度只保存在这台设备。设置同步后，其他设备打开网站会看到同样的进度和笔记。';
    else if (syncErr) el.textContent = '同步失败：' + syncErr;
    else el.textContent = Y.last ? `已同步，最后一次 ${new Date(Y.last).toLocaleString('zh-CN', { hour12: false })}` : '已开启同步';
    $('#syncBtn').textContent = Y.token ? '同步设置' : '设置多设备同步';
  }
  async function syncNow() {
    if (!Y.token || syncing) return;
    syncing = true; setSyncStatus('正在同步…');
    try {
      if (!Y.gist) {  // 第一次：先找已有的同步文件（其他设备可能已经建过），找不到再新建
        const list = await gh('/gists?per_page=100');
        const g = list.find(x => x.files && x.files[GIST_FILE]);
        Y.gist = g ? g.id : (await gh('/gists', { method: 'POST', body: JSON.stringify({ description: '学习路线网站的进度与笔记（自动同步，勿手改）', public: false, files: { [GIST_FILE]: { content: JSON.stringify(payload()) } } }) })).id;
        saveY();
      }
      const g = await gh('/gists/' + Y.gist);
      const f = g.files && g.files[GIST_FILE];
      let remote = null;
      if (f) remote = JSON.parse(f.truncated ? await (await fetch(f.raw_url)).text() : f.content);
      if (merge(remote)) { save(); renderGantt(); renderPanel(); }
      const mine = JSON.stringify(payload());
      if (!f || mine !== JSON.stringify(Object.assign({ v: 1 }, { start: remote.start, done: remote.done, notes: remote.notes, mt: remote.mt }))) {
        await gh('/gists/' + Y.gist, { method: 'PATCH', body: JSON.stringify({ files: { [GIST_FILE]: { content: mine } } }) });
      }
      Y.last = Date.now(); syncErr = ''; saveY();
    } catch (e) { syncErr = e.message || String(e); }
    syncing = false; setSyncStatus();
  }
  function queueSync() { if (!Y.token) return; clearTimeout(syncTimer); syncTimer = setTimeout(syncNow, 1500); }
  // 切回页面时拉取其他设备的更新
  document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') syncNow(); });
  $('#syncBtn').addEventListener('click', () => $('#syncDlg').showModal());
  $('#syncForm').addEventListener('submit', async e => {
    e.preventDefault();
    const act = e.submitter && e.submitter.value;
    if (act === 'off') { Y = {}; saveY(); syncErr = ''; setSyncStatus(); $('#syncDlg').close(); return; }
    if (act !== 'save') { $('#syncDlg').close(); return; }
    const tok = $('#syncToken').value.trim();
    if (!/^(github_pat_|ghp_)[A-Za-z0-9_]{20,}$/.test(tok)) { $('#syncHint').textContent = '令牌格式不对：应以 github_pat_ 或 ghp_ 开头。'; return; }
    Y = { token: tok }; saveY(); $('#syncToken').value = ''; $('#syncHint').textContent = '';
    $('#syncDlg').close(); await syncNow();
  });

  /* ---------- 导入导出 ---------- */
  $('#exportBtn').addEventListener('click', () => {
    const blob = new Blob([JSON.stringify({ start: S.start, done: S.done, notes: S.notes }, null, 2)], { type: 'application/json' });
    const a = document.createElement('a');
    a.href = URL.createObjectURL(blob); a.download = `学习进度-${iso(new Date())}.json`; a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  });
  $('#importBtn').addEventListener('click', () => $('#importFile').click());
  $('#importFile').addEventListener('change', async e => {
    const f = e.target.files[0]; if (!f) return;
    try {
      const d = JSON.parse(await f.text());
      if (typeof d !== 'object' || !d) throw new Error('格式不对');
      // 导入视为一次新的修改：涉及的每一项都更新时间戳，再同步到其他设备
      if (/^\d{4}-\d{2}-\d{2}$/.test(d.start)) { S.start = d.start; touch('start'); }
      for (const bag of ['done', 'notes']) {
        if (!d[bag] || typeof d[bag] !== 'object') continue;
        const next = {};
        for (const [k, v] of Object.entries(d[bag])) if (VALID[bag].test(k)) next[k] = bag === 'notes' ? String(v) : v;
        new Set([...Object.keys(S[bag]), ...Object.keys(next)]).forEach(k => touch(bag + '.' + k));
        S[bag] = next;
      }
      save(); queueSync(); renderGantt(); renderPanel();
      alert('已导入进度和笔记。');
    } catch (err) { alert('导入失败：请选择本页面导出的 JSON 文件。'); }
    e.target.value = '';
  });

  $('#feedInfo').textContent = `精选资讯更新于 ${HUB.feed.updated}，共 ${HUB.feed.items.length} 条` + (HUB.sources ? `；官方与媒体快照更新于 ${HUB.sources.updated}` : '') + '。';
  renderTabs(); renderGantt(); renderPanel();
  setSyncStatus(); syncNow();
})();
