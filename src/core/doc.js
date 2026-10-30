// 可同步文档（纯函数）。
// 一个文档 = { e: { 键: 值 }, mt: { 键: 最后修改时间戳 } }。
// 删除一项 = 从 e 里去掉但保留 mt，这样另一台设备能知道“这一项被删了”，而不是“这一项还没同步过来”。
// 多设备合并规则：每个键各自比较 mt，较新的一方获胜（last-writer-wins）。

export const newDoc = () => ({ e: {}, mt: {} });

export function setKey(doc, k, v, ts = Date.now()) {
  doc.e[k] = v; doc.mt[k] = ts;
}
export function delKey(doc, k, ts = Date.now()) {
  delete doc.e[k]; doc.mt[k] = ts;
}

// 把 remote 合并进 local（原地修改 local），返回是否有变化。
// valid(k, v) 用来过滤来自远端的非法键值，防止被篡改的同步文件写入任意内容。
export function mergeDoc(local, remote, valid = () => true) {
  if (!remote || typeof remote !== 'object') return false;
  const re = remote.e && typeof remote.e === 'object' ? remote.e : {};
  const rm = remote.mt && typeof remote.mt === 'object' ? remote.mt : {};
  let changed = false;
  for (const k of new Set([...Object.keys(re), ...Object.keys(rm)])) {
    const rt = +rm[k] || 0, lt = +local.mt[k] || 0;
    if (rt <= lt) continue;
    const has = Object.prototype.hasOwnProperty.call(re, k);
    if (has) {
      if (!valid(k, re[k])) continue;
      if (local.e[k] !== re[k]) { local.e[k] = re[k]; changed = true; }
    } else if (k in local.e) { delete local.e[k]; changed = true; }
    local.mt[k] = rt;
  }
  return changed;
}

// 两个文档内容是否完全一致（用来判断要不要上传）
export const sameDoc = (a, b) => JSON.stringify(sortKeys(a)) === JSON.stringify(sortKeys(b));
function sortKeys(d) {
  const s = o => Object.fromEntries(Object.keys(o || {}).sort().map(k => [k, o[k]]));
  return { e: s(d && d.e), mt: s(d && d.mt) };
}
