// 设置：AI 服务与花费、学习者档案与记忆、同步（云端账号 / Gist）、备份、方向显示
import { $, esc, iso } from '../util.js';
import * as M from '../model.js';
import * as store from '../store/index.js';
import * as gist from '../store/gist.js';
import * as cloud from '../store/cloud.js';
import { PROVIDERS, chat } from '../ai/providers.js';
import { parseMediaPreset } from '../core/media-preset.js';
import { act, refresh, toast } from './kit.js';
import { aiCfg, saveCfg, usage } from './agentui.js';
import { embedCfg, saveEmbed, embedReady, embed } from '../ai/embed.js';
import { isNative, saveFile, scheduleReminder } from '../native.js';
import { checkUpdate, currentVersion } from '../update.js';
import { appearanceHtml } from './appearance.js';
import { pendingSuggestions } from './suggest.js';
import { isEn } from '../i18n.js';
import { AGENT_SPEC, feedbackRows, feedbackSummary, feedbackJsonl, traceRows, clearTrace } from '../ai/harness.js';

let hostedInfo = null, settingsPage = null, settingsGeneration = 0;
const HOSTED_TIMEOUT = 10000;
const hostedAccount = () => JSON.stringify([cloud.signedIn(), cloud.uid(), cloud.email(), cloud.backendName()]);
// 离开后即使又回到同一地址，旧页面的结果也不能写入新页面。
window.addEventListener('hashchange', () => { settingsGeneration++; settingsPage = null; hostedInfo = null; });

export async function renderSettings() {
  const page = settingsPage = { generation: ++settingsGeneration, account: hostedAccount(), hash: location.hash };
  hostedInfo = null;
  document.documentElement.style.setProperty('--c', '#1B2430');
  const ec = await embedCfg(), rm = (await store.localGet('remind')) || { on: false, hour: 21, minute: 0 };
  const c = await aiCfg(), u = await usage(), p = PROVIDERS[c.provider] || PROVIDERS.custom, hosted = c.provider === 'hosted';
  page.config = c;
  const prof = store.get('meta', 'profile') || '', mem = store.get('meta', 'memory') || '';
  const hidden = store.ui().hiddenTracks || {};
  const allTracks = M.library().filter(t => M.adopted(t.id)).concat(Object.entries(store.all('tracks')).filter(([k]) => k.startsWith('u')).map(([, t]) => t));
  const later = Object.keys(store.all('later')).filter(id => !M.isRead(id)).length, sugs = pendingSuggestions().length;
  const row = (href, t, n = '') => `<a class="srow" href="${href}"><b>${t}</b><span class="fnt">${n}</span><i aria-hidden="true">›</i></a>`;
  const OA = matchMedia('(max-width: 820px)').matches ? '' : ' open';
  return `<div class="ph"><h1>设置</h1></div>
  <div class="g2" style="margin-top:14px;align-items:start">
    <details class="card set"${OA}><summary><h3>功能</h3><span class="chev">›</span></summary><div class="set-b">
      ${row('#/method', '我的学习方法')}${row('#/suggestions', '等你确认', sugs ? sugs + ' 条' : '')}${row('#/notes', '全部笔记', Object.keys(store.all('cards')).length + ' 张卡片')}${row('#/later', '稍后在电脑上读', later ? later + ' 条' : '')}
      ${row('#/channels', '资讯渠道', '增删订阅源')}${row('#/biz', '落地与商机（全部方向）')}${row('#/library', '路线库', '加入或移出方向')}${row('#/import', '导入文档')}${cloud.supportsPublic() ? row('#/public', '公共区域') : ''}
      <button type="button" class="srow" data-act="lang"><b>${isEn() ? '中文' : 'English'}</b><span class="fnt">${isEn() ? '切换到中文' : 'Switch language'}</span><i aria-hidden="true">›</i></button></div></details>
    ${appearanceHtml()}
    <details class="card set"${OA}><summary><h3>AI 服务</h3><span class="chev">›</span></summary><div class="set-b">
      <p class="hint">${hosted ? '学习 Agent 用本站提供的模型，登录后就能用，不需要自己的 Key。每天和每月有免费次数，用完后可以换成自己的服务商。' : 'Key 只保存在这台设备的浏览器里，不会同步到其他设备，只发给你选的服务商。公用电脑上不要填。'}</p>
      <label class="field"><span>服务商</span><select id="aiProv">${Object.entries(PROVIDERS).filter(([k, v]) => !v.hosted || cloud.hostedAI()).map(([k, v]) => `<option value="${k}"${k === c.provider ? ' selected' : ''}>${esc(v.name)}</option>`).join('')}</select></label>
      <p class="hint">${esc(p.help || '')}</p>
      <label class="ck small"><input type="checkbox" data-autosum${store.ui().autoSum === false ? '' : ' checked'}> 点开资讯时自动生成“讲了什么”的总结。每条用量很小；在 App 里会读取原文的前几千字，网页版只用标题和来源摘要。</label>
      ${hosted ? `<div id="hostedInfo" data-generation="${page.generation}" aria-live="polite">${hostedHtml(c)}</div>` : ''}
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
      <p class="hint">用到 80% 时提醒；超过后每次调用前都要你确认。</p></div>
      <h3 style="margin-top:18px">向量模型（可选）</h3>
      <p class="hint">用来按意思查找过去的对话纪要。不填时按关键词查找。默认是硅基流动的免费模型 BAAI/bge-m3，需要在 cloud.siliconflow.cn 注册后创建 API Key 填在这里；也可以填你的聚合接口地址和它的 bge-m3 模型名（向量要 1024 维）。只在登录腾讯云开发后生效。Key 只存在这台设备。</p>
      <label class="field"><span>接口地址</span><input id="emBase" value="${esc(ec.base)}" placeholder="https://…/v1"></label>
      <label class="field"><span>模型</span><input id="emModel" value="${esc(ec.model)}"></label>
      <label class="field"><span>API Key</span><input id="emKey" type="password" autocomplete="off" spellcheck="false" value="${esc(ec.key)}" placeholder="sk-…（明天填）"></label>
      <div class="sa"><button class="btn" data-act="em-save">保存并测试</button><span id="emMsg" class="small">${embedReady(ec) ? '已启用' : cloud.signedIn() ? '未启用：还没有填 Key' : '未启用：需要先登录腾讯云开发'}</span></div>
      <h3 style="margin-top:18px">本机媒体服务</h3><p class="hint">导入开发者安装器生成的本机预设后自动填入ASR/直听配置。配置仅本设备保存；请勿导入别人发来的配置，因为其中接口会接收录音。</p><label class="btn sm" for="mediaPreset">导入本机服务预设</label><input type="file" id="mediaPreset" accept="application/json,.json" hidden><span id="mediaPresetMsg" role="status"></span>
      <h3 style="margin-top:18px">语音转文字（可选）</h3>
      <p class="hint">语音模式关闭时按住说话，松开转成文字，由你编辑再发送。使用独立 /audio/transcriptions；不继承平台地址或平台令牌。开发者提供本地预设，可用已安装的小模型，不必自行研究ASR选型。录音只发给明确配置的转写服务。</p>
      <label class="field"><span>接口地址（不填用上面的服务商）</span><input id="sttBase" value="${esc(c.sttBase || '')}" placeholder="https://api.openai.com/v1"></label>
      <label class="field"><span>模型</span><input id="sttModel" value="${esc(c.sttModel || '')}" placeholder="whisper-1"></label>
      <label class="field"><span>API Key（不填用上面的 Key）</span><input id="sttKey" type="password" autocomplete="off" value="${esc(c.sttKey || '')}" placeholder="sk-…"></label>
      <h3 style="margin-top:18px">直接音频理解（独立配置）</h3><p class="hint">开启语音模式后，松开将录音发送到这里的音频理解模型，默认文字回复。采用支持 input_audio 的 Chat Completions 服务；不是转写接口。不继承平台或文本服务的地址和 Key。配置不代表模型已验证；录音只发给你指定的服务。</p><label class="field"><span>音频理解接口地址</span><input id="audioBase" value="${esc(c.audioBase || '')}" placeholder="https://你的音频服务/v1"></label><label class="field"><span>音频模型</span><input id="audioModel" value="${esc(c.audioModel || '')}"></label><label class="field"><span>独立 API Key（本地无鉴权可留空）</span><input id="audioKey" type="password" autocomplete="off" value="${esc(c.audioKey || '')}"></label><div class="sa"><button class="btn" data-act="stt-save">保存语音设置</button><span id="sttMsg" class="small"></span></div></div></details>
    <details class="card set"${OA}><summary><h3>学习 Agent</h3><span class="chev">›</span></summary><div class="set-b">
      <p class="small">当前版本 <b>${AGENT_SPEC.name} ${AGENT_SPEC.version}</b>。Agent 的提示词、工具和规则由开发者统一发版，不开放给用户改；你的学习者档案和反馈会帮助下一版调整。</p>
      <p class="small mut" id="fbSummary">已记录 ${feedbackSummary().total} 条反馈。</p>
      <div class="sa"><button class="btn sm" data-act="fb-export">导出反馈给开发者</button><button class="btn sm gh" data-act="trace-export">导出诊断记录</button><button class="btn sm gh" data-act="trace-clear">清空诊断</button></div>
      <p class="hint">反馈包含评分、原因、回答的节选和相关资料名称，不包含完整对话、笔记原文或 API Key。诊断记录只在这台设备上，用于排查调用失败。</p></div></details>
    <details class="card set"${OA}><summary><h3>学习者档案</h3><span class="chev">›</span></summary><div class="set-b">
      <p class="hint">每次对话都会带给学习 Agent。开局规划时会自动生成，也可以直接改。</p>
      <textarea id="prof" rows="6" placeholder="还没有。开局规划时会自动生成，例如：会 Python，懂 Transformer；在准备 AI 产品经理求职……">${esc(prof)}</textarea>
      <h3 style="margin-top:14px">Agent 记住的事</h3>
      <p class="hint">你在对话里点“记住”的内容。可以删改。</p>
      <textarea id="mem" rows="4" placeholder="还没有">${esc(mem)}</textarea>
      <div class="sa"><button class="btn pri" data-act="prof-save">保存</button><button class="btn" data-act="onboard">重新规划我的路线</button></div>
      <h3 style="margin-top:18px">显示哪些方向</h3>
      <div class="chips">${allTracks.map(t => `<button class="chip" data-act="track-vis" data-id="${t.id}" aria-pressed="${!hidden[t.id]}">${esc(t.name)}</button>`).join('')}</div></div></details>
    <details class="card set"${OA}><summary><h3>账号与云端同步</h3><span class="chev">›</span></summary><div class="set-b">
      ${cloud.available() ? (cloud.signedIn() ? `<p class="small">已登录（${esc(cloud.backendName())}）：${esc(cloud.email())}。${cloud.error ? `<span class="err">同步失败：${esc(cloud.error)}</span>` : cloud.lastSync() ? '最后同步 ' + new Date(cloud.lastSync()).toLocaleString('zh-CN', { hour12: false }) : ''}</p>
          <div class="sa"><button class="btn" data-act="cloud-sync">立即同步</button><button class="btn gh" data-act="cloud-out">退出登录</button>${cloud.canDelete() ? '<button class="btn gh" data-act="cloud-del">注销账号</button>' : ''}</div>`
        : `${cloud.justMigrated() ? '<p class="note small">云端已经换到新的服务器。用同一个邮箱重新登录一次，这台设备上的数据会自动推上去。</p>' : ''}<p class="hint">用邮箱验证码登录（${esc(cloud.backendName())}）。第一次登录会自动建账号。登录后进度、调整、笔记、导入的路线会保存到云端，任何设备登录都能看到。AI 的 Key 和原始对话不会上传。</p>
          <form id="cloudForm" class="addit"><input id="cloudEmail" type="email" placeholder="邮箱" required><button class="btn sm">发验证码</button></form>
          <label class="ck small"><input type="checkbox" id="cloudAgree"> 我已阅读并同意<a href="#/legal/terms">《用户协议》</a>和<a href="#/legal/privacy">《隐私政策》</a></label>
          <form id="cloudVerify" class="addit"${cloud.pendingEmail() ? '' : ' hidden'}><input id="cloudCode" inputmode="numeric" placeholder="邮件里的 6 位验证码"><button class="btn sm pri">登录</button></form>
          <p id="cloudMsg" class="small"></p>`)
      : '<p class="hint">这个网站还没有接云端（仓库里没有 config.json）。可以用下面的 GitHub Gist 同步。</p>'}
      <h3 style="margin-top:18px">GitHub Gist 同步（备用）</h3>
      <p class="small mut" id="gistState">${gist.enabled() ? (gist.error ? '同步失败：' + esc(gist.error) : gist.lastSync() ? '已同步，最后一次 ' + new Date(gist.lastSync()).toLocaleString('zh-CN', { hour12: false }) : '已开启') : '没有开启。'}</p>
      <form id="gistForm" class="addit"><input id="gistTok" type="password" autocomplete="off" placeholder="github_pat_…（只需要 Gists 读写权限）"><button class="btn sm">${gist.enabled() ? '更换令牌' : '开启'}</button></form>
      ${gist.enabled() ? '<div class="sa"><button class="btn sm" data-act="gist-sync">立即同步</button><button class="btn sm gh" data-act="gist-off">关闭</button></div>' : ''}
      <p class="hint">在 <a href="https://github.com/settings/personal-access-tokens/new" target="_blank" rel="noopener">GitHub 新建细粒度令牌</a>，Account permissions 里只把 Gists 设为 Read and write。</p></div></details>
    ${isNative() ? remindHtml(rm) + `<details class="card set"${OA}><summary><h3>版本</h3><span class="chev">›</span></summary><div class="set-b"><p class="small">当前版本 <b id="appVer">…</b>。有新版本时打开 App 会提示，点“立即更新”就会下载并覆盖安装。</p><div class="sa"><button class="btn" data-act="app-update">检查更新</button></div></div></details>` : ''}
    <details class="card set"${OA}><summary><h3>备份</h3><span class="chev">›</span></summary><div class="set-b">
      <p class="hint">导出一份包含所有进度、调整、笔记和导入内容的文件，可以在任何设备上导入恢复。</p>
      <div class="sa"><button class="btn" data-act="exp">导出备份</button><button class="btn" data-act="imp">导入备份</button><input type="file" id="impBak" accept="application/json" hidden></div>
      <h3 style="margin-top:18px">关于数据</h3>
      <p class="small"><a href="#/legal/privacy">隐私政策</a> · <a href="#/legal/terms">用户协议</a></p>
      <p class="small mut">公共路线和资讯：${esc(M.C.feed.updated)} 更新精选；${M.C.sources ? '快照 ' + esc(M.C.sources.updated) : '还没有每日快照'}。个人数据存在这台设备的浏览器里${cloud.signedIn() ? '，并同步到云端' : gist.enabled() ? '，并同步到你的私有 Gist' : ''}。AI 对话只留在这台设备。</p></div></details>
  </div>`;
}

document.addEventListener('change', e => { if (e.target.matches && e.target.matches('input[data-autosum]')) { store.ui().autoSum = e.target.checked; store.saveUi(); } });
function remindHtml(r) {
  const t = `${String(r.hour).padStart(2, '0')}:${String(r.minute).padStart(2, '0')}`;
  return `<details class="card set"${matchMedia('(max-width: 820px)').matches ? '' : ' open'}><summary><h3>每天提醒</h3><span class="chev">›</span></summary><div class="set-b"><p class="hint">在这台手机上每天定时提醒一次，内容是你当前在学的阶段。不经过服务器。</p>
    <form data-remind class="addit"><label class="small"><input type="checkbox" name="on"${r.on ? ' checked' : ''}> 开启</label><input name="t" type="time" value="${t}"><button class="btn sm">保存</button></form><p id="rmMsg" class="small"></p></div></details>`;
}
export function remindBody() {
  const d = M.doing()[0];
  return d ? (d.kind === 'stage' ? `${d.t.short || d.t.name} · ${d.s.title}（${d.s.prog.n}/${d.s.prog.total}）` : `前沿：${d.r.title}`) : '打开看看今天学什么';
}
document.addEventListener('submit', async e => {
  const f = e.target; if (!(f.matches && f.matches('form[data-remind]'))) return;
  e.preventDefault(); const [h, m] = (f.t.value || '21:00').split(':').map(Number), cfg = { on: f.on.checked, hour: h, minute: m };
  await store.localSet('remind', cfg);
  const err = await scheduleReminder(cfg, remindBody()).catch(x => x.message);
  $('#rmMsg').innerHTML = err ? `<span class="err">${esc(err)}</span>` : cfg.on ? `已设好：每天 ${f.t.value} 提醒` : '已关闭提醒';
});
function hostedHtml(c) {
  if (!cloud.signedIn()) return '<p class="small err">先在“账号与云端同步”里用邮箱登录，才能用平台模型。</p>';
  const h = hostedInfo || {};
  if (h.error) return `<p class="small err">${esc(h.error)}</p><button type="button" class="btn sm" data-hosted-retry>重试</button>`;
  if (!hostedInfo) return '<p class="small" role="status">正在加载平台模型与额度…（不影响其他设置）</p>';
  const ms = h.models || [];
  return `${ms.length > 1 ? `<label class="field"><span>模型</span><select id="aiHostedModel">${ms.map((m, i) => `<option value="${esc(m)}"${m === c.model || (!c.model && !i) ? ' selected' : ''}>${esc(m)}${i ? '' : '（默认）'}</option>`).join('')}</select></label>` : ''}
    ${h.monthLimit ? `<p class="small">${h.plan === 'sub' ? '订阅额度' : '免费额度'}：今天 ${h.day}/${h.dayLimit} 次，本月 ${h.month}/${h.monthLimit} 次${h.lightLimit ? `；自动总结和翻译今天 ${h.light || 0}/${h.lightLimit} 次` : ''}。</p>` : ''}`;
}

async function loadHosted(page, container) {
  const current = () => settingsPage === page && page.generation === settingsGeneration &&
    location.hash === page.hash && hostedAccount() === page.account &&
    $('#hostedInfo') === container && container.isConnected && $('#aiProv')?.value === 'hosted';
  if (!current() || !cloud.signedIn()) return;
  const request = page.request = (page.request || 0) + 1;
  hostedInfo = null;
  container.innerHTML = hostedHtml(page.config);
  let timer;
  try {
    const info = await Promise.race([
      Promise.resolve().then(() => current() && page.request === request ? cloud.aiInfo() : null),
      new Promise((_, reject) => { timer = setTimeout(() => reject(new Error('平台模型与额度加载超时，请重试；其他设置仍可使用。')), HOSTED_TIMEOUT); })
    ]);
    if (!current() || page.request !== request) return;
    hostedInfo = info || {};
  } catch (error) {
    if (!current() || page.request !== request) return;
    hostedInfo = { error: error.message || '平台模型与额度加载失败，请重试。' };
  } finally { clearTimeout(timer); }
  if (!current() || page.request !== request) return;
  container.innerHTML = hostedHtml(page.config);
  const retry = container.querySelector('[data-hosted-retry]');
  if (retry) retry.onclick = () => loadHosted(page, container);
}

export function afterSettings() {
  const page = settingsPage, container = $('#hostedInfo');
  if (page && container && container.dataset.generation === String(page.generation)) void loadHosted(page, container);
  const preset = $('#mediaPreset');
  if (preset) preset.onchange = async e => {
    const file = e.target.files[0]; e.target.value = ''; if (!file) return;
    try {
      if (file.size > 10000) throw new Error('预设文件过大');
      const patch = parseMediaPreset(JSON.parse(await file.text()));
      if (!confirm('使用此本机媒体服务预设？录音将发送到文件指定的回环地址，只会更改本设备语音配置。')) return;
      await saveCfg({ ...await aiCfg(), ...patch }); refresh(); toast('本机媒体配置已导入；服务运行和真实能力仍需检测');
    } catch (err) { toast(err.message || '预设不可用'); }
  };
  if (isNative()) currentVersion().then(v => { const el = $('#appVer'); if (el) el.textContent = v.name ? `${v.name}（${v.code}）` : '未知'; });
  const prov = $('#aiProv'); if (!prov) return;
  prov.onchange = async () => { const c = await aiCfg(), p = PROVIDERS[prov.value]; await saveCfg({ ...c, provider: prov.value, model: p.model, budget: p.hosted ? 0 : (c.budget || 30), price: p.price, base: prov.value === 'custom' ? c.base : '' }); refresh(); };
  const cf = $('#cloudForm');
  if (cf) cf.onsubmit = async e => { e.preventDefault(); const m = $('#cloudMsg'); if (!$('#cloudAgree').checked) { m.innerHTML = '<span class="err">请先勾选同意《用户协议》和《隐私政策》</span>'; return; } m.textContent = '正在发送…'; try { await cloud.sendCode($('#cloudEmail').value.trim()); m.textContent = '验证码已发到邮箱（10 分钟内有效），填到下面。'; $('#cloudVerify').hidden = false; $('#cloudCode').focus(); } catch (err) { m.innerHTML = `<span class="err">${esc(err.message)}</span>`; } };
  const cv = $('#cloudVerify');
  if (cv) cv.onsubmit = async e => { e.preventDefault(); const m = $('#cloudMsg'); try { await cloud.verify($('#cloudCode').value); m.textContent = '登录成功，正在同步…'; await cloud.syncNow(); refresh(); toast('已登录并同步'); } catch (err) { m.innerHTML = `<span class="err">${esc(err.message)}</span>`; } };
  $('#gistForm').onsubmit = async e => { e.preventDefault(); const t = $('#gistTok').value.trim(); if (!gist.TOKEN_RE.test(t)) { toast('令牌格式不对：应以 github_pat_ 或 ghp_ 开头'); return; } gist.setToken(t); await gist.syncNow(); refresh(); };
  $('#impBak').onchange = async e => { const f = e.target.files[0]; if (!f) return; try { store.importData(JSON.parse(await f.text())); refresh(); toast('已导入备份'); } catch (err) { toast('导入失败：请选择本网站导出的备份文件'); } e.target.value = ''; };
}

act('ai-save', async () => {
  const c = await aiCfg(), base = $('#aiBase');
  if (c.provider === 'hosted') { const hm = $('#aiHostedModel'); await saveCfg({ ...c, model: hm ? hm.value : c.model || '' }); $('#aiMsg').textContent = '已保存'; return; }
  await saveCfg({ ...c, provider: $('#aiProv').value, model: $('#aiModel').value.trim(), key: $('#aiKey').value.trim(), base: base ? base.value.trim() : '', price: [+$('#aiPin').value || 0, +$('#aiPout').value || 0], budget: +$('#aiBudget').value || 0 });
  $('#aiMsg').textContent = '已保存';
});
act('ai-test', async () => {
  const m = $('#aiMsg'); m.textContent = '正在测试…';
  const base = $('#aiBase');
  const hm = $('#aiHostedModel');
  const saved = await aiCfg();
  const c = $('#aiProv').value === 'hosted' ? { ...saved, model: hm ? hm.value : saved.model || '' }
    : { provider: $('#aiProv').value, model: $('#aiModel').value.trim(), key: $('#aiKey').value.trim(), base: base ? base.value.trim() : '' };
  try { const r = await chat(c, [{ role: 'user', content: '只回复两个字：可以' }], { maxTokens: 20, feat: 'test' }); m.innerHTML = `<span style="color:var(--ok)">连接成功：${esc(r.text.slice(0, 20))}</span>`; }
  catch (e) { m.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
});
act('prof-save', () => { store.put('meta', 'profile', $('#prof').value.trim()); store.put('meta', 'memory', $('#mem').value.trim()); toast('已保存'); });
act('track-vis', el => { const u = store.ui(); u.hiddenTracks = u.hiddenTracks || {}; u.hiddenTracks[el.dataset.id] = !u.hiddenTracks[el.dataset.id]; store.saveUi(); refresh(); });
act('cloud-sync', async () => { await cloud.syncNow(); refresh(); });
act('cloud-out', () => { cloud.signOut(); refresh(); });
act('gist-sync', async () => { await gist.syncNow(); refresh(); });
act('gist-off', () => { gist.disable(); refresh(); });
act('exp', () => {
  saveFile(`学习路线备份-${iso(new Date())}.json`, JSON.stringify(store.exportData(), null, 1), 'application/json').catch(e => toast('保存失败：' + e.message));
});
act('imp', () => $('#impBak').click());
act('app-update', () => checkUpdate({ manual: true }));
act('stt-save', async () => {
  const c = await aiCfg();
  await saveCfg({ ...c, sttBase: $('#sttBase').value.trim(), sttModel: $('#sttModel').value.trim(), sttKey: $('#sttKey').value.trim(), audioBase: $('#audioBase').value.trim(), audioModel: $('#audioModel').value.trim(), audioKey: $('#audioKey').value.trim() });
  $('#sttMsg').textContent = '已保存';
});
act('fb-export', () => {
  const rows = feedbackRows();
  if (!rows.length) { toast('还没有反馈'); return; }
  saveFile(`学习Agent反馈-${iso(new Date())}.jsonl`, feedbackJsonl(rows), 'application/x-ndjson').catch(e => toast('保存失败：' + e.message));
});
act('trace-export', async () => {
  const rows = await traceRows();
  if (!rows.length) { toast('还没有诊断记录'); return; }
  saveFile(`学习Agent诊断-${iso(new Date())}.json`, JSON.stringify({ spec: AGENT_SPEC.version, rows }, null, 1), 'application/json').catch(e => toast('保存失败：' + e.message));
});
act('trace-clear', async () => { await clearTrace(); toast('已清空诊断记录'); });
act('em-save', async () => {
  const c = { base: $('#emBase').value.trim(), model: $('#emModel').value.trim(), key: $('#emKey').value.trim() }, m = $('#emMsg');
  await saveEmbed(c); m.textContent = '已保存，正在测试…';
  if (!c.key && /siliconflow/.test(c.base)) { m.textContent = '已保存。还没有填 Key，先按关键词查找'; return; }
  try { await embed(c, ['测试']); m.innerHTML = `<span style="color:var(--ok)">可以用（1024 维）${cloud.signedIn() ? '' : '，登录腾讯云开发后生效'}</span>`; }
  catch (e) { m.innerHTML = `<span class="err">${esc(e.message)}</span>`; }
});

// 注销账号：两次确认 + 邮箱验证码。云端数据和账号删除后不能恢复；本机数据保留，需要的话用“导出备份”另存
act('cloud-del', async () => {
  if (!confirm('注销后，云端的进度、笔记、纪要、你公开的内容和账号都会删除，不能恢复。这台设备上的数据会保留。建议先“导出备份”。继续吗？')) return;
  try { await cloud.startDelete(); } catch (e) { toast(e.message); return; }
  const code = prompt('验证码已发到你的登录邮箱（5 分钟内有效）。填入验证码，确认注销：');
  if (!code) { toast('已取消注销'); return; }
  try { await cloud.finishDelete(code); refresh(); toast('账号已注销'); } catch (e) { toast(e.message); }
});
