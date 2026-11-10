// 回答的依据（纯函数）：这次请求实际放进上下文的资料。由程序生成，不让模型自己报出处。
export const SRC_KINDS = ['track', 'stage', 'route', 'note', 'card', 'digest', 'news', 'lib', 'pub', 'biz', 'background'];
export const SRC_LABEL = { track: '方向', stage: '阶段', route: '前沿路线', note: '阶段文档', card: '笔记', digest: '对话纪要', news: '资讯', lib: '导入资料', pub: '公共路线', biz: '商机', background: '个人背景' };
export const SRC_MAX = 8, TITLE_MAX = 40;
// 一条依据：{ t 类型, id, title }；类型不对或没有 ID 时返回 null
export function srcItem(t, id, title) {
  if (!SRC_KINDS.includes(t) || id == null || id === '') return null;
  const s = String(title || '').replace(/\s+/g, ' ').trim();
  return { t, id: String(id).slice(0, 80), title: (s.length > TITLE_MAX ? s.slice(0, TITLE_MAX - 1) + '…' : s) || String(id).slice(0, TITLE_MAX) };
}
// 合并几组依据：去掉无效和重复的（类型 + ID 相同算重复），保留先出现的，最多 SRC_MAX 条
export function mergeSources(...lists) {
  const seen = new Set(), out = [];
  for (const L of lists) for (const x of L || []) {
    const item = x && srcItem(x.t, x.id, x.title);
    if (!item) continue;
    const k = item.t + ':' + item.id; if (seen.has(k)) continue;
    seen.add(k); out.push(item); if (out.length >= SRC_MAX) return out;
  }
  return out;
}
// 与 systemPrompt 实际入参共用同一份数据，避免读到个人背景却标成“通用知识”。
export function backgroundSources({ profile, memory, recent, method, journal, tests } = {}) {
  return [['profile', '学习者档案', profile], ['memory', 'Agent 记住的事', memory],
    ['recent', '最近调整', recent], ['method', '学习方法档案', method],
    ['journal', '学习记录', journal], ['tests', '自测记录', tests]]
    .filter(([, , value]) => String(value || '').trim())
    .map(([id, title]) => srcItem('background', id, title));
}

// 纯文字版本（测试和导出用）；界面上用 agentui.js 的 srcHtml 分段渲染，方便英文界面逐段翻译
export const sourcesText = list => list && list.length ? '参考了：' + list.map(x => `${SRC_LABEL[x.t]}「${x.title}」`).join('、') : '没有引用你的资料，以下是通用知识';
