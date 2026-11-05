// 手机上的 Agent 浮窗：拖动标题栏可以移动，点“收小”只留标题栏；窗口半透明，背景页面仍然可以点按和复制
import { act } from './kit.js';

const mobile = () => matchMedia('(max-width: 820px)').matches;
let G = null, POS = { x: 0, y: 0 };

function apply(dw) { dw.style.setProperty('--dx', POS.x + 'px'); dw.style.setProperty('--dy', POS.y + 'px'); }

document.addEventListener('pointerdown', e => {
  if (!mobile()) return;
  const h = e.target.closest && e.target.closest('#dw .dw-h');
  if (!h || e.target.closest('button,a,input,select')) return;
  const dw = document.getElementById('dw'), r = dw.getBoundingClientRect();
  G = { dw, x0: e.clientX, y0: e.clientY, bx: POS.x, by: POS.y, base: { l: r.left - POS.x, t: r.top - POS.y, w: r.width, h: r.height } };
  dw.classList.add('moving');
  try { h.setPointerCapture(e.pointerId); } catch (err) {}
});
document.addEventListener('pointermove', e => {
  if (!G) return;
  const vw = innerWidth, vh = innerHeight, b = G.base;
  let x = G.bx + e.clientX - G.x0, y = G.by + e.clientY - G.y0;
  x = Math.max(4 - b.l, Math.min(vw - 4 - b.w - b.l, x));
  y = Math.max(8 - b.t, Math.min(vh - 56 - b.t, y));
  POS = { x, y }; apply(G.dw);
});
const end = () => { if (G) { G.dw.classList.remove('moving'); G = null; } };
document.addEventListener('pointerup', end);
document.addEventListener('pointercancel', end);

act('agent-min', () => { const dw = document.getElementById('dw'); dw.classList.toggle('min'); });
export const resetFloat = () => { POS = { x: 0, y: 0 }; const dw = document.getElementById('dw'); if (dw) { apply(dw); dw.classList.remove('min'); } };
