import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const deferred = () => {
 let resolve, reject;
 const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
 return { promise, resolve, reject };
};
const image = id => ({ frameId: id, capturedAt: Date.now(), base64: Buffer.from(id).toString('base64') });
const cfg = { provider: 'custom', base: 'https://vision.example/v1', model: 'vision' };
let instance = 0;

// Import the entire production module, replacing only its capture/kit boundaries.
// Real util and createIntentBoundary ESM are retained; no function-body extraction.
async function setup(t) {
 const nodes = new Map([['screenState', { textContent: '' }]]);
 let html = '';
 nodes.set('screenPreview', {
  get innerHTML() { return html; },
  set innerHTML(value) {
   html = value;
   nodes.delete('screenInclude'); nodes.delete('screenLabel');
   if (value.includes('id="screenInclude"')) {
    nodes.set('screenInclude', { checked: false });
    nodes.set('screenLabel', { value: '' });
   }
  }
 });
 const handlers = new Map(), notices = [], calls = [];
 const capture = {
  async start() { calls.push('start'); },
  async refresh(ms) { calls.push(['refresh', ms]); },
  async preview() { return image('initial'); },
  async stop() { calls.push('stop'); },
  confirm(value) { calls.push(['confirm', value]); },
  authorize(value) { calls.push(['authorize', value]); },
  async attachment() { return { mimeType: 'image/jpeg', base64: 'YQ==', source: { frameId: 'initial' } }; }
 };
 const oldDocument = Object.getOwnPropertyDescriptor(globalThis, 'document');
 const oldConfirm = Object.getOwnPropertyDescriptor(globalThis, 'confirm');
 globalThis.document = { getElementById: id => nodes.get(id) || null };
 let consent = true;
 const confirmations = [];
 globalThis.confirm = text => { confirmations.push(text); return consent; };
 const cloud = {
  async aiInfo() { return {}; },
  async aiEndpoint() { return { url: 'https://platform.example/functions/ai?token=hidden', headers: { authorization: 'Bearer secret' } }; }
 };
 const key = `__screenConsultUiTest${++instance}`;
 globalThis[key] = { capture, cloud, act: (id, fn) => handlers.set(id, fn), toast: value => notices.push(value) };
 t.after(() => {
  delete globalThis[key];
  if (oldDocument) Object.defineProperty(globalThis, 'document', oldDocument); else delete globalThis.document;
  if (oldConfirm) Object.defineProperty(globalThis, 'confirm', oldConfirm); else delete globalThis.confirm;
 });
 let source = await readFile(new URL('../src/ui/screen-consult.js', import.meta.url), 'utf8');
 source = source
  .replace("import { createScreenContext } from '../core/screencontext.js?v=20261111b';", `const createScreenContext = () => globalThis[${JSON.stringify(key)}].capture;`)
  .replace("import { act, toast } from './kit.js';", `const { act, toast } = globalThis[${JSON.stringify(key)}];`)
  .replace("import * as cloud from '../store/cloud.js';", `const { cloud } = globalThis[${JSON.stringify(key)}];`)
  .replace("'../util.js'", JSON.stringify(new URL('../src/util.js', import.meta.url).href))
  .replace("'../core/session-lock.js'", JSON.stringify(new URL('../src/core/session-lock.js', import.meta.url).href));
 const mod = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 return {
  mod, capture, cloud, nodes, notices, calls, confirmations,
  click: name => handlers.get(`screen-${name}`)(),
  html: () => nodes.get('screenPreview').innerHTML,
  status: () => nodes.get('screenState').textContent,
  consent: value => { consent = value; },
  select() { nodes.get('screenInclude').checked = true; nodes.get('screenLabel').value = '用户核对的文章'; }
 };
}

test('refresh clears preview and attachment controls before native refresh settles', async t => {
 const ui = await setup(t);
 await ui.click('preview'); ui.select();
 const pending = deferred(); ui.capture.refresh = ms => { assert.equal(ms, 3000); return pending.promise; };
 const action = ui.click('refresh');
 assert.equal(ui.html(), '');
 assert.equal(ui.nodes.has('screenInclude'), false);
 assert.equal(await ui.mod.takeScreenAttachment(cfg), null);
 pending.resolve(); await action;
 assert.match(ui.status(), /旧画面已清除/);
});

test('start clears immediately and retains explicit permission confirmation', async t => {
 const ui = await setup(t);
 await ui.click('preview');
 ui.consent(false); await ui.click('start');
 assert.equal(ui.html(), ''); assert.deepEqual(ui.calls, []);
 await ui.click('preview');
 const pending = deferred(); ui.capture.start = () => pending.promise;
 ui.consent(true); const action = ui.click('start');
 assert.equal(ui.html(), '');
 pending.resolve(); await action;
 assert.match(ui.status(), /完成系统授权/);
});

test('exported stop clears sensitive DOM synchronously even while pending or rejected', async t => {
 const ui = await setup(t);
 await ui.click('preview'); ui.select();
 const pending = deferred(); ui.capture.stop = () => pending.promise;
 const action = ui.mod.stopScreenConsult();
 assert.equal(ui.html(), ''); assert.equal(await ui.mod.takeScreenAttachment(cfg), null);
 const rejection = assert.rejects(action, /native stop failed/);
 pending.reject(new Error('native stop failed')); await rejection;
 assert.equal(ui.html(), '');
});

test('stop button clears immediately on native rejection and reports current error', async t => {
 const ui = await setup(t); await ui.click('preview');
 const pending = deferred(); ui.capture.stop = () => pending.promise;
 const action = ui.click('stop'); assert.equal(ui.html(), '');
 pending.reject(new Error('stop rejected')); await action;
 assert.equal(ui.html(), ''); assert.equal(ui.status(), 'stop rejected');
 assert.deepEqual(ui.notices, ['stop rejected']);
});

test('late preview cannot resurrect after stop, refresh or start intent', async t => {
 const ui = await setup(t);
 for (const superseding of ['stop', 'refresh', 'start']) {
  const pending = deferred(); ui.capture.preview = () => pending.promise;
  const old = ui.click('preview');
  await ui.click(superseding); const status = ui.status();
  pending.resolve(image(`late-${superseding}`)); await old;
  assert.equal(ui.html(), ''); assert.equal(ui.status(), status);
  assert.equal(await ui.mod.takeScreenAttachment(cfg), null);
 }
});

test('only latest preview renders; missing DOM does not retain a frame', async t => {
 const ui = await setup(t), old = deferred();
 ui.capture.preview = () => old.promise;
 const action = ui.click('preview');
 ui.capture.preview = async () => image('new'); await ui.click('preview');
 const expected = ui.html(); old.resolve(image('old')); await action;
 assert.equal(ui.html(), expected); assert.ok(ui.html().includes(image('new').base64));
 ui.nodes.delete('screenPreview'); await ui.click('preview');
 assert.equal(ui.notices.length, 0);
});

test('old stop completion or rejection cannot clear or report into newer preview', async t => {
 const ui = await setup(t);
 for (const fails of [false, true]) {
  await ui.click('preview'); const pending = deferred(); ui.capture.stop = () => pending.promise;
  const action = ui.click('stop'); assert.equal(ui.html(), '');
  ui.capture.preview = async () => image(`new-${fails}`); await ui.click('preview');
  const html = ui.html(), status = ui.status();
  if (fails) pending.reject(new Error('old stop error')); else pending.resolve();
  await action;
  assert.equal(ui.html(), html); assert.equal(ui.status(), status); assert.deepEqual(ui.notices, []);
 }
});

test('exported old stop does not clear a new preview after completion', async t => {
 const ui = await setup(t), pending = deferred();
 ui.capture.stop = () => pending.promise;
 const stop = ui.mod.stopScreenConsult();
 await ui.click('preview'); const html = ui.html();
 pending.resolve(); await stop;
 assert.equal(ui.html(), html);
});

test('stale refresh/start/preview errors do not overwrite a newer UI or toast', async t => {
 const ui = await setup(t);
 for (const operation of ['refresh', 'start', 'preview']) {
  const pending = deferred(); const original = ui.capture[operation];
  ui.capture[operation] = () => pending.promise;
  const action = ui.click(operation); ui.capture[operation] = original;
  await ui.click('preview'); const html = ui.html(), status = ui.status();
  pending.reject(new Error(`old ${operation} error`)); await action;
  assert.equal(ui.html(), html); assert.equal(ui.status(), status); assert.deepEqual(ui.notices, []);
 }
});

test('late attachment after stop/refresh is rejected even if capture boundary resolves', async t => {
 const ui = await setup(t);
 for (const superseding of ['stop', 'refresh']) {
  await ui.click('preview'); ui.select();
  const pending = deferred(); ui.capture.attachment = () => pending.promise;
  const sending = ui.mod.takeScreenAttachment(cfg);
  await ui.click(superseding);
  const rejection = assert.rejects(sending, /画面已撤销或更换/);
  pending.resolve({ mimeType: 'image/jpeg', base64: 'YQ==', source: {} }); await rejection;
  assert.equal(ui.html(), '');
 }
});

test('old attachment cannot clear a new preview; current attachment keeps consent boundaries', async t => {
 const ui = await setup(t); await ui.click('preview'); ui.select();
 const pending = deferred(); ui.capture.attachment = () => pending.promise;
 const sending = ui.mod.takeScreenAttachment(cfg);
 ui.capture.preview = async () => image('replacement'); await ui.click('preview'); ui.select();
 const html = ui.html(), rejection = assert.rejects(sending, /画面已撤销或更换/);
 pending.resolve({ mimeType: 'image/jpeg', base64: 'YQ==', source: {} }); await rejection;
 assert.equal(ui.html(), html);
 await assert.rejects(ui.mod.takeScreenAttachment({ ...cfg, provider: 'hosted' }), /拒绝图片/);
 ui.consent(false); await assert.rejects(ui.mod.takeScreenAttachment(cfg), /已取消发送画面/);
 ui.consent(true);
 const result = await ui.mod.takeScreenAttachment(cfg);
 assert.equal(result.data, 'data:image/jpeg;base64,YQ=='); assert.equal(ui.html(), '');
 assert.deepEqual(ui.calls.at(-1), ['authorize', { frameId: 'replacement', destination: 'https://vision.example' }]);
});

test('hosted screen requires explicit selected/default vision capability and reveals only real endpoint origin', async t => {
 const ui = await setup(t);
 await ui.click('preview'); ui.select();
 const hosted = { provider: 'hosted', model: '', base: 'https://wrong.example' };
 for (const info of [{}, { models: ['flash'] }, { models: ['flash'], visionModels: [] }, { models: ['text'], visionModels: ['flash'] }]) {
  ui.cloud.aiInfo = async () => info;
  await assert.rejects(ui.mod.takeScreenAttachment(hosted), /未明确声明/);
  assert.equal(ui.calls.length, 0); assert.equal(ui.confirmations.length, 0);
  assert.ok(ui.html().includes('screenInclude'));
 }
 ui.cloud.aiInfo = async () => ({ models: ['text', 'flash'], visionModels: ['flash'] });
 await assert.rejects(ui.mod.takeScreenAttachment(hosted), /未明确声明/);
 const result = await ui.mod.takeScreenAttachment({ ...hosted, model: 'flash' });
 assert.equal(result.ephemeral, true); assert.equal(result.verifiedModel, 'flash');
 assert.match(ui.confirmations[0], /https:\/\/platform.example（模型 flash）/);
 assert.doesNotMatch(ui.confirmations[0], /wrong|token|hidden|secret|Bearer|functions/);
 assert.deepEqual(ui.calls.at(-1), ['authorize', { frameId: 'initial', destination: 'https://platform.example' }]);
 assert.equal(ui.html(), '');
 assert.equal(await ui.mod.takeScreenAttachment(hosted), null);
 await ui.click('preview'); ui.select();
 ui.cloud.aiInfo = async () => ({ models: ['flash'], visionModels: ['flash'] });
 await ui.mod.takeScreenAttachment(hosted);
 assert.match(ui.confirmations.at(-1), /模型 flash/);
});

test('hosted discovery failure preserves frame and never requests pixel authorization', async t => {
 const ui = await setup(t); await ui.click('preview'); ui.select();
 ui.cloud.aiInfo = async () => { throw new Error('平台能力读取失败'); };
 await assert.rejects(ui.mod.takeScreenAttachment({ provider: 'hosted' }), /能力读取失败/);
 assert.equal(ui.calls.length, 0); assert.equal(ui.confirmations.length, 0);
 assert.ok(ui.html().includes('screenInclude'));
});

test('hosted capability and endpoint awaits revalidate intent/frame before consent or authorization', async t => {
 const ui = await setup(t);
 for (const boundary of ['aiInfo', 'aiEndpoint']) {
  for (const superseding of ['stop', 'refresh', 'preview']) {
   await ui.click('preview'); ui.select();
   ui.cloud.aiInfo = async () => ({ models: ['flash'], visionModels: ['flash'] });
   ui.cloud.aiEndpoint = async () => ({ url: 'https://platform.example/ai' });
   const pending = deferred(), entered = deferred();
   ui.cloud[boundary] = () => { entered.resolve(); return pending.promise; };
   const sending = ui.mod.takeScreenAttachment({ provider: 'hosted' });
   await entered.promise;
   await ui.click(superseding); const html = ui.html(), calls = ui.calls.length;
   const rejection = assert.rejects(sending, /画面已撤销或更换/);
   pending.resolve(boundary === 'aiInfo' ? { models: ['flash'], visionModels: ['flash'] } : { url: 'https://platform.example/ai' });
   await rejection;
   assert.equal(ui.html(), html); assert.equal(ui.calls.length, calls);
   assert.equal(ui.confirmations.length, 0);
  }
 }
});
