// 公共区域（纯函数）：公开 = 发一份快照；采用 = 复制到自己的方向里，记下来源和版本。
// 快照只包括路线结构（阶段、任务、资源、产出），不包括进度、笔记、学习方法档案、对话纪要。
import { effectiveStage } from './overlay.js';
import { TRACK_RE } from './schema.js';

const last = id => String(id).split('.').pop();
const clip = (s, n) => String(s || '').trim().slice(0, n);

// 方向 → 快照。overlays 是你的个人调整：跳过的任务不公开，改写和新增的按改后的公开
export function snapshot(track, overlays = {}, { keepEmpty = false } = {}) {
  const used = new Set();
  const stages = track.stages.map(s => effectiveStage(s, overlays[s.id])).map((s, si) => {
    let sk = last(s.id); if (!/^s[0-9a-z]{2,12}$/.test(sk) || used.has(sk)) sk = 's' + String(si + 1).padStart(2, '0') + 'x'; used.add(sk);
    const iu = new Set();
    const items = s.items.filter(i => !i.skipped).map((i, k) => {
      let ik = last(i.id); if (!/^[iu][0-9a-z]{2,16}$/.test(ik) || iu.has(ik)) ik = 'i' + String(k + 1).padStart(2, '0') + 'x'; iu.add(ik);
      return { k: ik, text: clip(i.text, 500), mode: i.mode === 'practice' ? 'practice' : 'theory' };
    });
    return { k: sk, title: clip(s.title, 120), goal: clip(s.goal, 600), items, resources: (s.resources || []).slice(0, 40).map(r => ({ name: clip(r.name, 200), ...(/^https?:\/\//.test(r.url || '') ? { url: r.url } : {}) })), output: clip(s.output, 300) };
  }).filter(s => s.items.length || keepEmpty);
  return { name: clip(track.name, 40), goal: clip(track.goal, 400), stages };
}

// 快照 → 你自己的方向。tid 不变时，阶段和任务 ID 也不变，更新上游版本后进度不丢
export function toTrack(body, { tid, item, color }) {
  const stages = (body.stages || []).slice(0, 30).map(s => {
    const sid = `${tid}.${s.k}`;
    return { id: sid, title: clip(s.title, 120), goal: clip(s.goal, 600), output: clip(s.output, 300),
      items: (s.items || []).slice(0, 40).map(i => ({ id: `${sid}.${i.k}`, kind: 'tech', mode: i.mode === 'practice' ? 'practice' : 'theory', text: clip(i.text, 500) })),
      resources: (s.resources || []).slice(0, 40).map((r, k) => ({ id: `${sid}.r${String(k + 1).padStart(2, '0')}`, name: clip(r.name, 200), ...(/^https?:\/\//.test(r.url || '') ? { url: r.url } : {}) })) };
  });
  return { id: tid, domain: 'mine', name: clip(body.name || item.title, 40), short: clip(body.name || item.title, 8), color: color || '#3C6E71', goal: clip(body.goal, 400),
    source: `公共区域 · ${clip(item.author_name, 40)}`, pub: { id: +item.id, v: +item.version, by: clip(item.author_name, 40) }, stages };
}
export const validBody = (kind, b) => b && typeof b === 'object' && (kind === 'note' ? typeof b.text === 'string' && b.text.trim().length > 0 && b.text.length <= 20000
  : Array.isArray(b.stages) && b.stages.length > 0 && b.stages.length <= 30 && b.stages.every(s => s && /^s[0-9a-z]{2,14}$/.test(s.k) && Array.isArray(s.items) && s.items.every(i => i && /^[iu][0-9a-z]{2,17}$/.test(i.k))));

// 敏感词过滤（只在公开前检查；服务端另有举报和人工下架）。返回命中的类别，空数组 = 通过
const RULES = [
  ['联系方式和引流', /(?<!\d)1[3-9]\d{9}(?!\d)|加\s*(微信|vx|v信|薇信|qq)|微信号|qq\s*群|vx[:：]|wx[:：]|私信领取|扫码进群/i],
  ['赌博', /博彩|赌场|网赌|赌球|百家乐|六合彩|彩票代理|时时彩/],
  ['色情', /色情|约炮|裸聊|成人视频|黄色网站|援交/],
  ['违法交易', /代开发票|办证|刷单|套现|洗钱|枪支出售|出售.{0,4}(身份证|银行卡|个人信息)|毒品|冰毒|大麻出售/],
  ['诈骗', /稳赚不赔|保本高收益|内幕消息.{0,6}(股票|币)|日赚\d+|躺赚/]
];
export function sensitive(text) {
  const t = String(text || '');
  return RULES.filter(([, re]) => re.test(t)).map(([n]) => n);
}
export const bodyText = (kind, b) => kind === 'note' ? b.text : [b.name, b.goal, ...(b.stages || []).flatMap(s => [s.title, s.goal, s.output, ...s.items.map(i => i.text), ...s.resources.map(r => r.name + ' ' + (r.url || ''))])].join('\n');

// 排序：adopt 采用最多；done 学完最多（学完人数，相同时看学完比例）；new 最近更新
export function sortItems(items, by) {
  const rate = x => (x.adopt_count ? x.done_count / x.adopt_count : 0);
  const L = [...items];
  if (by === 'done') L.sort((a, b) => b.done_count - a.done_count || rate(b) - rate(a) || b.adopt_count - a.adopt_count);
  else if (by === 'new') L.sort((a, b) => (a.updated_at < b.updated_at ? 1 : a.updated_at > b.updated_at ? -1 : 0));
  else L.sort((a, b) => b.adopt_count - a.adopt_count || b.done_count - a.done_count);
  return L;
}

// 本地采用的公共方向：{ 公共条目 ID: {tid, v} }
export function adoptedMap(tracks) {
  const m = {};
  for (const [k, t] of Object.entries(tracks || {})) if (/^u/.test(k) && t && t.pub && t.pub.id) m[t.pub.id] = { tid: k, v: t.pub.v };
  return m;
}
export const upstreamNewer = (local, item) => !!(local && item && +item.version > +local.v);
export const okTrackId = id => TRACK_RE.test(id);

// 引用整条路线：把一个方向（含你的个人调整）复制成你自己的一条新方向。跳过的任务不复制，改写和新增的按改后的复制。
// 新方向的阶段和任务 ID 都换成 tid 开头，所以原方向的进度不会带过来；原方向不受影响。
export function copyTrack(track, overlays, { tid, color }) {
  // 复制时要保持阶段数：某个阶段的任务全被跳过时也保留这个空阶段（发布快照仍会去掉空阶段）
  const body = snapshot(track, overlays || {}, { keepEmpty: true });
  const stages = body.stages.map(s => {
    const sid = `${tid}.${s.k}`;
    return { id: sid, title: s.title, goal: s.goal, output: s.output,
      items: s.items.map(i => ({ id: `${sid}.${i.k}`, kind: 'tech', mode: i.mode, text: i.text })),
      resources: s.resources.map((r, k) => ({ id: `${sid}.r${String(k + 1).padStart(2, '0')}`, name: r.name, ...(r.url ? { url: r.url } : {}) })) };
  });
  return { id: tid, domain: 'mine', name: clip(body.name, 40), short: clip(body.name, 8), color: color || '#3C6E71', goal: clip(body.goal, 400), source: '引用自：' + clip(track.name, 40), stages };
}
