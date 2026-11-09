// 回答的依据（纯函数）：这次请求实际放进上下文的资料。由程序生成，不让模型自己报出处。
export const SRC_KINDS = ['track', 'stage', 'route', 'note', 'card', 'digest', 'news', 'lib', 'pub', 'biz'];
export const SRC_LABEL = { track: '方向', stage: '阶段', route: '前沿路线', note: '阶段文档', card: '笔记', digest: '对话纪要', news: '资讯', lib: '导入资料', pub: '公共路线', biz: '商机' };
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
    if (!x || !SRC_KINDS.includes(x.t)) continue;
    const k = x.t + ':' + x.id; if (seen.has(k)) continue;
    seen.add(k); out.push(x); if (out.length >= SRC_MAX) return out;
  }
  return out;
}
// 纯文字版本（测试和导出用）；界面上用 agentui.js 的 srcHtml 分段渲染，方便英文界面逐段翻译
export const sourcesText = list => list && list.length ? '参考了：' + list.map(x => `${SRC_LABEL[x.t]}「${x.title}」`).join('、') : '没有引用你的资料，以下是通用知识';
