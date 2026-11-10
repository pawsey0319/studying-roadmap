import test from 'node:test';
import assert from 'node:assert/strict';
import { createIntentBoundary } from '../src/core/session-lock.js';

test('not-yet-sent intent stays invalid across drawer close/reopen and A→B→A', async () => {
  const gate = createIntentBoundary();
  const a = gate.ticket();
  assert.equal(a(), true);
  gate.invalidate();
  const b = gate.ticket();
  gate.invalidate();
  const reopenedA = gate.ticket();
  await Promise.resolve();
  assert.equal(a(), false);
  assert.equal(b(), false);
  assert.equal(reopenedA(), true);
});
test('invalidated preparation cannot consume new attachments', async () => {
  const gate = createIntentBoundary();
  let release;
  const pending = new Promise(resolve => { release = resolve; });
  const current = gate.ticket();
  let attachments = ['old']; let sent = false;
  const prepare = (async () => { await pending; if (!current()) return; attachments = []; sent = true; })();
  gate.invalidate(); attachments = ['new'];
  release(); await prepare;
  assert.deepEqual(attachments, ['new']); assert.equal(sent, false);
});
