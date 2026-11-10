import { createScreenContext } from '../core/screencontext.js?v=20261111b';
import { act, toast } from './kit.js';
import { esc } from '../util.js';
import { createIntentBoundary } from '../core/session-lock.js';
import * as cloud from '../store/cloud.js';
const capture = createScreenContext();
const intent = createIntentBoundary();
let frame = null;
function clearPreview() {
 frame = null;
 const preview = document.getElementById('screenPreview');
 if (preview) preview.innerHTML = '';
}
function beginIntent() {
 intent.invalidate();
 clearPreview();
 return intent.ticket();
}
export function screenConsultHtml() {
 return `<details class="dctx"><summary>咨询手机正在阅读的页面</summary><div style="padding:12px"><p class="fnt">Android 授权后只在本机限频更新画面，等待你提问；不自动上传或推理。切回咨询会暂停采集；不知道来源App或网址，须由你核对。旧安卓可能共享整屏，敏感页面请先停止。</p><button type="button" class="btn sm" data-act="screen-start">授权来源页面</button> <button type="button" class="btn sm" data-act="screen-refresh">回来源刷新</button> <button type="button" class="btn sm" data-act="screen-preview">查看最近画面</button> <button type="button" class="btn sm" data-act="screen-stop">停止并清除</button><p id="screenState" role="status"></p><div id="screenPreview"></div></div></details>`;
}
function status(t) { const el = document.getElementById('screenState'); if (el) el.textContent = t; }
// Clear sensitive DOM before any native await; only the latest UI intent may render.
const run = fn => async () => {
 const current = beginIntent();
 try { await fn(current); }
 catch (e) { if (current()) { status(e.message || String(e)); toast(e.message || '页面咨询不可用'); } }
};
act('screen-start', run(async current => {
 if (!confirm('是否授权读取你选择的来源画面？系统还会询问屏幕共享权限。只在本机采集，发送前会单独确认目的地。')) return;
 await capture.start();
 if (current()) status('请完成系统授权并回到来源页面阅读；本机等待提问，不会自动上传。');
}));
act('screen-refresh', run(async current => {
 await capture.refresh(3000);
 if (current()) status('请在3秒内回到来源页面，再回这里查看；旧画面已清除。');
}));
act('screen-preview', run(async current => {
 const next = await capture.preview();
 const preview = document.getElementById('screenPreview');
 if (!current() || !preview) return;
 frame = next;
 preview.innerHTML = `<p>这是 ${esc(new Date(frame.capturedAt).toLocaleTimeString())} 的画面快照，不是实时页面。</p><img alt="本机来源画面预览" style="max-width:100%;max-height:240px" src="data:image/jpeg;base64,${esc(frame.base64)}"><p><label>请核对来源名称（不是系统识别）<input id="screenLabel" maxlength="120" placeholder="例如：微信中的课程文章"></label></p><label><input type="checkbox" id="screenInclude">下一条文字提问附上此帧（发送时再确认目的地）</label>`;
 status('画面30秒后过期；切换页面须重新刷新确认。');
}));
act('screen-stop', run(async current => {
 await capture.stop();
 if (current()) status('已停止并释放来源授权。');
}));
export async function stopScreenConsult() { beginIntent(); await capture.stop(); }
export async function takeScreenAttachment(cfg) {
 if (!document.getElementById('screenInclude')?.checked) return null;
 if (!frame) throw new Error('请先预览最新来源画面');
 const selected = frame, current = intent.ticket();
 const valid = () => current() && frame === selected;
 let model = cfg.model, destination;
 if (cfg.provider === 'hosted') {
  const info = await cloud.aiInfo();
  if (!valid()) throw new Error('画面已撤销或更换，请重新预览确认');
  model = model || info?.models?.[0];
  if (!model || !Array.isArray(info?.visionModels) || !info.visionModels.includes(model)) throw new Error('平台未明确声明当前模型支持图片，拒绝图片发送；请更新平台配置或选择支持视觉的模型。');
  const endpoint = await cloud.aiEndpoint();
  if (!valid()) throw new Error('画面已撤销或更换，请重新预览确认');
  destination = new URL(endpoint.url).origin;
 } else destination = new URL(cfg.base || '').origin;
 const sourceLabel = document.getElementById('screenLabel')?.value.trim();
 if (!sourceLabel) throw new Error('请核对并填写来源名称');
 if (!confirm(`把预览中的这一帧发送到 ${destination}（模型 ${model || '默认'}）？画面可能包含个人信息。`)) throw new Error('已取消发送画面');
 capture.confirm({ frameId: selected.frameId, sourceLabel });
 capture.authorize({ frameId: selected.frameId, destination });
 const result = await capture.attachment({ destination });
 if (!current() || frame !== selected) throw new Error('画面已撤销或更换，请重新预览确认');
 clearPreview();
 return { kind:'image', name:'来源页面快照', data:`data:${result.mimeType};base64,${result.base64}`, ephemeral:true, source:result.source, ...(cfg.provider === 'hosted' ? { verifiedModel: model } : {}) };
}
