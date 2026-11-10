// 同一页面内串行化会话日志的 read/modify/write；失败不阻断后续写入。
// Tickets bind not-yet-sent UI work to one drawer generation. A→B→A stays stale.
export function createIntentBoundary() {
  let epoch = 0;
  return { invalidate() { epoch++; }, ticket() { const started = epoch; return () => started === epoch; } };
}
let pending = Promise.resolve();
export function withSessionLock(fn) {
  const next = pending.then(() => fn());
  pending = next.catch(() => {});
  return next;
}
