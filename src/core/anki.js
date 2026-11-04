// 导出 Anki（纯函数）：Anki 2.1.54 以后支持的带文件头的 TSV。
// 每张卡用稳定的 guid（由来源 ID 算出），重复导入时 Anki 只更新原来的卡，不会新建重复的卡。
import { hash } from './ids.js';

const esc = s => String(s || '').replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');
// 字段里不能有 Tab 和换行：Tab 换成空格，换行换成 <br>；有双引号时整段加引号、内部引号写两遍
function field(s) {
  const v = esc(s).replace(/\t/g, '  ').replace(/\r?\n/g, '<br>');
  return /"/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v;
}
export const guid = src => 'lh' + hash('anki:' + src);
const tag = s => String(s || '').replace(/\s+/g, '_').replace(/[^\p{L}\p{N}_:\-]/gu, '').slice(0, 40);

// notes：[{ src 稳定来源 ID, front, back, tags: [] }]
export function ankiTsv(notes, deck = '学习路线') {
  const head = ['#separator:tab', '#html:true', '#guid column:1', '#notetype:Basic', `#deck:${String(deck).replace(/[\t\r\n]/g, ' ')}`, '#tags column:4'];
  const rows = notes.filter(n => n && String(n.front || '').trim() && String(n.back || '').trim())
    .map(n => [guid(n.src), field(n.front), field(n.back), (n.tags || []).map(tag).filter(Boolean).join(' ')].join('\t'));
  return head.concat(rows).join('\n') + '\n';
}

// 从自测题和卡片笔记生成 Anki 卡
// tests：{ 任务 ID: {qs:[{t,a}]} }；cards：{ 卡片 ID: {t, at} }；label(at) → 标签文字
export function ankiNotes({ tests = {}, cards = {}, withCards = false, at = null, label = x => x }) {
  const out = [];
  for (const [id, r] of Object.entries(tests)) {
    if (at && !id.startsWith(at)) continue;
    for (const q of (r && r.qs) || []) if (q.t && q.a) out.push({ src: id + '|' + q.t, front: q.t, back: q.a, tags: ['自测', label(id.split('.').slice(0, 2).join('.'))] });
  }
  if (withCards) for (const [id, c] of Object.entries(cards)) {
    if (at && c.at !== at) continue;
    const lines = String(c.t || '').trim().split('\n'), front = lines[0].replace(/^#+\s*/, '').slice(0, 200), back = lines.slice(1).join('\n').trim();
    if (front && back) out.push({ src: id, front, back, tags: ['笔记', c.at ? label(c.at) : ''] });
  }
  return out;
}
