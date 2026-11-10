// A developer-installed local service preset is data, never executable configuration.
export function parseMediaPreset(value) {
 if (value?.schema !== 'lh-local-media/1') throw new Error('不是本机媒体服务预设');
 const out = {};
 for (const kind of ['stt','audio']) {
   const src = value[kind]; if (!src) continue;
   const u = new URL(src.base);
   if (!['http:','https:'].includes(u.protocol) || !['127.0.0.1','localhost','[::1]'].includes(u.hostname) || u.username || u.password || u.search || u.hash) throw new Error('预设仅接受本机回环地址；手机需另设可信安全网关');
   if (typeof src.model !== 'string' || !src.model || src.model.length > 160 || typeof src.key !== 'string' || !src.key || src.key.length > 500) throw new Error('预设模型或访问令牌缺失');
   out[kind+'Base'] = u.toString().replace(/\/$/,''); out[kind+'Model'] = src.model; out[kind+'Key'] = src.key;
   if (kind === 'audio') {
     for (const [field, target, ceiling] of [['maxTokens','audioMaxTokens',32768], ['contextChars','audioContextChars',1000000], ['maxSeconds','audioMaxSeconds',3600]]) {
       if (src[field] === undefined) continue;
       if (!Number.isInteger(src[field]) || src[field] < 1 || src[field] > ceiling) throw new Error(`音频预算 ${field} 必须是 1–${ceiling} 的整数`);
       out[target] = src[field];
     }
   }
 }
 if (!Object.keys(out).length) throw new Error('预设没有可用能力');
 return out;
}
