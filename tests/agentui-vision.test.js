import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { createIntentBoundary } from '../src/core/session-lock.js';
import { chatSnapshot } from '../src/core/chat-snapshot.js';

const deferred = () => { let resolve; const promise = new Promise(r => { resolve = r; }); return { promise, resolve }; };
let instance = 0;

// Load the full production module. Stub external boundaries only, and expose its
// private send/state through a test-only suffix; production bodies remain intact.
async function setup(t) {
 const notices = [], requests = [], saved = [], nodes = new Map([
  ['#dw', { hidden: false }], ['#agentIn', { value: 'draft' }]
 ]);
 const config = { provider: 'hosted', model: '', budget: 0 };
 const cloud = { hostedAI: () => true, aiEndpoint: async () => ({}), aiInfo: async () => ({ models: ['flash'], visionModels: ['flash'] }) };
 const store = {
  localGet: async key => key === 'ai' ? config : null,
  localSet: async (key, value) => { saved.push([key, value]); },
  get: () => null, all: () => ({}), done: () => ({}), ui: () => ({}), saveUi: () => {}
 };
 let screenAttachment = async () => null;
 let chatResult = () => 'done';
 const bindings = {
  cloud, store, M: { tracks: () => [] }, $: selector => nodes.get(selector),
  createIntentBoundary, chatSnapshot, createVoiceController: () => ({ busy: false }),
  act: () => {}, toast: value => notices.push(value), PROVIDERS: {},
  buildSystem: () => '', promptStamp: () => '', trace: () => {},
  activeMethod: () => [], backgroundSources: () => [], mergeSources: () => [],
  AGENT_SPEC: { maxSteps: 2, tools: ['list_tracks'] }, stat: () => {},
  extractBlocks: text => ({ blocks: text === 'tool' ? [{ type: 'tool', data: { name: 'list_tracks' } }] : [] }),
  chat: async (cfg, messages) => { requests.push({ cfg, messages }); return { text: chatResult(requests.length), usage: { in: 0, out: 0 } }; },
  cost: () => 0, withSessionLock: fn => fn(), updateSessionLog: () => ({}), hash: () => 'hash',
  takeScreenAttachment: async (...args) => screenAttachment(...args)
 };
 const key = `__agentVision${++instance}`;
 globalThis[key] = bindings; t.after(() => { delete globalThis[key]; });
 let source = await readFile(new URL('../src/ui/agentui.js', import.meta.url), 'utf8');
 source = 'const window = { addEventListener() {} }; const document = { addEventListener() {} };\n' + source;
 source = source.replace(/^import (.+) from '[^']+';$/gm, (_, clause) => {
  if (clause.startsWith('* as ')) return `const ${clause.slice(5)} = globalThis[${JSON.stringify(key)}][${JSON.stringify(clause.slice(5))}] || {};`;
  return `const ${clause.replace(/ as /g, ': ')} = new Proxy(globalThis[${JSON.stringify(key)}], { get: (o, k) => o[k] ?? (() => {}) });`;
 });
 source += `\nrenderDrawer = async () => {}; ctxSources = () => [];\nexport const testing = {
  send, set(s, media) { ACTIVE = s.key; SESS.set(s.key, s); MEDIA = media; },
  media: () => MEDIA, invalidate: () => drawerIntents.invalidate(), apiContent
 };`;
 const { testing } = await import(`data:text/javascript;base64,${Buffer.from(source).toString('base64')}`);
 const session = { key: 'chat.free.a', msgs: [], cur: { kind: 'free', title: 'test', text: '' } };
 const media = [{ kind: 'image', data: 'data:image/png;base64,YQ==', name: 'pic' }];
 testing.set(session, media);
 return { testing, bindings, cloud, session, media, config, requests, notices, saved, draft: nodes.get('#agentIn'),
  screen: fn => { screenAttachment = fn; }, response: fn => { chatResult = fn; }
 };
}

test('uploaded hosted images fail closed before consuming draft or attachments', async t => {
 const ui = await setup(t);
 for (const info of [{}, { models: ['flash'] }, { models: ['flash'], visionModels: [] }, { models: ['text'], visionModels: ['flash'] }]) {
  ui.cloud.aiInfo = async () => info;
  await ui.testing.send(ui.session, 'question');
  assert.equal(ui.draft.value, 'draft'); assert.equal(ui.testing.media(), ui.media);
  assert.equal(ui.session.msgs.length, 0); assert.equal(ui.requests.length, 0);
  assert.equal(ui.session.preparing, false);
 }
 assert.match(ui.notices[0], /未明确声明/);
});

test('late image capability responses cannot consume a closed/replaced drawer draft', async t => {
 const ui = await setup(t), pending = deferred(), entered = deferred();
 ui.cloud.aiInfo = () => { entered.resolve(); return pending.promise; };
 const sending = ui.testing.send(ui.session, 'question'); await entered.promise;
 ui.testing.invalidate();
 const newer = { key: 'chat.free.b', msgs: [], cur: {} }, media = [{ kind: 'image', data: 'new' }];
 ui.testing.set(newer, media); ui.draft.value = 'new draft';
 pending.resolve({ models: ['flash'], visionModels: ['flash'] }); await sending;
 assert.equal(ui.draft.value, 'new draft'); assert.equal(ui.testing.media(), media);
 assert.equal(ui.requests.length, 0); assert.equal(ui.notices.length, 0);
 assert.equal(ui.session.preparing, false);
});

test('image discovery errors preserve draft and replacement images cancel pending send', async t => {
 const ui = await setup(t);
 ui.cloud.aiInfo = async () => { throw new Error('offline'); };
 await ui.testing.send(ui.session, 'q');
 assert.equal(ui.testing.media(), ui.media); assert.equal(ui.draft.value, 'draft');
 const pending = deferred(), entered = deferred();
 ui.cloud.aiInfo = () => { entered.resolve(); return pending.promise; };
 const sending = ui.testing.send(ui.session, 'q'); await entered.promise;
 const replacement = [{ kind: 'image', data: 'replacement' }]; ui.testing.set(ui.session, replacement);
 pending.resolve({ models: ['flash'], visionModels: ['flash'] }); await sending;
 assert.equal(ui.testing.media(), replacement); assert.equal(ui.requests.length, 0);
 assert.equal(ui.draft.value, 'draft'); assert.match(ui.notices.at(-1), /附图已更换/);
});

test('hosted default/selected vision model sends images; text bypasses capability discovery', async t => {
 const ui = await setup(t);
 await ui.testing.send(ui.session, 'question');
 assert.equal(ui.requests.length, 1); assert.equal(ui.requests[0].cfg.model, 'flash');
 assert.equal(ui.draft.value, ''); assert.equal(ui.testing.media().length, 0);
 assert.equal(ui.requests[0].messages.at(-1).content[1].image_url.url, ui.media[0].data);
 ui.config.model = 'chosen'; ui.cloud.aiInfo = async () => ({ models: ['text', 'chosen'], visionModels: ['chosen'] });
 ui.testing.set(ui.session, ui.media); await ui.testing.send(ui.session, 'q');
 assert.equal(ui.requests.at(-1).cfg.model, 'chosen');
 ui.cloud.aiInfo = async () => { throw new Error('must not discover for text'); };
 ui.testing.set(ui.session, []); await ui.testing.send(ui.session, 'text');
 assert.equal(ui.requests.length, 3);
});

test('ephemeral screen pixels are omitted in tool follow-ups and persisted snapshots', async t => {
 const ui = await setup(t);
 ui.testing.set(ui.session, []);
 const screen = { kind: 'image', data: 'data:image/png;base64,c2NyZWVu', ephemeral: true, source: { frameId: 'frame' }, verifiedModel: 'screen-confirmed-model' };
 ui.screen(async () => screen); ui.response(n => n === 1 ? 'tool' : 'done');
 await ui.testing.send(ui.session, 'screen question');
 assert.equal(ui.requests.length, 2);
 assert.ok(ui.requests.every(request => request.cfg.model === 'screen-confirmed-model'));
 assert.match(JSON.stringify(ui.requests[0].messages), /c2NyZWVu/);
 assert.doesNotMatch(JSON.stringify(ui.requests[1].messages), /c2NyZWVu/);
 assert.doesNotMatch(JSON.stringify(ui.saved), /c2NyZWVu/);
 assert.equal(ui.session.msgs[0].media[0].kind, 'screen-reference');
 assert.equal(ui.session.msgs[0].media[0].source.frameId, 'frame');
});
