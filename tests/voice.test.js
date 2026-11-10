import test from 'node:test';
import assert from 'node:assert/strict';
import { createVoiceController } from '../src/core/voice.js';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const tick = () => new Promise(resolve => setImmediate(resolve));
function setup(options = {}) {
  const tracks = [{ stops: 0, stop() { this.stops++; } }, { stops: 0, stop() { this.stops++; } }];
  const stream = { getTracks: () => tracks };
  const instances = [];
  class Recorder {
    constructor(input) {
      assert.equal(input, stream);
      this.state = 'inactive';
      this.mimeType = 'audio/webm;codecs=opus';
      this.stops = 0;
      this.data = new Blob(['voice'], { type: this.mimeType });
      instances.push(this);
    }
    start() { this.state = 'recording'; }
    emit(data) { this.ondataavailable?.({ data }); }
    stop() {
      this.stops++;
      this.state = 'inactive';
      const data = this.ondataavailable, stop = this.onstop;
      queueMicrotask(() => {
        data?.({ data: this.data });
        stop?.();
      });
    }
  }
  const states = [], errors = [], completed = [];
  const controller = createVoiceController({
    getUserMedia: async () => stream, Recorder,
    onState: value => states.push(value), onError: err => errors.push(err),
    onComplete: (blob, context) => completed.push({ blob, context }),
    ...options,
  });
  return { controller, tracks, stream, instances, states, errors, completed };
}

test('release preserves audio MIME, locks context and cleans resources', async () => {
  const env = setup();
  const input = { mode: 'dictate', sessionKey: 'session-one' };
  assert.equal(await env.controller.start(input), true);
  input.mode = 'question'; input.sessionKey = 'session-two';
  assert.equal(env.controller.state, 'recording');
  assert.equal(env.controller.busy, true);
  assert.equal(env.controller.release(), true);
  assert.equal(env.controller.state, 'processing');
  assert.equal(env.controller.release(), false);
  await tick();
  assert.equal(env.instances[0].stops, 1);
  assert.equal(env.completed.length, 1);
  const { blob, context } = env.completed[0];
  assert.equal(blob.type, 'audio/webm;codecs=opus');
  assert.equal(await blob.text(), 'voice');
  assert.equal(context.mode, 'dictate');
  assert.equal(context.sessionKey, 'session-one');
  assert.ok(context.durationMs >= 0);
  assert.equal(context.signal.aborted, false);
  assert.equal(env.controller.busy, false);
  assert.deepEqual(env.states, ['requesting', 'recording', 'processing', 'idle']);
  assert.deepEqual(env.tracks.map(track => track.stops), [1, 1]);
});

for (const action of ['release', 'cancel']) {
  test(`${action} during permission request stops late stream without recording`, async () => {
    const permission = deferred();
    const env = setup({ getUserMedia: () => permission.promise });
    const start = env.controller.start({ mode: 'ask' });
    assert.equal(env.controller.state, 'requesting');
    env.controller[action]();
    assert.equal(env.controller.busy, false);
    permission.resolve(env.stream);
    assert.equal(await start, false);
    assert.equal(env.instances.length, 0);
    assert.deepEqual(env.tracks.map(track => track.stops), [1, 1]);
    assert.equal(env.completed.length, 0);
    assert.equal(env.errors.length, 0);
  });
  test(`${action} during permission request suppresses late permission rejection`, async () => {
    const permission = deferred();
    const env = setup({ getUserMedia: () => permission.promise });
    const start = env.controller.start();
    env.controller[action]();
    permission.reject(new Error('permission denied'));
    assert.equal(await start, false);
    assert.equal(env.errors.length, 0);
  });
}

test('duplicate start rejects without changing active capture', async () => {
  const env = setup();
  await env.controller.start({ mode: 'first' });
  assert.equal(await env.controller.start({ mode: 'second' }), false);
  assert.equal(env.errors[0].code, 'BUSY');
  assert.equal(env.instances.length, 1);
  env.controller.release();
  await tick();
  assert.equal(env.completed[0].context.mode, 'first');
});

test('cancel recording is silent, stops tracks, and ignores queued final events', async () => {
  const env = setup();
  await env.controller.start();
  env.instances[0].emit(new Blob(['partial']));
  assert.equal(env.controller.cancel(), true);
  assert.equal(env.controller.cancel(), false);
  assert.equal(env.controller.release(), false);
  await tick();
  assert.equal(env.completed.length, 0);
  assert.equal(env.errors.length, 0);
  assert.equal(env.instances[0].stops, 1);
  assert.deepEqual(env.tracks.map(track => track.stops), [1, 1]);
});

test('cancel after release but before recorder stop event does not send', async () => {
  const env = setup();
  await env.controller.start();
  env.controller.release();
  env.controller.cancel();
  await tick();
  assert.equal(env.completed.length, 0);
  assert.equal(env.errors.length, 0);
});

test('onComplete promise keeps busy; cancel aborts and suppresses late rejection', async () => {
  const processing = deferred();
  let signal;
  const env = setup({ onComplete: (_, context) => { signal = context.signal; return processing.promise; } });
  await env.controller.start();
  env.controller.release();
  await tick();
  assert.equal(env.controller.busy, true);
  assert.equal(await env.controller.start(), false);
  env.errors.length = 0;
  env.controller.cancel();
  assert.equal(signal.aborted, true);
  await env.controller.start({ mode: 'new' });
  processing.reject(new Error('late network failure'));
  await tick();
  assert.equal(env.controller.state, 'recording');
  assert.equal(env.errors.length, 0);
  env.controller.cancel();
});

test('successful processing finally clears busy', async () => {
  const processing = deferred();
  const env = setup({ onComplete: () => processing.promise });
  await env.controller.start();
  env.controller.release();
  await tick();
  assert.equal(env.controller.busy, true);
  processing.resolve();
  await tick();
  assert.equal(env.controller.state, 'idle');
});

test('processing errors are reported and cleaned', async () => {
  const failure = new Error('network');
  const env = setup({ onComplete: async () => { throw failure; } });
  await env.controller.start();
  env.controller.release();
  await tick();
  assert.deepEqual(env.errors, [failure]);
  assert.equal(env.controller.busy, false);
});

test('empty audio is an explicit error, never onComplete', async () => {
  const env = setup();
  await env.controller.start();
  env.instances[0].data = new Blob([]);
  env.controller.release();
  await tick();
  assert.equal(env.errors[0].code, 'EMPTY_AUDIO');
  assert.equal(env.completed.length, 0);
  assert.equal(env.controller.busy, false);
});

test('byte limit cancels immediately without sending', async () => {
  const env = setup({ maxBytes: 3 });
  await env.controller.start();
  env.instances[0].emit(new Blob(['four']));
  await tick();
  assert.equal(env.errors[0].code, 'MAX_BYTES');
  assert.equal(env.completed.length, 0);
  assert.equal(env.controller.busy, false);
  assert.deepEqual(env.tracks.map(track => track.stops), [1, 1]);
});

test('oversized final chunk is rejected too', async () => {
  const env = setup({ maxBytes: 3 });
  await env.controller.start();
  env.controller.release();
  await tick();
  assert.equal(env.errors[0].code, 'MAX_BYTES');
  assert.equal(env.completed.length, 0);
});

test('maximum duration cancels and reports instead of sending', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = setup({ maxMs: 10 });
  await env.controller.start();
  t.mock.timers.tick(10);
  await tick();
  assert.equal(env.errors[0].code, 'MAX_DURATION');
  assert.equal(env.completed.length, 0);
  assert.equal(env.controller.busy, false);
  assert.deepEqual(env.tracks.map(track => track.stops), [1, 1]);
});

test('release and cancel clear maximum-duration timer', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = setup({ maxMs: 10 });
  await env.controller.start();
  env.controller.release();
  await tick();
  t.mock.timers.tick(20);
  await env.controller.start();
  env.controller.cancel();
  t.mock.timers.tick(20);
  assert.equal(env.errors.length, 0);
  assert.equal(env.completed.length, 1);
});

test('permission failure resets state and permits retry', async () => {
  let attempts = 0;
  const failure = new Error('denied');
  const env = setup({ getUserMedia: async () => { attempts++; throw failure; } });
  assert.equal(await env.controller.start(), false);
  assert.equal(env.controller.busy, false);
  assert.equal(await env.controller.start(), false);
  assert.equal(attempts, 2);
  assert.deepEqual(env.errors, [failure, failure]);
});

test('duplicate stop events complete once even while processing is pending', async () => {
  const processing = deferred();
  let calls = 0;
  const env = setup({ onComplete: () => { calls++; return processing.promise; } });
  await env.controller.start();
  const stop = env.instances[0].onstop;
  env.controller.release();
  await tick();
  stop();
  assert.equal(calls, 1);
  processing.resolve();
  await tick();
  assert.equal(env.controller.busy, false);
});

test('recorder failure cancels, reports once, and stops every track', async () => {
  const env = setup();
  await env.controller.start();
  const failure = new Error('device disconnected');
  const onerror = env.instances[0].onerror;
  onerror({ error: failure });
  onerror({ error: failure });
  await tick();
  assert.deepEqual(env.errors, [failure]);
  assert.equal(env.completed.length, 0);
  assert.equal(env.controller.busy, false);
  assert.deepEqual(env.tracks.map(track => track.stops), [1, 1]);
});

test('processing timeout covers missing stop event and ignores late recorder callbacks', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = setup({ processingTimeoutMs: 25 });
  await env.controller.start({ sessionKey: 'old' });
  const recorder = env.instances[0];
  const data = recorder.ondataavailable, stop = recorder.onstop, error = recorder.onerror;
  recorder.stop = () => { recorder.state = 'inactive'; };
  env.controller.release();
  t.mock.timers.tick(25);
  assert.equal(env.controller.busy, false);
  assert.equal(env.errors[0].code, 'PROCESSING_TIMEOUT');
  assert.equal(env.completed.length, 0);
  assert.deepEqual(env.tracks.map(track => track.stops), [1, 1]);
  await env.controller.start({ sessionKey: 'new' });
  data({ data: new Blob(['late']) });
  stop();
  error({ error: new Error('late device error') });
  assert.equal(env.controller.state, 'recording');
  assert.equal(env.errors.length, 1);
  env.controller.release();
  await tick();
  assert.equal(env.completed.length, 1);
  assert.equal(env.completed[0].context.sessionKey, 'new');
});

for (const outcome of ['resolve', 'reject']) {
  test(`processing timeout aborts hanging onComplete and ignores late ${outcome}`, async t => {
    t.mock.timers.enable({ apis: ['setTimeout'] });
    const processing = deferred();
    let signal;
    const env = setup({
      processingTimeoutMs: 25,
      onComplete: (_, context) => { signal = context.signal; return processing.promise; },
    });
    await env.controller.start();
    env.controller.release();
    await tick();
    assert.equal(env.controller.busy, true);
    t.mock.timers.tick(25);
    assert.equal(signal.aborted, true);
    assert.equal(env.errors[0].code, 'PROCESSING_TIMEOUT');
    assert.equal(env.controller.state, 'idle');
    await env.controller.start();
    processing[outcome](new Error('late response'));
    await tick();
    assert.equal(env.controller.state, 'recording');
    assert.equal(env.errors.length, 1);
    env.controller.cancel();
  });
}

test('processing timeout is cleared after success or explicit cancel', async t => {
  t.mock.timers.enable({ apis: ['setTimeout'] });
  const env = setup({ processingTimeoutMs: 25 });
  await env.controller.start();
  env.controller.release();
  await tick();
  t.mock.timers.tick(50);
  assert.equal(env.errors.length, 0);
  await env.controller.start();
  const recorder = env.instances[1];
  recorder.stop = () => { recorder.state = 'inactive'; };
  env.controller.release();
  env.controller.cancel();
  t.mock.timers.tick(50);
  assert.equal(env.errors.length, 0);
  assert.equal(env.controller.busy, false);
});

test('unsupported recorder and invalid limits are explicit errors', async () => {
  const env = setup({ Recorder: null });
  assert.equal(await env.controller.start(), false);
  assert.equal(env.errors[0].code, 'UNSUPPORTED');
  assert.throws(() => createVoiceController({ maxMs: 0 }), RangeError);
  assert.throws(() => createVoiceController({ maxBytes: Infinity }), RangeError);
  assert.throws(() => createVoiceController({ processingTimeoutMs: 0 }), RangeError);
});
