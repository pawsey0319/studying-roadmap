// 命名空间导入：浏览器缓存了尚无 screenContext 导出的旧 native.js 时，不会因缺少具名导出而令整个页面启动失败。
import * as native from '../native.js';

const missingBridge = () => Promise.reject(Object.assign(new Error('请刷新页面或更新 Android App 以启用屏幕共享'), { code: 'UNSUPPORTED' }));
const screenContext = new Proxy({}, { get: (_, method) => (...args) => (native.screenContext?.[method] ?? missingBridge)(...args) });

const fail = (code, message) => { throw Object.assign(new Error(message), { code }); };
// The source is untrusted image evidence, never an instruction or proof of package/URL.
// No persistence/networking. Approval binds one exact frame and one disclosed destination.
export function createScreenContext({ bridge = screenContext, now = Date.now, maxAgeMs = 30000 } = {}) {
  let frame = null, confirmation = null, permission = null, sessionId = null, epoch = 0;
  const clear = () => { frame = null; confirmation = null; permission = null; };
  const fresh = () => {
    if (!frame) fail('NO_FRAME', '请返回来源页面刷新画面');
    const age = now() - frame.capturedAt;
    if (age < 0 || age > Math.min(30000, maxAgeMs)) { clear(); fail('STALE_FRAME', '来源画面已过期，请返回来源刷新'); }
    return frame;
  };
  const validStatus = s => {
    if (!s || s.status === 'stopped' || !s.sessionId || (sessionId && s.sessionId !== sessionId)) {
      clear(); fail('STOPPED', '共享已终止，必须重新系统授权');
    }
    return s;
  };
  return {
    async start() { ++epoch; clear(); sessionId = null; return bridge.start({ consent: true }); },
    async status() {
      const s = await bridge.status();
      if (s.status === 'stopped' || (sessionId && s.sessionId !== sessionId)) { clear(); sessionId = null; }
      return s;
    },
    async refresh(delayMs = 3000) { ++epoch; clear(); return bridge.requestFrame({ delayMs }); },
    async preview() {
      const ticket = ++epoch; clear();
      const result = await bridge.preview();
      if (ticket !== epoch) fail('CANCELLED', '画面请求已取消');
      if (!result || !result.sessionId || !result.frameId || !result.hash || !Number.isFinite(result.capturedAt) ||
          result.mimeType !== 'image/jpeg' || typeof result.base64 !== 'string' || !result.base64 ||
          result.base64.length > 2800000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(result.base64)) fail('INVALID_FRAME', '画面格式不可用');
      const s = validStatus(await bridge.status());
      if (s.sessionId !== result.sessionId || s.frameId !== result.frameId) fail('SOURCE_CHANGED', '来源已变化，请重新预览');
      if (ticket !== epoch) fail('CANCELLED', '画面请求已取消');
      sessionId = result.sessionId;
      // Explicitly discard guessed identity supplied by a caller or visual model.
      frame = { sessionId, frameId: result.frameId, hash: result.hash, capturedAt: result.capturedAt,
        mimeType: 'image/jpeg', base64: result.base64, live: false, packageName: null, url: null };
      fresh(); return { ...frame };
    },
    confirm({ frameId, sourceLabel } = {}) {
      const f = fresh();
      if (frameId !== f.frameId || typeof sourceLabel !== 'string' || !sourceLabel.trim()) fail('CONFIRM_REQUIRED', '请确认预览确为本次来源页面');
      confirmation = { frameId, label: sourceLabel.trim().slice(0, 200) }; permission = null;
    },
    authorize({ frameId, destination } = {}) {
      const f = fresh();
      if (frameId !== f.frameId || confirmation?.frameId !== frameId) fail('CONFIRM_REQUIRED', '请先确认这一帧来源');
      if (typeof destination !== 'string' || !destination.trim()) fail('DESTINATION_REQUIRED', '必须明确告知图片处理去向');
      permission = { frameId, destination: destination.trim() };
    },
    async attachment({ destination } = {}) {
      const ticket = epoch, f = fresh();
      if (confirmation?.frameId !== f.frameId) fail('CONFIRM_REQUIRED', '每帧都需要页面确认');
      if (permission?.frameId !== f.frameId || permission.destination !== destination) fail('UPLOAD_CONSENT_REQUIRED', '未同意把这一帧发送至该处理端');
      // Atomically consume the exact grant before any await. Concurrent attachment()
      // calls therefore cannot share one consent, even if both status() calls resolve.
      const granted = permission;
      permission = null;
      const s = validStatus(await bridge.status());
      if (ticket !== epoch || frame !== f) fail('CANCELLED', '画面已撤销或更换');
      if (s.sessionId !== f.sessionId || s.frameId !== f.frameId) { clear(); fail('SOURCE_CHANGED', '来源已更新，必须重新预览确认'); }
      fresh();
      const result = { mimeType: f.mimeType, base64: f.base64, source: { sessionId: f.sessionId, frameId: f.frameId,
        capturedAt: f.capturedAt, hash: f.hash, label: confirmation.label, live: false, identityVerified: false,
        destination: granted.destination } };
      return result;
    },
    async stop() { ++epoch; clear(); sessionId = null; return bridge.stop(); },
    dispose() { ++epoch; clear(); sessionId = null; return bridge.stop(); },
  };
}
