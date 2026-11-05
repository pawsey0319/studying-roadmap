// 外观：主题、字体、字号、强调色、密度。只存在这台设备（store.ui().theme），另存一份到 localStorage 让下次打开时第一帧就是对的。
import * as store from '../store/index.js';
import { esc } from '../util.js';
import { act, refresh } from './kit.js';

export const DEFAULT = { mode: 'mist', font: 'book', noteFont: 'sans', size: 'std', accent: 'indigo', density: 'cozy' };
export const OPTIONS = {
  mode: [['mist', '雾青'], ['paper', '纸白'], ['night', '夜读']],
  font: [['book', '书卷'], ['serif', '宋体'], ['sans', '黑体'], ['kai', '楷体']],
  noteFont: [['sans', '黑体'], ['serif', '宋体'], ['kai', '楷体']],
  size: [['std', '标准'], ['large', '偏大']],
  accent: [['indigo', '黛蓝'], ['pine', '松绿'], ['plum', '藕紫'], ['ochre', '赭石'], ['slate', '墨灰']],
  density: [['cozy', '舒适'], ['compact', '紧凑']]
};
export const ACCENTS = { indigo: ['#34507A', '#8FAEDB'], pine: ['#2F6B57', '#7CC4A6'], plum: ['#6A5A8C', '#B7A6E0'], ochre: ['#8A5B3A', '#D9A57E'], slate: ['#3E4A55', '#AEBBC6'] };
const BAR = { mist: '#EEF1EF', paper: '#F6F6F3', night: '#12171C' };
const LS = 'lh.theme';

// 把不合法的值换回默认值（来自本地存储，不能直接信）
export function clean(t) {
  const out = { ...DEFAULT };
  for (const k of Object.keys(OPTIONS)) if (t && OPTIONS[k].some(([v]) => v === t[k])) out[k] = t[k];
  return out;
}
export function applyTo(root, t) {
  t = clean(t);
  root.dataset.theme = t.mode; root.dataset.font = t.font === 'book' ? '' : t.font; root.dataset.noteFont = t.noteFont;
  root.dataset.size = t.size; root.dataset.density = t.density;
  const a = ACCENTS[t.accent];
  if (t.accent === 'indigo' || !a) { root.style.removeProperty('--accent'); root.style.removeProperty('--accent-soft'); }
  else {
    const c = t.mode === 'night' ? a[1] : a[0];
    root.style.setProperty('--accent', c); root.style.setProperty('--accent-soft', `color-mix(in srgb,${c} 14%,var(--card))`);
  }
  return t;
}
export function current() { return clean(store.ui().theme); }
export function applyAppearance() {
  const t = applyTo(document.documentElement, current());
  const m = document.querySelector('meta[name=theme-color]'); if (m) m.content = BAR[t.mode];
  try { localStorage.setItem(LS, JSON.stringify(t)); } catch (e) {}
  return t;
}
export function setAppearance(patch) {
  const U = store.ui(); U.theme = clean({ ...current(), ...patch }); store.saveUi(); return applyAppearance();
}

// 设置页里的“外观”卡片
export function appearanceHtml() {
  const t = current();
  const row = (key, label) => `<div class="ap-row"><span class="ap-l">${label}</span><div class="chips">${OPTIONS[key].map(([v, n]) =>
    `<button type="button" class="chip${key === 'accent' ? ' sw' : ''}" data-act="ap-set" data-k="${key}" data-v="${v}" aria-pressed="${t[key] === v}">${key === 'accent' ? `<i style="background:${ACCENTS[v][0]}"></i>` : ''}${esc(n)}</button>`).join('')}</div></div>`;
  return `<section class="card set ap"><h3>外观</h3>
    <p class="hint">只对这台设备生效。宋体和楷体用系统自带的字体，没有安装时会退回黑体。</p>
    ${row('mode', '主题')}${row('font', '界面字体')}${row('noteFont', '笔记字体')}${row('size', '字号')}${row('accent', '强调色')}${row('density', '密度')}
    <p class="ap-demo md" style="margin-top:10px"><b>读一段样例：</b>理论给方向，实践给证据。<br><span class="small mut">字体、字号和强调色会立刻生效。</span></p></section>`;
}
act('ap-set', el => { setAppearance({ [el.dataset.k]: el.dataset.v }); refresh(); });
