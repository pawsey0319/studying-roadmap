// 对话纪要的语义检索（可选）：用 bge-m3 之类的向量模型把纪要变成向量，存进 CloudBase 的 digest_vecs 表，
// 查找时按意思找最相近的几份。没配向量模型、没登录 CloudBase，或者调用失败时，都退回到关键词搜索。
// 向量模型的地址、模型名、Key 只存在这台设备（store.localSet('embed')），不同步、不上传。
import * as store from '../store/index.js';
import * as cloud from '../store/cloud.js';

export const EMBED_DEFAULT = { base: 'https://api.siliconflow.cn/v1', model: 'BAAI/bge-m3', key: '', dim: 1024 };
export async function embedCfg() { return { ...EMBED_DEFAULT, ...((await store.localGet('embed')) || {}) }; }
export const saveEmbed = c => store.localSet('embed', { base: c.base, model: c.model, key: c.key, dim: 1024 });
// 能不能用：要有 Key（或自定义地址）并且登录了支持向量表的后端
export const embedReady = c => !!(c && c.base && c.model && (c.key || !/siliconflow/.test(c.base)) && cloud.signedIn() && cloud.supportsPublic());

// OpenAI 兼容的 /embeddings 接口
export async function embed(c, texts) {
  const r = await fetch(c.base.replace(/\/+$/, '') + '/embeddings', {
    method: 'POST', headers: { 'content-type': 'application/json', ...(c.key ? { authorization: 'Bearer ' + c.key } : {}) },
    body: JSON.stringify({ model: c.model, input: texts, encoding_format: 'float' })
  });
  if (!r.ok) throw new Error('向量模型返回 ' + r.status);
  const j = await r.json();
  const out = (j.data || []).sort((a, b) => a.index - b.index).map(d => d.embedding);
  if (!out.length || out.some(v => !Array.isArray(v) || v.length !== 1024)) throw new Error('向量维度不是 1024，换成 bge-m3 或同维度的模型');
  return out;
}
const vec = v => '[' + v.map(x => +x.toFixed(6)).join(',') + ']';

// 纪要写好后调用：算向量并存进云端。失败不影响纪要本身
export async function indexDigest(id, d) {
  const c = await embedCfg(); if (!embedReady(c)) return false;
  try {
    const [v] = await embed(c, [`${d.title}\n${d.t}`.slice(0, 4000)]);
    await cloud.rest('/digest_vecs?on_conflict=user_id,id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ id, embedding: vec(v) }]) });
    return true;
  } catch (e) { return false; }
}
export async function dropDigest(id) {
  const c = await embedCfg(); if (!embedReady(c)) return;
  cloud.rest('/digest_vecs?id=eq.' + encodeURIComponent(id), { method: 'DELETE' }).catch(() => {});
}
// 语义检索：返回纪要 ID 列表；不可用时返回 null（调用方退回关键词搜索）
export async function searchDigests(query, n = 5) {
  const c = await embedCfg(); if (!embedReady(c) || !String(query || '').trim()) return null;
  try {
    const [v] = await embed(c, [String(query).slice(0, 1000)]);
    const rows = await cloud.rest('/rpc/match_digests', { method: 'POST', body: JSON.stringify({ q: vec(v), n }) });
    return (rows || []).filter(r => r.score > 0.35).map(r => r.id);
  } catch (e) { return null; }
}
