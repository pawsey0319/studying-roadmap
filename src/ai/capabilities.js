// 这里只描述本客户端的协议与配置，不宣称某个平台/模型已经支持音频。
import { PROVIDERS, MAX_AUDIO_BYTES, audioBudget } from './providers.js';

export { MAX_AUDIO_BYTES };

export function audioCapabilities(cfg = {}) {
  const p = PROVIDERS[cfg.provider] || PROVIDERS.custom;
  // hosted 代理没有声明语音协议，不能复用它的地址、鉴权或 endpoint()。
  const sttBase = String(cfg.sttBase || (!p.hosted && p.fmt === 'openai' ? cfg.base || p.base : '') || '').trim();
  const sttKey = cfg.sttKey ?? (!p.hosted ? cfg.key : '');
  const dictationReady = !!sttBase && (!!sttKey || cfg.provider === 'custom' || !!cfg.sttBase);
  const directReady = !!String(cfg.audioBase || '').trim() && !!String(cfg.audioModel || '').trim();
  return {
    dictation: {
      supported: dictationReady,
      reason: dictationReady ? '使用 OpenAI 兼容转写接口；需自行确认接口和模型支持。' : '请配置语音转文字接口和所需的 Key；平台模型不代表已支持转写。',
      verified: false,
      maxBytes: MAX_AUDIO_BYTES
    },
    directAudio: {
      supported: directReady,
      reason: directReady ? '发送真实音频，不先转写；需自行确认模型支持 input_audio。' : '请独立配置 audioBase 和 audioModel；不会复用聊天或平台模型配置。',
      verified: false,
      formats: ['wav', 'mp3'],
      limits: audioBudget(cfg),
      maxBytes: MAX_AUDIO_BYTES
    }
  };
}
