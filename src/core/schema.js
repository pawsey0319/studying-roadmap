// 个人数据的文档清单与校验（纯函数）。
// 每份文档都是 core/doc.js 的 {e, mt} 结构，可以单独同步。来自同步文件、导入文件、云端的数据，写入前都要过这里的校验。
export const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
// 任务：公共路线 agent.s02.i03；个人新增 agent.s02.u<随机>；导入路线 u<随机>.s01.i01
export const ITEM_RE = /^[a-z0-9][a-z0-9-]*\.[sr][0-9a-z]{2,12}\.[iul][0-9a-z]{2,16}$/;
// 阶段 agent.s02、前沿路线 agent.r03、导入路线的阶段 u1abc.s01
export const STAGE_RE = /^[a-z0-9][a-z0-9-]*\.[sr][0-9a-z]{2,16}$/;
export const NEWS_RE = /^n[0-9a-f]{12}$/;
export const TRACK_RE = /^[a-z0-9][a-z0-9-]{1,30}$/;

const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
const str = (v, max) => typeof v === 'string' && v.length <= max;
const size = v => { try { return JSON.stringify(v).length; } catch (e) { return Infinity; } };

export const DOCS = {
  // 任务完成：任务 ID → 完成日期
  progress: (k, v) => (k === 'start' ? DATE_RE.test(v) : ITEM_RE.test(k) && str(v, 20)),
  // 阶段长文档（Markdown）：阶段或前沿路线 ID → 文本
  notes: (k, v) => STAGE_RE.test(k) && str(v, 200000),
  // 卡片笔记：c<随机> → {t 文本, at 挂到的阶段/路线, c 创建时间}
  cards: (k, v) => /^c[0-9a-z]{6,24}$/.test(k) && isObj(v) && str(v.t, 20000) && (v.at == null || STAGE_RE.test(v.at)) && typeof v.c === 'number',
  // 个人调整：阶段 ID → {goal, mastered, skip[], add[], edit{}, res[]}
  overlay: (k, v) => STAGE_RE.test(k) && isObj(v) && size(v) < 60000,
  // 已读：资讯 ID → 日期；稍后读：资讯 ID → {t, u, at}
  read: (k, v) => NEWS_RE.test(k) && str(v, 20),
  later: (k, v) => NEWS_RE.test(k) && isObj(v) && str(v.t, 400) && str(v.u, 2000) && /^https?:\/\//.test(v.u),
  // 对前沿路线的个人操作：路线 ID → {name, stopped, follow}
  routes: (k, v) => STAGE_RE.test(k) && isObj(v) && size(v) < 4000,
  // 导入的路线：u<随机> → 完整路线；ext.<板块> → 追加到公共板块的阶段
  tracks: (k, v) => (/^u[0-9a-z]{4,24}$/.test(k) || /^ext\.[a-z0-9-]+$/.test(k)) && isObj(v) && size(v) < 600000,
  // 导入的资料：d<随机> → {title, text, at, src, added}
  library: (k, v) => /^d[0-9a-z]{6,24}$/.test(k) && isObj(v) && str(v.title, 300) && str(v.text, 400000) && (v.at == null || STAGE_RE.test(v.at)),
  // 每周建议的处理结果
  sugs: (k, v) => /^[a-z0-9.\-]{2,60}$/.test(k) && (v === 'applied' || v === 'dropped'),
  // 对每周 AI 整理结果的反馈
  marks: (k, v) => NEWS_RE.test(k) && (v === 'wrong' || v === 'drop'),
  // 学习者档案与开局摘要
  meta: (k, v) => ((k === 'profile' || k === 'memory') && str(v, 8000)) || (k === 'onboarded' && str(v, 30)) || (k === 'summary' && isObj(v) && size(v) < 20000)
    || (k === 'adopted' && Array.isArray(v) && v.length <= 60 && v.every(x => typeof x === 'string' && TRACK_RE.test(x)))
    || (k === 'idleHours' && typeof v === 'number' && v >= 1 && v <= 720) || (k === 'methodN' && Number.isInteger(v) && v >= 0),
  // 对话纪要：每段对话结束时由学习 Agent 压缩成的笔记。g<随机> → {title, t, at, kind, c, n}
  digests: (k, v) => /^g[0-9a-z]{6,24}$/.test(k) && isObj(v) && str(v.title, 200) && str(v.t, 20000) && (v.at == null || STAGE_RE.test(v.at)) && typeof v.c === 'number',
  // 学习方法档案：m<随机> → {d 维度, t 描述, w 权重 0–1, n 印证次数, c, u, src[纪要 ID], by ai|user}
  method: (k, v) => /^m[0-9a-z]{6,24}$/.test(k) && isObj(v) && str(v.d, 20) && str(v.t, 600) && typeof v.w === 'number' && v.w >= 0 && v.w <= 1
    && (v.by === 'ai' || v.by === 'user') && (!v.src || (Array.isArray(v.src) && v.src.length <= 8)),
  // 自测记录：任务 ID（或阶段 ID）→ {k 类型, a[最近 5 次作答 {s,h,r,p,t}], qs[最近 5 道题 {t,a}]}
  tests: (k, v) => (ITEM_RE.test(k) || STAGE_RE.test(k)) && isObj(v) && ['memory', 'procedural', 'concept'].includes(v.k)
    && Array.isArray(v.a) && v.a.length <= 5 && v.a.every(x => isObj(x) && typeof x.s === 'number' && x.s >= 0 && x.s <= 1)
    && (!v.qs || (Array.isArray(v.qs) && v.qs.length <= 5)) && size(v) < 8000,
  // 学习日志：阶段或前沿路线 ID → {last 上次聊到哪, next 下次重点, u 时间}；最多 50 条
  // 知识树里你让 AI 细分出来的子方向：父节点 ID → {kids:[{k, name, en, kw[]}], u}
  tree: (k, v) => /^[a-z0-9][a-z0-9-]{1,30}(\.[a-z0-9]{1,12}){0,8}$/.test(k) && isObj(v) && Array.isArray(v.kids) && v.kids.length <= 8
    && v.kids.every(x => isObj(x) && /^[a-z0-9]{1,12}$/.test(x.k) && str(x.name, 30) && Array.isArray(x.kw) && x.kw.length <= 12) && size(v) < 6000,
  journal: (k, v) => STAGE_RE.test(k) && isObj(v) && str(v.last || '', 400) && str(v.next || '', 400) && typeof v.u === 'number'
};
export const DOC_NAMES = Object.keys(DOCS);
export const validFor = name => DOCS[name] || (() => false);
