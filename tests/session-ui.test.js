import test from 'node:test';
import assert from 'node:assert/strict';
import { createAccountBoundary, sessionCards, sessionDetails, cleanupSessionLocal, renderLearningSessions } from '../src/ui/learning-sessions.js';
import { createSession, appendSessionEvent, addSessionEvidence, createCheckpoint } from '../src/core/learning-session.js';
import { withSessionLock } from '../src/core/session-lock.js';

const fixture = () => {
  let s = createSession({ id: 's-test', title: '<img src=x onerror=alert(1)>', spec: 'old-v1', at: 100, source: { id: 'source', kind: 'doc', title: '<script>source</script>', version: 'v1', deviceId: 'mac' } });
  s = appendSessionEvent(s, { id: 'e1', type: 'answer', at: 200, summary: '<svg onload=alert(2)>', sourceVersion: 'v1' });
  s = addSessionEvidence(s, { id: 'ref1', eventId: 'e1', kind: 'reference', excerpt: 'javascript:alert(3)', sourceVersion: 'v1', at: 210 });
  return createCheckpoint(s, { id: 'c1', at: 220, summary: '<b>done</b>', nextStep: '<script>next</script>' });
};
test('session cards escape untrusted content and omit tombstones', () => {
  const html = sessionCards({ 'x" onclick="bad': fixture(), deleted: { status: 'deleted', title: 'hidden-tombstone' } });
  assert.ok(html.includes('&lt;img'));
  assert.ok(html.includes('x&quot; onclick=&quot;bad'));
  assert.ok(!html.includes('<img'));
  assert.ok(!html.includes('hidden-tombstone'));
});
test('detail renders event, evidence and checkpoint as escaped historical text without URL links', () => {
  const html = sessionDetails(fixture(), 's-test');
  assert.ok(!html.includes('<script>'));
  assert.ok(!html.includes('<svg'));
  assert.ok(!html.includes('href='));
  for (const text of ['e1', 'ref1', 'v1', '重新授权', '不会重放旧命令', '完成不会自动更改掌握度']) assert.ok(html.includes(text), text);
});
test('local deletion cleans indexed attachments feedback samples personal notes and chat without touching private feedback', async () => {
  const session = { ...fixture(), topic: { kind: 'doc', id: 'source' }, deletionIndex: { attachmentIds: ['a1'], qualityFeedbackIds: ['q1'], evaluationSampleIds: ['eval1'] } };
  const values = {
    learningSessions: { a: session, b: { id: 'keep', status: 'active' } },
    learningSessionAttachments: { a1: {}, a2: { sessionId: session.id }, safe: { sessionId: 'keep' } },
    qualityFeedbackOutbox: { q1: {}, q2: { sessionId: session.id }, safe: {} },
    evaluationSamples: { eval1: {}, safe: {} }, personalSessionFeedback: { a: { note: 'private' }, safe: {} },
    chatIndex: { 'chat.doc.source': { logId: session.id }, safe: {} }, 'chat.doc.source': [{ content: 'original' }], feedback: { private: 'never move' }
  };
  const storage = { localGet: async key => values[key], localSet: async (key, value) => { values[key] = value; } };
  const cleanup = await cleanupSessionLocal(storage, 'a', 300);
  assert.equal(cleanup.revokeAuthorization, true);
  assert.equal(cleanup.clearedChatSessionId, session.id);
  assert.equal(values.learningSessions.a.status, 'deleted');
  assert.equal(values.learningSessions.b.id, 'keep');
  for (const key of ['learningSessionAttachments', 'qualityFeedbackOutbox', 'evaluationSamples']) assert.deepEqual(Object.keys(values[key]), ['safe']);
  assert.deepEqual(Object.keys(values.personalSessionFeedback), ['safe']);
  assert.deepEqual(values['chat.doc.source'], []);
  assert.deepEqual(Object.keys(values.chatIndex), ['safe']);
  assert.deepEqual(values.feedback, { private: 'never move' });
  assert.equal(await cleanupSessionLocal(storage, 'a', 400), null);
});
test('deleting an archived instance preserves same-topic current chat if instance is different or unknown', async () => {
  for (const info of [{ logId: 'newer-instance' }, {}, null]) {
    const session = { ...fixture(), topic: { kind: 'doc', id: 'source' } };
    const original = [{ content: 'newer or unidentified chat' }];
    const index = info ? { 'chat.doc.source': info } : {};
    const values = { learningSessions: { old: session }, chatIndex: index, 'chat.doc.source': original };
    const storage = { localGet: async key => values[key], localSet: async (key, value) => { values[key] = value; } };
    const cleanup = await cleanupSessionLocal(storage, 'old', 300);
    assert.equal(values.learningSessions.old.status, 'deleted');
    assert.equal(cleanup.clearedChatSessionId, undefined);
    assert.deepEqual(values.chatIndex, index);
    assert.deepEqual(values['chat.doc.source'], original);
  }
});
test('session write lock serializes RMW and recovers after a rejected operation', async () => {
  const order = [];
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const first = withSessionLock(async () => { order.push('first-start'); await gate; order.push('first-end'); });
  const second = withSessionLock(async () => { order.push('second'); throw new Error('expected failure'); });
  const rejected = assert.rejects(second, /expected failure/);
  const third = withSessionLock(() => { order.push('third'); });
  await Promise.resolve();
  assert.deepEqual(order, ['first-start']);
  release(); await Promise.all([first, rejected, third]);
  assert.deepEqual(order, ['first-start', 'first-end', 'second', 'third']);
});
test('unconfigured page disables external submission and management without requiring browser DOM', async () => {
  const html = await renderLearningSessions();
  assert.ok(html.includes('服务未配置'));
  assert.match(html, /data-act="ls-admin"[^>]*disabled/);
  assert.ok(html.includes('不能授予自己管理员身份'));
});


test('account generation rejects delayed A responses after A → B → A and clears synchronously', async () => {
  let account = 'A', clears = 0, rendered = 'private inbox', state = { busy: true, notice: 'A' };
  const boundary = createAccountBoundary(() => account, () => { clears++; rendered = ''; state = { busy: false, notice: '' }; });
  for (const operation of ['admin', 'submitted', 'submit', 'delete', 'review', 'candidate', 'release']) {
    const scope = boundary.capture(); let resolve;
    const response = new Promise(r => { resolve = r; });
    const pending = (async () => {
      try { const value = await scope.wait(() => response); scope.assert(); state.notice = value; }
      catch (error) { if (scope.current()) state.notice = error.message; }
      finally { if (scope.current()) state.busy = false; }
    })();
    account = 'B'; boundary.sync(); assert.equal(rendered, '');
    account = 'A'; boundary.sync(); state.busy = true; state.notice = 'new generation';
    resolve(operation + ' private response'); await pending;
    assert.deepEqual(state, { busy: true, notice: 'new generation' });
    assert.equal(scope.current(), false);
  }
  assert.equal(clears, 14);
});
test('account guard checks before dispatch and suppresses old rejected request state', async () => {
  let account = 'A', called = false;
  const boundary = createAccountBoundary(() => account, () => {}), old = boundary.capture();
  account = 'B'; boundary.sync();
  await assert.rejects(old.wait(() => { called = true; }), /ACCOUNT_CHANGED/);
  assert.equal(called, false);
  const current = boundary.capture(); let reject;
  const pending = current.wait(() => new Promise((_, r) => { reject = r; }));
  account = 'A'; boundary.sync(); reject(new Error('old server error'));
  await assert.rejects(pending, /old server error/);
  assert.equal(current.current(), false);
});
