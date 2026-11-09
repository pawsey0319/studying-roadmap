// “我的”：头像和简介、你的笔记和路线（每张卡片带点赞 / 引用），其余功能都收进右上角的设置
import { $, esc, iso } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import { likeCount } from '../core/marks.js';
import { act, refresh, toast } from './kit.js';
import { reactBar } from './react.js';
import { stageLabel } from './home.js';
import { bumpStat, weekStats } from '../core/progress.js';

// 使用统计只存这台设备（store.ui().stats），不同步、不上传
export function stat(key) { const U = store.ui(); U.stats = bumpStat(U.stats, iso(new Date()), key); store.saveUi(); }

const GEAR = '<svg width="22" height="22" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="3"/><path d="M19.4 14.6a1.6 1.6 0 0 0 .3 1.7l.1.1a2 2 0 1 1-2.8 2.8l-.1-.1a1.6 1.6 0 0 0-1.7-.3 1.6 1.6 0 0 0-1 1.5V21a2 2 0 1 1-4 0v-.1a1.6 1.6 0 0 0-1-1.5 1.6 1.6 0 0 0-1.7.3l-.1.1a2 2 0 1 1-2.8-2.8l.1-.1a1.6 1.6 0 0 0 .3-1.7 1.6 1.6 0 0 0-1.5-1H3a2 2 0 1 1 0-4h.1a1.6 1.6 0 0 0 1.5-1 1.6 1.6 0 0 0-.3-1.7l-.1-.1a2 2 0 1 1 2.8-2.8l.1.1a1.6 1.6 0 0 0 1.7.3h0a1.6 1.6 0 0 0 1-1.5V3a2 2 0 1 1 4 0v.1a1.6 1.6 0 0 0 1 1.5 1.6 1.6 0 0 0 1.7-.3l.1-.1a2 2 0 1 1 2.8 2.8l-.1.1a1.6 1.6 0 0 0-.3 1.7v0a1.6 1.6 0 0 0 1.5 1H21a2 2 0 1 1 0 4h-.1a1.6 1.6 0 0 0-1.5 1Z"/></svg>';

export const profile = () => {
  const c = store.get('meta', 'card') || {};
  const name = (c.name || '').trim() || '学习者';
  return { name, bio: c.bio || '', av: (c.av || '').trim() || name.slice(0, 1), img: store.get('meta', 'avatar') || '' };
};

const preview = t => {
  const lines = String(t).replace(/^>.*$/gm, '').split('\n').map(x => x.replace(/[#*`>\-]/g, '').trim()).filter(Boolean);
  return { title: lines[0] || String(t).slice(0, 40), body: lines.slice(1).join(' ').slice(0, 90) };
};

function noteCard(id, c) {
  const p = preview(c.t);
  return `<article class="wc"><a class="wc-b" href="#/notes/${id}"><h4>${esc(p.title.slice(0, 50))}</h4>${p.body ? `<p>${esc(p.body)}</p>` : ''}
      <div class="meta"><span>${c.at ? esc(stageLabel(c.at)) : '没有归类'}</span><span>${new Date(c.c).toLocaleDateString('zh-CN')}</span></div></a>
    <div class="wc-f">${reactBar('card', id)}</div></article>`;
}
function routeCard(t) {
  const st = M.state(t.id), n = M.routes(t.id).filter(r => !r.stopped).length;
  return `<article class="wc" style="--lc:${t.color}"><a class="wc-b" href="#/t/${t.id}"><div class="wc-bar"></div><h4>${esc(t.name)}</h4>${t.goal ? `<p>${esc(t.goal.slice(0, 80))}</p>` : ''}
      <div class="meta"><span>理论 ${st.doneStages}/${st.stages.length}</span><span>前沿 ${n} 条</span></div></a>
    <div class="wc-f">${reactBar('track', t.id)}</div></article>`;
}

export function renderMe() {
  document.documentElement.style.setProperty('--c', '#1B2430');
  const P = profile(), U = store.ui(), seg = U.meSeg === 'routes' ? 'routes' : 'notes';
  const cards = Object.entries(store.all('cards')).sort((a, b) => b[1].c - a[1].c);
  const T = M.tracks(), refs = Object.keys(store.all('refs')).length, likes = likeCount(store.all('likes'));
  const list = seg === 'notes'
    ? cards.map(([id, c]) => noteCard(id, c)).join('') || '<p class="empty">还没有笔记。点页面右下角的“＋”随手记一条。</p>'
    : T.map(routeCard).join('') + '<a class="wc add" href="#/library"><span>＋</span>从路线库添加</a>';
  return `<div class="me-top"><span class="me-t">我的</span><a class="me-set" href="#/settings" aria-label="设置">${GEAR}</a></div>
    <section class="me-head"><button type="button" class="avatar" data-act="me-edit" aria-label="编辑头像和简介">${P.img ? `<img src="${esc(P.img)}" alt="">` : esc(P.av)}</button>
      <div class="me-id"><h1>${esc(P.name)}</h1><p class="bio${P.bio ? '' : ' fnt'}">${esc(P.bio || '点头像，写一句话介绍你在学什么')}</p></div></section>
    <div class="me-stats"><div><b>${cards.length}</b><span>笔记</span></div><div><b>${T.length}</b><span>路线</span></div><div><b>${likes}</b><span>点赞</span></div><div><b>${refs}</b><span>引用</span></div></div>
    ${(() => { const w = weekStats(U.stats, iso(new Date())); return `<p class="fnt small" style="margin:-6px 0 12px">最近 7 天：打开 ${w.open} 天 · 和 Agent 聊了 ${w.agent} 次 · 完成 ${w.tasks} 项任务（只记在这台设备）</p>`; })()}
    <div class="seg" role="tablist"><button role="tab" data-act="me-seg" data-v="notes" aria-selected="${seg === 'notes'}">笔记</button><button role="tab" data-act="me-seg" data-v="routes" aria-selected="${seg === 'routes'}">路线库</button></div>
    <div class="wf">${list}</div>`;
}

act('me-seg', el => { store.ui().meSeg = el.dataset.v; store.saveUi(); refresh(); });
// 头像图片：取正中的正方形，缩到 192px，重新编码成 JPEG（去掉原图里的位置等信息，也只会是图片），存进账号随设备同步
export async function toAvatar(file) {
  if (!file || !/^image\/(png|jpe?g|webp|gif)$/.test(file.type)) throw new Error('请选择 PNG、JPG、WebP 或 GIF 图片');
  if (file.size > 10e6) throw new Error('图片太大了（超过 10 MB），请换一张小一点的');
  let bmp;
  try { bmp = await createImageBitmap(file); }
  catch (e) { throw new Error('这张图片打不开，请换一张'); }
  const s = Math.min(bmp.width, bmp.height), c = document.createElement('canvas'); c.width = c.height = 192;
  c.getContext('2d').drawImage(bmp, (bmp.width - s) / 2, (bmp.height - s) / 2, s, s, 0, 0, 192, 192);
  return c.toDataURL('image/jpeg', 0.85);
}
let PEND;   // undefined 没动；'' 移除；否则是新头像
act('me-edit', () => {
  const P = profile(), c = store.get('meta', 'card') || {};
  PEND = undefined;
  let d = $('#meDlg'); if (!d) { d = document.createElement('dialog'); d.id = 'meDlg'; d.setAttribute('aria-label', '编辑简介'); document.body.appendChild(d); }
  d.innerHTML = `<form class="dlg" id="meForm"><h3>编辑简介</h3>
    <div class="av-edit"><span class="avatar" id="mePrev">${P.img ? `<img src="${esc(P.img)}" alt="">` : esc(P.av)}</span>
      <div><label class="btn sm" for="meImg">选择图片</label><input id="meImg" type="file" accept="image/*" hidden><button type="button" class="btn sm gh" data-act="me-img-rm">移除图片</button><p class="hint" id="meImgMsg">会裁成正方形并缩小，只保存在你的账号里。</p></div></div>
    <label class="field"><span>没有图片时显示（一个字或一个表情）</span><input name="av" maxlength="2" value="${esc(c.av || '')}" placeholder="${esc(P.name.slice(0, 1))}"></label>
    <label class="field"><span>昵称</span><input name="name" maxlength="20" value="${esc(c.name || '')}" placeholder="学习者"></label>
    <label class="field"><span>简介</span><textarea name="bio" maxlength="80" rows="2" placeholder="例如：转行做 AI 产品，正在补 Agent 和评测">${esc(c.bio || '')}</textarea></label>
    <p class="hint">正式版开放分享之前，不会对别人显示。</p>
    <div class="ft"><button type="button" class="btn gh" data-act="me-cancel">取消</button><button class="btn pri">保存</button></div></form>`;
  d.showModal();
});
document.addEventListener('change', async e => {
  if (e.target.id !== 'meImg') return;
  const msg = $('#meImgMsg');
  try { PEND = await toAvatar(e.target.files[0]); $('#mePrev').innerHTML = `<img src="${esc(PEND)}" alt="">`; msg.textContent = '已选好，点保存生效。'; }
  catch (er) { msg.innerHTML = `<span class="err">${esc(er.message)}</span>`; }
  e.target.value = '';
});
act('me-img-rm', () => { PEND = ''; const P = profile(); $('#mePrev').textContent = P.av; $('#meImgMsg').textContent = '保存后移除图片。'; });
act('me-cancel', () => $('#meDlg').close());
document.addEventListener('submit', e => {
  const f = e.target; if (!(f.matches && f.matches('#meForm'))) return;
  e.preventDefault();
  const v = { av: f.av.value.trim().slice(0, 2), name: f.name.value.trim().slice(0, 20), bio: f.bio.value.trim().slice(0, 80) };
  store.put('meta', 'card', v.av || v.name || v.bio ? v : null);
  if (PEND !== undefined) store.put('meta', 'avatar', PEND || null);
  $('#meDlg').close(); refresh(); toast('已保存');
});
