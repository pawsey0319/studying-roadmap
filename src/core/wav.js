// PCM16 WAV 编码。容器解码由浏览器 AudioContext 完成，不以改后缀冒充转码。
export function encodeWav(channels, sampleRate) {
  if (!channels.length || !channels[0].length || !Number.isInteger(sampleRate) || sampleRate < 8000 || sampleRate > 192000) throw new Error('无效的音频数据');
  const length = channels[0].length;
  if (channels.some(c => c.length !== length)) throw new Error('音频声道长度不一致');
  const out = new ArrayBuffer(44 + length * 2), v = new DataView(out);
  const str = (at, s) => [...s].forEach((c, i) => v.setUint8(at + i, c.charCodeAt(0)));
  str(0, 'RIFF'); v.setUint32(4, 36 + length * 2, true); str(8, 'WAVE'); str(12, 'fmt ');
  v.setUint32(16, 16, true); v.setUint16(20, 1, true); v.setUint16(22, 1, true);
  v.setUint32(24, sampleRate, true); v.setUint32(28, sampleRate * 2, true); v.setUint16(32, 2, true); v.setUint16(34, 16, true);
  str(36, 'data'); v.setUint32(40, length * 2, true);
  for (let i = 0; i < length; i++) {
    const x = Math.max(-1, Math.min(1, channels.reduce((n, c) => n + c[i], 0) / channels.length));
    v.setInt16(44 + i * 2, x < 0 ? x * 32768 : x * 32767, true);
  }
  return new Blob([out], { type: 'audio/wav' });
}
export async function recordingToWav(blob, { signal } = {}) {
  signal?.throwIfAborted();
  const Audio = globalThis.AudioContext || globalThis.webkitAudioContext;
  if (!Audio) throw new Error('此设备无法转换录音格式，直接音频未发送；可自行切换转文字模式');
  const ctx = new Audio({ sampleRate: 16000 });
  try {
    const audio = await ctx.decodeAudioData(await blob.arrayBuffer());
    signal?.throwIfAborted();
    if (audio.duration > 60.5) throw new Error('录音超过60秒，未发送');
    return encodeWav(Array.from({ length: audio.numberOfChannels }, (_, i) => audio.getChannelData(i)), audio.sampleRate);
  } finally { await ctx.close(); }
}
