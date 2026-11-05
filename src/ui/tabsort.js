// 方向页顶部分区标签：太长时左右滑动；长按任意一个标签再拖动，可以改变顺序（按方向分别记在本机）
import * as store from '../store/index.js';

let D = null, suppress = false;
const HOLD = 380, SLOP = 8;

function start() {
  if (!D) return;
  D.on = true; D.a.classList.add('lifting'); D.nav.classList.add('sorting');
  if (navigator.vibrate) navigator.vibrate(12);
}
function finish(save) {
  if (!D) return;
  clearTimeout(D.timer);
  if (D.on) {
    D.a.classList.remove('lifting'); D.nav.classList.remove('sorting');
    if (save) {
      const U = store.ui(); U.tabOrder = U.tabOrder || {};
      U.tabOrder[D.nav.dataset.track] = [...D.nav.children].map(x => x.dataset.tab);
      store.saveUi();
    }
    suppress = true; setTimeout(() => { suppress = false; }, 80);
  }
  D = null;
}

document.addEventListener('pointerdown', e => {
  const a = e.target.closest && e.target.closest('#ttabs a[data-tab]');
  if (!a || (e.pointerType === 'mouse' && e.button !== 0)) return;
  D = { a, nav: a.parentElement, x0: e.clientX, y0: e.clientY, on: false, timer: setTimeout(start, HOLD) };
});
document.addEventListener('pointermove', e => {
  if (!D) return;
  if (!D.on) { if (Math.hypot(e.clientX - D.x0, e.clientY - D.y0) > SLOP) { clearTimeout(D.timer); D = null; } return; }
  const { a, nav } = D, x = e.clientX;
  let before = null;
  for (const c of nav.children) { if (c === a) continue; const r = c.getBoundingClientRect(); if (x < r.left + r.width / 2) { before = c; break; } }
  if (before !== a.nextElementSibling) nav.insertBefore(a, before);
  const nr = nav.getBoundingClientRect();
  if (x > nr.right - 36) nav.scrollLeft += 10; else if (x < nr.left + 36) nav.scrollLeft -= 10;
});
document.addEventListener('pointerup', () => finish(true));
document.addEventListener('pointercancel', () => finish(true));
// 拖动期间不要让页面或标签行跟着滚；长按时不要弹出系统的链接菜单
document.addEventListener('touchmove', e => { if (D && D.on) e.preventDefault(); }, { passive: false });
document.addEventListener('contextmenu', e => { if (e.target.closest && e.target.closest('#ttabs')) e.preventDefault(); });
document.addEventListener('click', e => { if (suppress && e.target.closest && e.target.closest('#ttabs')) { e.preventDefault(); e.stopPropagation(); } }, true);
document.addEventListener('dragstart', e => { if (e.target.closest && e.target.closest('#ttabs')) e.preventDefault(); });
