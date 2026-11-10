import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';

const source = await readFile(new URL('../src/store/cloud.js', import.meta.url), 'utf8');
const deferred = () => { let resolve, reject; const promise = new Promise((a, b) => { resolve = a; reject = b; }); return { promise, resolve, reject }; };
const session = (id, expired = false) => ({ access: id + '-token', refresh: id + '-refresh', uid: id, email: id + '@test', exp: expired ? 0 : Date.now() + 3600000 });
let serial = 0;
async function fixture(initial = session('A', true)) {
  const calls = [], merges = [], refreshes = [], verifies = [], users = [], responses = [], requested = deferred();
  const storage = new Map([['learning-hub.cloud', JSON.stringify(initial)]]);
  const makeBackend = config => ({
    kind: config.kind || 'supabase', base: config.base || 'https://one.test', rest: (config.base || 'https://one.test') + '/rest/v1',
    restHeaders: access => ({ authorization: 'Bearer ' + (access || 'public') }),
    refresh(s) { const d = deferred(); refreshes.push({ ...d, session: s }); return d.promise; },
    verify(code, pending) { const d = deferred(); verifies.push({ ...d, code, pending }); return d.promise; },
    user(access) { const d = deferred(); users.push({ ...d, access }); return d.promise; },
    async sendCode(email) { return { email }; }
  });
  const env = {
    fetch: (...args) => env.fetchImpl(...args),
    localStorage: { getItem: key => storage.get(key), setItem: (key, value) => storage.set(key, value) },
    location: { hash: '', pathname: '/', search: '' }, history: { replaceState() {} },
    store: { setSkew() {}, mergeRemote: (...args) => merges.push(args), docs: () => ({ doc: { mt: { a: 1 } } }), markSynced() {}, takeConflicts: () => 0 },
    makeBackend, http: async (url, opt) => { calls.push({ url, opt }); requested.resolve(); return responses.length ? responses.shift().promise : { data: [] }; }
  };
  // Evaluate the complete production module with only its browser globals/imports mocked.
  // data: ESM works under the ordinary node --test command, without experimental VM flags.
  const key = '__cloudAuthFixture' + serial++;
  globalThis[key] = env;
  const code = `const { localStorage, location, history, store, makeBackend, http, fetch } = globalThis[${JSON.stringify(key)}];\n` + source
    .replace("import * as store from './index.js';", '')
    .replace("import { DOC_NAMES } from '../core/schema.js';", "const DOC_NAMES = ['doc'];")
    .replace("import { sameDoc } from '../core/doc.js';", 'const sameDoc = () => false;')
    .replace("import { makeBackend, http } from './backend.js';", '');
  let cloud;
  try { cloud = await import('data:text/javascript;base64,' + Buffer.from(code).toString('base64')); }
  finally { delete globalThis[key]; }
  cloud.setup({ hostedAI: true });
  const login = async id => { const p = cloud.verify('123456'); verifies.at(-1).resolve(session(id)); await p; };
  return { cloud, calls, merges, refreshes, verifies, users, responses, requested, env, storage, login };
}

for (const outcome of ['success', 'failure']) {
  for (const change of ['signOut', 'B', 'B-A', 'setup', 'link']) {
    test(`late refresh ${outcome} cannot change session after ${change}`, async () => {
      const f = await fixture(), { cloud } = f;
      const pending = cloud.ensureToken();
      const rejected = assert.rejects(pending, /账号或后端已改变/);
      if (change === 'signOut') cloud.signOut();
      if (change === 'B' || change === 'B-A') await f.login('B');
      if (change === 'B-A') await f.login('A');
      if (change === 'setup') cloud.setup({ hostedAI: true, base: 'https://two.test' });
      if (change === 'link') {
        f.env.location.hash = '#access_token=B-token&refresh_token=B-refresh';
        const link = cloud.consumeLink(); f.users[0].resolve({ id: 'B', email: 'B@test' }); await link;
      }
      const before = f.storage.get('learning-hub.cloud');
      if (outcome === 'success') f.refreshes[0].resolve(session('A-late'));
      else f.refreshes[0].reject(new Error('old refresh failed'));
      await rejected;
      assert.equal(f.storage.get('learning-hub.cloud'), before);
      assert.equal(cloud.uid(), ['B-A', 'setup'].includes(change) ? 'A' : ['B', 'link'].includes(change) ? 'B' : '');
    });
  }
}

test('same-generation refresh is deduplicated and both callers receive the refreshed token', async () => {
  const f = await fixture();
  const a = f.cloud.ensureToken(), b = f.cloud.ensureToken();
  assert.equal(f.refreshes.length, 1);
  f.refreshes[0].resolve(session('A-new'));
  assert.deepEqual(await Promise.all([a, b]), ['A-new-token', 'A-new-token']);
});

test('current refresh failure expires only its own session', async () => {
  const f = await fixture(), p = f.cloud.ensureToken();
  const rejected = assert.rejects(p, /登录已过期/);
  f.refreshes[0].reject(new Error('expired')); await rejected;
  assert.equal(f.cloud.signedIn(), false);
  assert.equal(f.cloud.email(), 'A@test');
});

for (const method of ['rest', 'aiEndpoint']) {
  for (const expired of [true, false]) {
    test(`${method} cannot silently switch accounts while awaiting ${expired ? 'refresh' : 'valid token'}`, async () => {
      const f = await fixture(session('A', expired));
      const p = method === 'rest' ? f.cloud.rest('/private', { method: 'POST', body: 'A-data' }) : f.cloud.aiEndpoint();
      const rejected = assert.rejects(p, /账号或后端已改变/);
      f.cloud.signOut(); await f.login('B');
      if (expired) f.refreshes[0].resolve(session('A-late'));
      await rejected; assert.equal(f.calls.length, 0);
    });
  }
}

for (const action of ['signOut', 'verify', 'setup']) {
  test(`late verify does not install old login after ${action}`, async () => {
    const f = await fixture(), p = f.cloud.verify('old');
    const rejected = assert.rejects(p, /账号或后端已改变/);
    if (action === 'signOut') f.cloud.signOut();
    if (action === 'verify') await f.login('B');
    if (action === 'setup') f.cloud.setup({ hostedAI: true });
    const before = f.storage.get('learning-hub.cloud');
    f.verifies[0].resolve(session('old')); await rejected;
    assert.equal(f.storage.get('learning-hub.cloud'), before);
  });
}

for (const outcome of ['success', 'failure']) {
  test(`late consumeLink ${outcome} cannot affect a newer login`, async () => {
    const f = await fixture(); f.env.location.hash = '#access_token=old&refresh_token=old';
    const p = f.cloud.consumeLink(); await f.login('B');
    const before = f.storage.get('learning-hub.cloud');
    if (outcome === 'success') f.users[0].resolve({ id: 'old', email: 'old@test' });
    else f.users[0].reject(new Error('expired link'));
    assert.equal(await p, false);
    assert.equal(f.storage.get('learning-hub.cloud'), before);
    assert.equal(f.cloud.error, '');
  });
}

test('sync does not merge or upload old account rows after switching accounts', async () => {
  const f = await fixture(session('A')), response = deferred(); f.responses.push(response);
  const p = f.cloud.syncNow();
  await f.requested.promise;
  assert.equal(f.calls.length, 1);
  await f.login('B');
  response.resolve({ data: [{ name: 'doc', data: { mt: { secret: 1 } } }] });
  await p;
  assert.equal(f.merges.length, 0);
  assert.equal(f.calls.length, 1);
  assert.equal(f.cloud.lastSync(), 0);
});

for (const stage of ['fetch', 'json']) {
  test(`aiInfo rejects old account quota after delayed ${stage}`, async () => {
    const f = await fixture(session('A')), started = deferred(), delayed = deferred();
    f.env.fetchImpl = async () => {
      if (stage === 'fetch') { started.resolve(); await delayed.promise; }
      return { ok: true, json: async () => {
        if (stage === 'json') { started.resolve(); await delayed.promise; }
        return { remaining: 99, owner: 'A' };
      } };
    };
    const p = f.cloud.aiInfo(), rejected = assert.rejects(p, /账号或后端已改变/);
    await started.promise; await f.login('B'); delayed.resolve();
    await rejected;
    assert.equal(f.cloud.uid(), 'B');
  });
}
