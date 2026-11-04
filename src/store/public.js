// 公共区域的接口：不走离线同步，直接读写服务端（只有腾讯云开发后端支持）。
import * as cloud from './cloud.js';

const COLS = 'id,author,author_name,kind,track,title,summary,version,status,adopt_count,done_count,updated_at';
const enc = encodeURIComponent;
// PostgREST 的模糊匹配：去掉会破坏语法的字符
const like = q => enc('*' + String(q).replace(/[*,()"\\]/g, ' ').trim().slice(0, 40) + '*');

export function list({ kind = 'track', track = '', q = '', limit = 60 } = {}) {
  return cloud.rest(`/public_items?select=${COLS}&status=eq.published&kind=eq.${enc(kind)}${track ? '&track=eq.' + enc(track) : ''}${q ? `&or=(title.ilike.${like(q)},summary.ilike.${like(q)})` : ''}&order=updated_at.desc&limit=${limit}`);
}
export const mine = () => cloud.rest(`/public_items?select=${COLS}&author=eq.${enc(cloud.uid())}&order=updated_at.desc`);
export async function get(id) { const r = await cloud.rest(`/public_items?select=${COLS},body&id=eq.${+id}`); return (r || [])[0] || null; }
export const versions = ids => ids.length ? cloud.rest(`/public_items?select=id,version,status&id=in.(${ids.map(Number).join(',')})`) : Promise.resolve([]);
// 最近 30 天的采用次数（数据库函数，只返回计数，不暴露是谁采用的）
export const recent = () => cloud.rest('/rpc/public_recent', { method: 'POST', body: JSON.stringify({ days: 30 }) }).catch(() => []);

export async function publish(x) {
  const r = await cloud.rest('/public_items', { method: 'POST', headers: { Prefer: 'return=representation' }, body: JSON.stringify([x]) });
  return (r || [])[0];
}
export async function update(id, patch) {
  const r = await cloud.rest(`/public_items?id=eq.${+id}`, { method: 'PATCH', headers: { Prefer: 'return=representation' }, body: JSON.stringify(patch) });
  return (r || [])[0];
}
export const remove = id => cloud.rest(`/public_items?id=eq.${+id}`, { method: 'DELETE' });

export const adopt = (id, version) => cloud.rest('/adoptions?on_conflict=item_id,user_id', { method: 'POST', headers: { Prefer: 'resolution=merge-duplicates,return=minimal' }, body: JSON.stringify([{ item_id: +id, version: +version }]) });
export const unadopt = id => cloud.rest(`/adoptions?item_id=eq.${+id}`, { method: 'DELETE' });
export const setDone = (id, done) => cloud.rest(`/adoptions?item_id=eq.${+id}`, { method: 'PATCH', headers: { Prefer: 'return=minimal' }, body: JSON.stringify({ done: !!done }) });
export const myAdoptions = () => cloud.rest('/adoptions?select=item_id,version,done');
export const report = (id, reason) => cloud.rest('/reports', { method: 'POST', headers: { Prefer: 'return=minimal' }, body: JSON.stringify([{ item_id: +id, reason: String(reason).slice(0, 300) }]) });
