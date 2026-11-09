// 每个板块的“翻译”按钮：把这一块里还没有译文的文字（资讯标题、摘要、来源等）交给你设置的模型翻译，结果存在这台设备上。
// 英文界面时把中文译成英文；中文界面时把英文标题译成中文。笔记和输入框里你自己写的内容不动。
import { esc } from '../util.js';
import { chat } from '../ai/providers.js';
import { looseJSON } from '../ai/agent.js';
import { aiCfg, aiBlock } from './agentui.js';
import { act, toast } from './kit.js';
import { hasRuntime, isContentNode } from '../i18n.js';
import { needs, saveRuntime, trPrompt, isEn, t, restore, translateTree } from '../i18n.js';

const SKIP = 'textarea,input,select,script,style,pre,code,.ned,.me,button,.trb';
const label = () => (isEn() ? 'Translate' : '翻译');
const origLabel = () => (isEn() ? 'Show original' : '看原文');
// 看原文的板块：按 .sh 的标题文字记住（重画页面后还是原文），直到再点一次“翻译”
const ORIG = new Set();
const boardKey = h => (h.querySelector('h3') || h).textContent.trim().slice(0, 40);
function markBoard(h, orig) {
  for (const el of targets(h.querySelector('.trb') || h)) { el.classList.toggle('trorig', orig); if (orig) restore(el); else translateTree(el); }
  const b = h.querySelector('.trb'); if (b) { b.textContent = orig ? label() : (b.dataset.done ? origLabel() : label()); b.dataset.act = orig || !b.dataset.done ? 'tr-board' : 'tr-orig'; }
}
// 页面重画后，给每个板块标题（.sh）和阅读面板加上“翻译”按钮
export function addBoardButtons(root) {
  if (!root) return;
  root.querySelectorAll('.sh').forEach(h => {
    if (h.querySelector('.trb')) return;
    const b = document.createElement('button'); b.className = 'lnk trb'; b.dataset.act = 'tr-board'; b.textContent = label();
    b.title = isEn() ? 'Translate the items in this section with your AI model' : '用你设置的模型翻译这一块里的外文标题和摘要';
    (h.querySelector('.r') || h).appendChild(b);
    // 这一块已经有译文显示：按钮变成“看原文”；之前点过“看原文”的保持原文
    if (ORIG.has(boardKey(h))) { b.dataset.done = '1'; markBoard(h, true); }
    else if (hasTranslated(h)) { b.dataset.done = '1'; b.dataset.act = 'tr-orig'; b.textContent = origLabel(); }
  });
}
function targets(btn) {
  const rd = btn.closest('.rd-b, .tr-p, .dw'); if (rd) return [rd];
  const h = btn.closest('.sh'), out = []; if (!h) return out;
  for (let e = h.nextElementSibling; e && !e.matches('.sh'); e = e.nextElementSibling) out.push(e);
  return out;
}
function hasTranslated(h) {
  for (const el of targets(h.querySelector('.trb'))) { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.__orig != null && (hasRuntime(n.__orig) || isContentNode(n))) return true; }
  return false;
}
function collect(els) {
  const set = new Set();
  for (const el of els) {
    const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT, { acceptNode: n => (n.parentElement && n.parentElement.closest(SKIP) ? NodeFilter.FILTER_REJECT : NodeFilter.FILTER_ACCEPT) });
    let n; while ((n = w.nextNode())) { const v = n.nodeValue.replace(/\s+/g, ' ').trim(); if (v.length >= 4 && needs(v)) set.add(v); }
  }
  return [...set].slice(0, 160);
}
act('tr-orig', el => { const h = el.closest('.sh'); if (h) { ORIG.add(boardKey(h)); markBoard(h, true); } else { const box = targets(el)[0]; if (box) { box.classList.add('trorig'); restore(box); el.textContent = label(); el.dataset.act = 'tr-board'; } } });
act('tr-board', async el => {
  const h = el.closest('.sh');
  // 之前切回过原文：直接再显示译文，不用再调模型
  if (h && ORIG.has(boardKey(h))) { ORIG.delete(boardKey(h)); markBoard(h, false); }
  else { const box = el.closest('.rd-b, .tr-p, .dw'); if (box && box.classList.contains('trorig')) box.classList.remove('trorig'), translateTree(box); }
  const L = collect(targets(el));
  if (!L.length) { if (hasTranslatedEls(targets(el))) { el.dataset.done = '1'; el.dataset.act = 'tr-orig'; el.textContent = origLabel(); } else toast(t('这一块已经都是当前语言了')); return; }
  const cfg = await aiCfg(), block = aiBlock(cfg);
  if (block) { toast(t(block)); return; }
  el.disabled = true; el.textContent = isEn() ? `Translating ${L.length}…` : `正在翻译 ${L.length} 条…`;
  let n = 0;
  try {
    for (let i = 0; i < L.length; i += 40) {
      const batch = L.slice(i, i + 40);
      const res = await chat(cfg, [{ role: 'system', content: trPrompt() }, { role: 'user', content: JSON.stringify(batch) }], { maxTokens: 4000, temperature: 0.1, feat: 'translate' });
      const j = looseJSON(String(res.text).replace(/^[\s\S]*?```(?:json)?\s*|```[\s\S]*$/g, '')) || looseJSON(res.text) || {};
      const ok = Object.fromEntries(batch.filter(k => typeof j[k] === 'string' && j[k].trim()).map(k => [k, j[k].trim()]));
      n += Object.keys(ok).length; saveRuntime(ok);
    }
    toast(isEn() ? `Translated ${n} items` : `翻译了 ${n} 条`);
    if (n) { el.disabled = false; el.dataset.done = '1'; el.dataset.act = 'tr-orig'; el.textContent = origLabel(); return; }
  } catch (e) { toast((isEn() ? 'Translation failed: ' : '翻译失败：') + (e.message || e)); }
  el.disabled = false; el.textContent = label();
});
function hasTranslatedEls(els) { for (const el of els) { const w = document.createTreeWalker(el, NodeFilter.SHOW_TEXT); let n; while ((n = w.nextNode())) if (n.__orig != null && (hasRuntime(n.__orig) || isContentNode(n))) return true; } return false; }
export const _esc = esc;
