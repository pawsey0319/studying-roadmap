// v3：后端适配、同步冲突副本、时钟校准
import test from 'node:test';
import assert from 'node:assert/strict';
import { newDoc, setKey, mergeDocKeepConflicts } from '../src/core/doc.js';
import { makeBackend } from '../src/store/backend.js';

test('长文档：两边都在上次同步后改过 → 较新的获胜，较旧的作为冲突副本返回', () => {
  const local = newDoc(), remote = newDoc();
  setKey(local, 'agent.s02', '共同的旧版', 100); setKey(remote, 'agent.s02', '共同的旧版', 100);
  const base = { 'agent.s02': 100 };
  setKey(local, 'agent.s02', '本机改的', 200);
  setKey(remote, 'agent.s02', '另一台改的', 300);
  const r = mergeDocKeepConflicts(local, remote, base);
  assert.equal(local.e['agent.s02'], '另一台改的');
  assert.equal(r.conflicts.length, 1);
  assert.equal(r.conflicts[0].value, '本机改的'); assert.equal(r.conflicts[0].side, 'local');
  // 只有一边改过 → 没有冲突
  const a = newDoc(), b = newDoc();
  setKey(a, 'x.s01', 'v1', 100); setKey(b, 'x.s01', 'v2', 300);
  assert.equal(mergeDocKeepConflicts(a, b, { 'x.s01': 100 }).conflicts.length, 0);
  // 本机比远端新：远端那份是冲突副本
  const c = newDoc(), d = newDoc();
  setKey(c, 'x.s01', '本机新', 500); setKey(d, 'x.s01', '远端旧', 400);
  const r2 = mergeDocKeepConflicts(c, d, { 'x.s01': 100 });
  assert.equal(c.e['x.s01'], '本机新'); assert.equal(r2.conflicts[0].value, '远端旧');
});

test('后端适配：按 config 选 CloudBase 或 Supabase', () => {
  globalThis.localStorage = { getItem: () => null, setItem: () => {} };
  const cb = makeBackend({ backend: 'cloudbase', cloudbaseEnv: 'env-1', cloudbaseKey: 'k' });
  assert.equal(cb.kind, 'cloudbase'); assert.equal(cb.rest, 'https://env-1.api.tcloudbasegateway.com/v1/rdb/rest');
  assert.ok(cb.versioned && cb.publicArea);
  const sb = makeBackend({ supabaseUrl: 'https://x.supabase.co/rest/v1/', supabaseAnonKey: 'sb_publishable_x' });
  assert.equal(sb.kind, 'supabase'); assert.equal(sb.rest, 'https://x.supabase.co/rest/v1');
  assert.ok(!sb.restHeaders(null).authorization, '新版 publishable key 不放进 Authorization');
  assert.equal(makeBackend({}), null);
});
