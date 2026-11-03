// 设置：AI 服务与花费、学习者档案与记忆、同步（云端账号 / Gist）、备份、方向显示
import { $, esc, iso } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import * as gist from '../store/gist.js';
import * as cloud from '../store/cloud.js';
import { PROVIDERS, chat } from '../ai/providers.js';
import { act, refresh, toast } from './kit.js';
import { aiCfg, saveCfg, usage } from './agentui.js';

let hostedInfo = null;  // 内测模型的可选模型和用量，进设置页时取一次

export async function renderSettings() {
  document.documentElement.style.setProperty('--c', '#1B2430');
  const c = await aiCfg(), u = await usage(), p = PROVIDERS[c.provider] || PROVIDERS.custom, hosted = c.provider === 'hosted';
  if (hosted && cloud.signedIn()) hostedInfo = await cloud.aiInfo().catch(e => ({ error: e.message }));
  const prof = store.get('meta', 'profile') || '', mem = store.get('meta', 'memory') || '';
  const hidden = store.ui().hiddenTracks || {};
  const allTracks = M.library().filter(t => M.adopted(t.id)).concat(Object.entries(store.all('tracks')).filter(([k]) => k.startsWith('u')).map(([, t]) => t));
  return `<div class="ph"><h1>设置</h1></div>
  <div class="g2" style="margin-top:14px;align-items:start">
    <section class="card set"><h3>AI 服务</h3>
      <p class="hint">${hosted ? '内测期间学习 Agent 用管理员提供的模型，登录后就能用，不需要自己的 Key。也可以换成自己的服务商。' : 'Key 只保存在这台设备的浏览器里，不会同步到其他设备，只发给你选的服务商。公用电脑上不要填。'}</p>
      <label class="field"><span>服务商</span><select id="aiProv">${Object.entries(PROVIDERS).filter(([k, v]) => !v.hosted || cloud.hostedAI()).map(([k, v]) => `<option value="${k}"${k === c.provider ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
      <p class="hint">${esc(p.help || '')}</p>
      ${hosted ? hostedHtml(c) : ''}
      <div${hosted ? ' hidden' : ''}>
      ${c.provider === 'custom' ? `<label class="field"><span>接口地址</span><input id="aiBase" value="${esc(c.base || '')}" placeholder="https://…/v1"></label>` : ''}
      <label class="field"><span>模型</span><input id="aiModel" list="aiModels" value="${esc(c.model || p.model)}"><datalist id="aiModels">${p.models.map(m => `<option value="${esc(m)}">`).join('')}</datalist></label>
      <label class="field"><span>API Key</span><input id="aiKey" type="password" autocomplete="off" spellcheck="false" value="${esc(c.key || '')}" placeholder="sk-…"></label>
      <label class="field"><span>价格（美元 / 百万 token，用来估算花费；免费模型填 0）</span>
        <span style="display:flex;gap:6px"><input id="aiPin" type="number" step="0.01" min="0" value="${(c.price || p.price)[0]}" aria-label="输入价格"><input id="aiPout" type="number" step="0.01" min="0" value="${(c.price || p.price)[1]}" aria-label="输出价格"></span></label>
      </div>
      <div class="sa"><button class="btn pri" data-act="ai-save">保存</button><button class="btn" data-act="ai-test">测试连接</button><span id="aiMsg" class="small"></span></div>
      <div${hosted ? ' hidden' : ''}><h3 style="margin-top:18px">花费</h3>
      <p class="small">本月（${esc(u.m)}）已用约 ¥${u.cny.toFixed(2)}，${u.calls} 次调用，${(u.tin + u.tout).toLocaleString()} token。</p>
      <label class="field"><span>每月上限（元，0 表示不限）</span><input id="aiBudget" type="number" min="0" step="1" value="${c.budget ?? 30}"></label>
      <p class="hint">用到 80% 时提醒；超过后每次调用前都要你确认。</p></div></section>
    <section class="card set"><h3>学习者档案</h3>
      <p class="hint">每次对话都会带给学习 Agent。开局规划时会自动生成，也可以直接改。</p>
      <textarea id="prof" rows="6" placeholder="还没有。开局规划时会自动生成，例如：会 Python，懂 Transformer；在准备 AI 产品经理求职……">${esc(prof)}</textarea>
      <h3 style="margin-top:14px">Agent 记住的事</h3>
      <p class="hint">你在对话里点“记住”的内容。可以删改。</p>
      <textarea id="mem" rows="4" placeholder="还没有">${esc(mem)}</textarea>
      <div class="sa"><button class="btn pri" data-act="prof-save">保存</button><button class="btn" data-act="onboard">重新规划我的路线</button></div>
      <h3 style="margin-top:18px">显示哪些方向</h3>
      <div class="chips">${allTracks.map(t => `<button class="chip" data-act="track-vis" data-id="${t.id}" aria-pressed="${!hidden[t.id]}">${esc(t.name)}</button>`).join('')}</div></section>
    <section class="card set"><h3>账号与云端同步</h3>
      ${cloud.available() ? (cloud.signedIn() ? `<p class="small">已登录：${esc(cloud.email())}。${cloud.error ? `<span class="err">同步失败：${esc(cloud.error)}</span>` : cloud.lastSync() ? '最后同步 ' + new Date(cloud.lastSync()).toLocaleString('zh-CN', { hour12: false }) : ''}</p>
          <div class="sa"><button class="btn" data-act="cloud-sync">立即同步</button><button class="btn gh" data-act="cloud-out">退出登录</button></div>`
        : `<p class="hint">用邮箱登录后，进度、调整、笔记、导入的路线会保存到云端，任何设备登录都能看到。内测期间需要先被邀请。邮件里有 6 位验证码就填到下面；只有登录链接的话，在这台设备上点开链接即可。AI 的 Key 和对话不会上传。</p>
          <form id="cloudForm" class="addit"><input id="cloudEmail" type="email" placeholder="邮箱" required><button class="btn sm">发验证码</button></form>
          <form id="cloudVerify" class="addit"${cloud.email() || localStorage.getItem('learning-hub.cloud')?.includes('pending') ? '' : ' hidden'}><input id="cloudCode" inputmode="numeric" placeholder="邮件里的 6 位验证码"><button class="btn sm pri">登录</button></form>
          <p id="cloudMsg" class="small"></p>`)
      : '<p class="hint">这个网站还没有接云端（仓库里没有 config.json）。可以用下面的 GitHub Gist 同步。</p>'}
      <h3 style="margin-top:18px">GitHub Gist 同步（备用）</h3>
      <p class="small mut" id="gistState">${gist.enabled() ? (gist.error ? '同步失败：' + esc(gist.error) : gist.lastSync() ? '已同步，最后一次 ' + new Date(gist.lastSync()).toLocaleString('zh-CN', { hour12: false }) : '已开启') : '没有开启。'}</p>
      <form id="gistForm" class="addit"><input id="gistTok" type="password" autocomplete="off" placeholder="github_pat_…（只需要 Gists 读写权限）"><button class="btn sm">${gist.enabled() ? '更换令牌' : '开启'}</button></form>
      ${gist.enabled() ? '<div class="sa"><button class="btn sm" data-act="gist-sync">立即同步</button><button class="btn sm gh" data-act="gist-off">关闭</button></div>' : ''}
      <p class="hint">在 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub 新建细粒度令牌</a>，Account permissions 里只把 Gists 设为 Read and write。</p></section>
    <section class="card set"><h3>备份</h3>
      <p class="hint">导出一份包含所有进度、调整、笔记和导入内容的文件，可以在任何设备上导入恢复。</p>
      <div class="sa"><button class="btn" data-act="exp">导出备份</button><button class="btn" data-act="imp">导入备份</button><input type="file" id="impBak" accept="application/json" hidden></div>
      <h3 style="margin-top:18px">关于数据</h3>
      <p class="small mut">公共路线和资讯：${esc(M.C.feed.updated)} 更新精选；${M.C.sources ? '快照 ' + esc(M.C.sources.updated) : '还没有每日快照'}。个人数据存在这台设备的浏览器里${cloud.signedIn() ? '，并同步到云端' : gist.enabled() ? '，并同步到你的私有 Gist' : ''}。AI 对话只留在这台设备。</p></section>
  </div>`;
}

function hostedHtml(c) {
  if (!cloud.signedIn()) return '<p class="small err">先在右边“账号与云端同步”里用邮箱登录，才能用内测模型。</p>';
  const h = hostedInfo || {};
  if (h.error) return `<p class="small err">${esc(h.error)}</p>`;
  const ms = h.models || [];
  return `${ms.length > 1 ? `<label class="field"><span>模型</span><select id="aiHostedModel">${ms.map((m, i) => `<option value="${esc(m)}"${m === c.model || (!c.model && !i) ? ' selected' : ''}>${esc(m)}${i ? '' : '（默认）'}</option>`).join('')}</select></label>` : ''}
    ${h.monthLimit ? `<p class="small">内测额度：今天 ${h.day}/${h.dayLimit} 次，本月 ${h.month}/${h.monthLimit} 次。</p>` : ''}`;
}

export function afterSettings() {
  const prov = $('#aiProv'); if (!prov) return;
  prov.onchange = async () => { const c = await aiCfg(), p = PROVIDERS[prov.value]; await saveCfg({ ...c, provider: prov.value, model: p.model, budget: p.hosted ? 0 : (c.budget || 30), price: p.price, base: prov.value === 'custom' ? c.base : '' }); refresh(); };
  const cf = $('#cloudForm');
  if (cf) cf.onsubmit = async e => { e.preventDefault(); const m = $('#cloudMsg'); m.textContent = '正在发送…'; try { await cloud.sendCode($('#cloudEmail').value.trim()); m.textContent = '验证码已发到邮箱，填到下面。'; $('#cloudVerify').hidden = false; $('#cloudCode').focus(); } catch (err) { m.innerHTML = `<span class="err">${esc(err.message)}</span>`; } };
  const cv = $('#cloudVerify');
  if (cv) cv.onsubmit = async e => { e.preventDefault(); const m = $('#cloudMsg'); try { await cloud.verify($('#cloudCode').value); m.textContent = '登录成功，正在同步…'; await cloud.syncNow(); refresh(); toast('已登录并同步'); } catch (err) { m.innerHTML = `<span class="err">${esc(err.message)}</span>`; } };
  $('#gistForm').onsubmit = async e => { e.preventDefault(); const t = $('#gistTok').value.trim(); if (!gist.TOKEN_RE.test(t)) { toast('令牌格式不对：应以 github_pat_ 或 ghp_ 开头'); return; } gist.setToken(t); await gist.syncNow(); refresh(); };
  $('#impBak').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { store.importData(JSON.parse(await f.text())); refresh(); toast('已导入备份'); } catch (err) { toast('导入失败：请选择本网站导出的备份文件'); } e.target.value = ''; };
}

act('ai-save', async () => {
  const c = await aiCfg(), base = $('#aiBase');
  if (c.provider === 'hosted') { const hm = $('#aiHostedModel'); await saveCfg({ ...c, model: hm ? hm.value : '' }); $('#aiMsg').textContent = '已保存'; return; }
  await saveCfg({ ...c, provider: $('#aiProv').value, model: $('#aiModel').value.trim(), key: $('#aiKey').value.trim(), base: base ? base.value.trim() : '', price: [+$('#aiPin').value || 0, +$('#aiPout').value || 0], budget: +$('#aiBudget').value || 0 });
  $('#aiMsg').textContent = '已保存';
});
act('ai-test', async () => {
  const m = $('#aiMsg'); m.textContent = '正在测试…';
  const base = $('#aiBase');
  const hm = $('#aiHostedModel');
  const c = $('#aiProv').value === 'hosted' ? { ...(await aiCfg()), model: hm ? hm.value : '' }
    : { provider: $('#aiProv').value, model: $('#aiModel').value.trim(), key: $('#aiKey').value.trim(), base: base ? base.value.trim() : '' };
  try { const r = await chat(c, [{ role: 'user', content: '只回复两个字：可以' }], { maxTokens: 20 }); m.innerHTML = `<span style="color:var(--ok)">连接成功：${esc(r.text.slice(0, 20))}</span>`; }
  catch (e) { m.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
});
act('prof-save', () => { store.put('meta', 'profile', $('#prof').value.trim()); store.put('meta', 'memory', $('#mem').value.trim()); toast('已保存'); });
act('track-vis', el => { const u = store.ui(); u.hiddenTracks = u.hiddenTracks || {}; u.hiddenTracks[el.dataset.id] = !u.hiddenTracks[el.dataset.id]; store.saveUi(); refresh(); });
act('cloud-sync', async () => { await cloud.syncNow(); refresh(); });
act('cloud-out', () => { cloud.signOut(); refresh(); });
act('gist-sync', async () => { await gist.syncNow(); refresh(); });
act('gist-off', () => { gist.disable(); refresh(); });
act('exp', () => {
  const blob = new Blob([JSON.stringify(store.exportData(), null, 1)], { type: 'application/json' });
  const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `学习路线备份-${iso(new Date())}.json`; a.click();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
});
act('imp', () => $('#impBak').click());
