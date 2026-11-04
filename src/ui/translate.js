// 每个板块的“翻译”按钮：把这一块里还没有译文的文字（资讯标题、摘要、来源等）交给你设置的模型翻译，结果存在这台设备上。
// 英文界面时把中文译成英文；中文界面时把英文标题译成中文。笔记和输入框里你自己写的内容不动。
import { esc } from '../util.js';
import { chat } from '../ai/providers.js';
import { looseJSON } from '../ai/agent.js';
import { aiCfg, aiBlock } from './agentui.js';
import { act, toast } from './kit.js';
import { needs, saveRuntime, trPrompt, isEn, t } from '../i18n.js';

const SKIP = 'textarea,input,select,script,style,pre,code,.ned,.me,button,.trb';
const label = () => (isEn() ? 'Translate' : '翻译');
// 页面重画后，给每个板块标题（.sh）和阅读面板加上“翻译”按钮
export function addBoardButtons(root) {
  if (!root) return;
  root.querySelectorAll('.sh').forEach(h => {
    if (h.querySelector('.trb')) return;
    const b = document.createElement('button'); b.className = 'lnk trb'; b.dataset.act = 'tr-board'; b.textContent = label();
    b.title = isEn() ? 'Translate the items in this section with your AI model' : '用你设置的模型翻译这一块里的外文标题和摘要';
    (h.querySelector('.r') || h).appendChild(b);
  });
}
function targets(btn) {
  const rd = btn.closest('.rd-b, .tr-p, .dw'); if (rd) return [rd];
  const h = btn.closest('.sh'), out = []; if (!h) return out;
  for (let e = h.nextElementSibling; e && !e.matches('.sh'); e = e.nextElementSibling) out.push(e);
  return out;
}
function collect(els) {
  const set = new Set();
  for (const el of els) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let n; while ((n = w.nextNode())) { const v = n.nodeValue.replace(/\s+/g, ' ').trim(); if (v.length >= 4 && needs(v)) set.add(v); }
  }
  return [...set].slice(0, 160);
}
act('tr-board', async el => {
  const L = collect(targets(el));
  if (!L.length) { toast(t('这一块已经都是当前语言了')); return; }
  const cfg = await aiCfg(), block = aiBlock(cfg);
  if (block) { toast(t(block)); return; }
  el.disabled = true; el.textContent = isEn() ? `Translating ${L.length}…` : `正在翻译 ${L.length} 条…`;
  let n = 0;
  try {
    for (let i = 0; i < L.length; i += 40) {
      const batch = L.slice(i, i + 40);
      const res = await chat(cfg, [{ role: 'system', content: trPrompt() }, { role: 'user', content: JSON.stringify(batch) }], { maxTokens: 4000, temperature: 0.1 });
      const j = looseJSON(String(res.text).replace(/^[\s\S]*?```(?:json)?\s*|```[\s\S]*$/g, '')) || looseJSON(res.text) || {};
      const ok = Object.fromEntries(batch.filter(k => typeof j[k] === 'string' && j[k].trim()).map(k => [k, j[k].trim()]));
      n += Object.keys(ok).length; saveRuntime(ok);
    }
    toast(isEn() ? `Translated ${n} items` : `翻译了 ${n} 条`);
  } catch (e) { toast((isEn() ? 'Translation failed: ' : '翻译失败：') + (e.message || e)); }
  el.disabled = false; el.textContent = label();
});
export const _esc = esc;
