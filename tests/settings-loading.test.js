import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const deferred = () => {
  let resolve, reject;
  const promise = new Promise((yes, no) => { resolve = yes; reject = no; });
  return { promise, resolve, reject };
};
const flush = async () => { for (let i = 0; i < 12; i++) await Promise.resolve(); };
let sequence = 0;

// Execute the entire production ESM (including action registration), mocking only imports/DOM/timers.
async function setup(t, provider = 'hosted', signedIn = true) {
  const nodes = new Map(), actions = new Map(), events = new Map(), timers = new Map();
  let config = { provider, model: 'chosen-model', price: [0, 0] }, uid = 'A', calls = 0, refreshes = 0;
  const request = deferred(), chats = [];
  const cloud = {
    signedIn: () => signedIn, uid: () => uid, email: () => uid + '@example.test', backendName: () => 'mock',
    supportsPublic: () => false, hostedAI: () => true, available: () => true, canDelete: () => false,
    lastSync: () => 0, pendingEmail: () => '', justMigrated: () => false,
    aiInfo: () => { calls++; return request.promise; }
  };
  const deps = {
    '../util.js': { $: selector => nodes.get(selector.slice(1)) || null, esc: value => String(value ?? '').replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('"', '&quot;'), iso: () => '' },
    '../model.js': { library: () => [], adopted: () => true, isRead: () => false, C: { feed: { updated: '' } } },
    '../store/index.js': { localGet: async () => null, get: () => '', ui: () => ({}), all: () => ({}) },
    '../store/gist.js': { enabled: () => false }, '../store/cloud.js': cloud,
    '../ai/providers.js': { PROVIDERS: { hosted: { hosted: true, name: '平台', models: [], price: [0, 0] }, custom: { name: '自定义', models: [], model: 'default', price: [0, 0] } }, chat: async c => { chats.push(c); return { text: '可以' }; } },
    '../core/media-preset.js': { parseMediaPreset: x => x },
    './kit.js': { act: (name, fn) => actions.set(name, fn), refresh: () => refreshes++, toast: () => {} },
    './agentui.js': { aiCfg: async () => ({ ...config }), saveCfg: async c => { config = c; }, usage: async () => ({ m: '', cny: 0, calls: 0, tin: 0, tout: 0 }) },
    '../ai/embed.js': { embedCfg: async () => ({ base: '', model: '', key: '' }), embedReady: () => false },
    '../native.js': { isNative: () => false }, '../update.js': {},
    './appearance.js': { appearanceHtml: () => '<div>本地外观</div>' }, './suggest.js': { pendingSuggestions: () => [] },
    '../i18n.js': { isEn: () => false }, '../ai/harness.js': { AGENT_SPEC: { name: 'test', version: '1' }, feedbackSummary: () => ({ total: 0 }) }
  };
  const key = '__settingsLoading' + ++sequence;
  const context = {
    deps, document: { documentElement: { style: { setProperty() {} } }, addEventListener() {} },
    window: { addEventListener: (type, fn) => events.set(type, fn) }, location: { hash: '#/settings' },
    matchMedia: () => ({ matches: false }), setTimeout: (fn, ms) => { const id = {}; timers.set(id, { fn, ms }); return id; }, clearTimeout: id => timers.delete(id)
  };
  globalThis[key] = context;
  t.after(() => { delete globalThis[key]; });
  let source = await readFile(new URL('../src/ui/settings.js', import.meta.url), 'utf8');
  source = source.replace(/^import (.+) from '([^']+)';$/gm, (_, names, path) => {
    const binding = names.startsWith('* as ') ? names.slice(5) : names;
    return `const ${binding} = globalThis[${JSON.stringify(key)}].deps[${JSON.stringify(path)}];`;
  });
  source = `const { document, window, location, matchMedia, setTimeout, clearTimeout } = globalThis[${JSON.stringify(key)}];\n` + source;
  const mod = await import('data:text/javascript;base64,' + Buffer.from(source).toString('base64'));
  function mount(html) {
    for (const node of nodes.values()) node.isConnected = false;
    nodes.clear();
    for (const id of ['aiProv', 'gistForm', 'impBak', 'aiMsg']) nodes.set(id, { value: provider, textContent: '', isConnected: true });
    const generation = html.match(/id="hostedInfo" data-generation="(\d+)"/);
    if (generation) {
      let value = html.match(/id="hostedInfo"[^>]*>([\s\S]*?)<\/div>/)[1];
      const retry = {};
      nodes.set('hostedInfo', { dataset: { generation: generation[1] }, isConnected: true,
        get innerHTML() { return value; }, set innerHTML(v) { value = v; },
        querySelector: () => value.includes('data-hosted-retry') ? retry : null });
    }
  }
  return { mod, nodes, actions, cloud, request, chats, timers, context, mount,
    calls: () => calls, config: () => config, refreshes: () => refreshes,
    account: value => { uid = value; }, signOut: () => { signedIn = false; },
    html: () => nodes.get('hostedInfo')?.innerHTML || '',
    timeout: () => { for (const { fn, ms } of [...timers.values()]) { assert.equal(ms, 10000); fn(); } },
    navigate: hash => { context.location.hash = hash; events.get('hashchange')(); }
  };
}

async function open(ui) {
  const html = await ui.mod.renderSettings(); ui.mount(html); ui.mod.afterSettings(); await flush(); return html;
}

test('render itself does not dispatch platform info and invalidated after hook cannot dispatch late', async t => {
  const ui = await setup(t);
  const html = await ui.mod.renderSettings();
  assert.equal(ui.calls(), 0);
  ui.mount(html); ui.mod.afterSettings(); ui.navigate('#/notes');
  await flush(); assert.equal(ui.calls(), 0);
  ui.timeout(); await flush();
});

test('never-settling hosted info cannot block local settings render or their handlers', async t => {
  const ui = await setup(t);
  const html = await open(ui);
  for (const text of ['本地外观', '学习者档案', '备份', '账号与云端同步']) assert.ok(html.includes(text));
  assert.equal(ui.calls(), 1); assert.match(ui.html(), /正在加载/);
  assert.equal(typeof ui.nodes.get('aiProv').onchange, 'function');
  assert.equal(typeof ui.nodes.get('gistForm').onsubmit, 'function');
  await ui.actions.get('ai-save')(); assert.equal(ui.config().model, 'chosen-model');
  await ui.actions.get('ai-test')(); assert.equal(ui.chats[0].model, 'chosen-model');
  ui.timeout(); await flush();
});

test('success updates only hosted area, escapes models and preserves selected model saving', async t => {
  const ui = await setup(t); await open(ui);
  const provider = ui.nodes.get('aiProv');
  ui.request.resolve({ models: ['default', 'chosen-model', '<img>'], day: 2, dayLimit: 5, month: 4, monthLimit: 30 }); await flush();
  assert.match(ui.html(), /今天 2\/5 次，本月 4\/30 次/);
  assert.match(ui.html(), /value="chosen-model" selected/); assert.match(ui.html(), /&lt;img>/);
  assert.equal(ui.nodes.get('aiProv'), provider); assert.equal(ui.refreshes(), 0); assert.equal(ui.timers.size, 0);
  ui.nodes.set('aiHostedModel', { value: 'default' }); await ui.actions.get('ai-save')();
  assert.equal(ui.config().model, 'default');
});

test('failure is escaped and retry succeeds without refreshing the page', async t => {
  const ui = await setup(t); await open(ui);
  ui.request.reject(new Error('<offline>')); await flush();
  assert.match(ui.html(), /&lt;offline>/); assert.match(ui.html(), /重试/);
  ui.cloud.aiInfo = async () => ({ monthLimit: 10, day: 0, dayLimit: 1, month: 0 });
  await ui.nodes.get('hostedInfo').querySelector().onclick();
  assert.match(ui.html(), /免费额度/); assert.equal(ui.refreshes(), 0);
});

test('timeout is explicit, retry works and original late success cannot overwrite it', async t => {
  const ui = await setup(t); await open(ui); ui.timeout(); await flush();
  assert.match(ui.html(), /加载超时/); assert.match(ui.html(), /重试/);
  ui.cloud.aiInfo = async () => ({ models: ['retry-model'], monthLimit: 99 });
  await ui.nodes.get('hostedInfo').querySelector().onclick();
  const html = ui.html(); ui.request.resolve({ models: ['old-model'], monthLimit: 123 }); await flush();
  assert.equal(ui.html(), html); assert.match(html, /99/); assert.equal(ui.timers.size, 0);
});

test('late rejection after timeout stays handled and cannot replace timeout notice', async t => {
  const ui = await setup(t); await open(ui); ui.timeout(); await flush();
  const html = ui.html(); ui.request.reject(new Error('late offline')); await flush();
  assert.equal(ui.html(), html); assert.equal(ui.timers.size, 0);
});

for (const outcome of ['resolve', 'reject']) {
  test(`leaving and revisiting settings rejects old page late ${outcome}`, async t => {
    const ui = await setup(t); await open(ui);
    const old = ui.nodes.get('hostedInfo'), initial = old.innerHTML;
    ui.navigate('#/notes'); ui.navigate('#/settings');
    const newer = deferred(); ui.cloud.aiInfo = () => newer.promise;
    await open(ui); const current = ui.html();
    ui.request[outcome](outcome === 'resolve' ? { monthLimit: 77 } : new Error('old-error')); await flush();
    assert.equal(old.innerHTML, initial); assert.equal(ui.html(), current);
    newer.resolve({ monthLimit: 12 }); await flush(); assert.match(ui.html(), /12/);
  });
}

test('detached container, changed account, sign-out and provider changes suppress late results', async t => {
  for (const change of ['detach', 'account', 'signout', 'provider']) {
    const ui = await setup(t); await open(ui); const old = ui.html();
    if (change === 'detach') ui.nodes.get('hostedInfo').isConnected = false;
    if (change === 'account') ui.account('B');
    if (change === 'signout') ui.signOut();
    if (change === 'provider') ui.nodes.get('aiProv').value = 'custom';
    ui.request.resolve({ monthLimit: 567 }); await flush(); assert.equal(ui.html(), old, change);
  }
});

test('non-hosted and signed-out settings never request platform info', async t => {
  for (const [provider, signedIn] of [['custom', true], ['hosted', false]]) {
    const ui = await setup(t, provider, signedIn); const html = await open(ui);
    assert.equal(ui.calls(), 0); assert.equal(ui.timers.size, 0);
    if (!signedIn) assert.match(html, /先在“账号与云端同步”/);
  }
});
