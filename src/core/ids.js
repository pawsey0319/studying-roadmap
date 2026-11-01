// 稳定 ID 与文本工具（纯函数）
// 资讯没有人工编号，用规范化后的链接算一个短哈希，各设备算出来一样，已读状态就能跨设备同步。
export function normUrl(u) {
  try {
    const x = new URL(u);
    x.hash = '';
    ['utm_source', 'utm_medium', 'utm_campaign', 'utm_content', 'utm_term', 'ref'].forEach(k => x.searchParams.delete(k));
    return (x.host.replace(/^www\./, '') + x.pathname.replace(/\/+$/, '') + x.search).toLowerCase();
  } catch (e) { return String(u || '').trim().toLowerCase(); }
}
// FNV-1a 32 位，两轮拼成 12 位十六进制，碰撞概率对几千条资讯足够低
export function hash(s) {
  let h1 = 0x811c9dc5, h2 = 0x01000193 ^ 0x5bd1e995;
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    h1 = Math.imul(h1 ^ c, 0x01000193) >>> 0;
    h2 = Math.imul(h2 ^ c, 0x5bd1e995) >>> 0;
  }
  return (h1.toString(16).padStart(8, '0') + h2.toString(16).padStart(8, '0')).slice(0, 12);
}
export const newsId = u => 'n' + hash(normUrl(u));

// 本地生成的新 ID（卡片笔记、个人新增任务等）
export const uid = (prefix = 'x') => prefix + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

// 判断一条任务是“理论”还是“实践验证”：以动手类动词开头的算实践
const PRACTICE = /^(跑通|手写|实现|部署|搭|复现|训练|微调|写|做|画|建|记录|压测|把|列|设计|用\s*\S+\s*(做|搭|实现|跑|部署|接入|给|拉取|对)|跟\s*\S+\s*(训练|跑)|试用|日常使用|为\S*建|整理成|计算并|评估|复盘|Build|Implement|Train|Deploy|Write|Create)/i;
export const guessMode = text => PRACTICE.test(String(text).trim()) ? 'practice' : 'theory';
