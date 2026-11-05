// 知识树与接着读
import test from 'node:test';
import assert from 'node:assert/strict';
import { tokens, buildIndex, relatedTo, sharedPhrases } from '../src/core/related.js';
test('接着读：同一路线、共同关键词、同一件事，并给出理由', () => {
  const pool = [
    { id: 'a', t: 'ChatGPT 侧 MCP 工具调用增长 98 倍', d: '2026-10-01', r: ['agent.r02'], k: ['agent'] },
    { id: 'b', t: 'MCP 新规范发布：协议核心改为无状态', d: '2026-07-28', r: ['agent.r02'], k: ['agent'], lvl: 'A' },
    { id: 'c', t: 'DeepSeek 开放搜索 API', d: '2026-10-17', r: [], k: ['llm'] },
    { id: 'd', t: '百度搜索 API 降价，低于 DeepSeek', d: '2026-10-18', r: [], k: ['llm'] },
    { id: 'e', t: '量化私募规模下降', d: '2026-10-02', r: [], k: ['quant'] },
    { id: 'f', t: 'DeepSeek 开放搜索 API 接口', d: '2026-10-18', r: [], k: ['llm'] },
    { id: 'g', t: '另一条关于 MCP 的报道', d: '2026-09-01', r: [], k: ['agent'] }
  ];
  const ix = buildIndex(pool);
  const r1 = relatedTo(ix, pool[0], { routeName: () => '协议栈' });
  assert.equal(r1[0].x.id, 'b'); assert.equal(r1[0].why, '都属于前沿路线：协议栈'); assert.equal(r1[0].group, 'deep');
  assert.ok(!r1.some(o => o.x.id === 'e'), '无关的不推荐');
  const r2 = relatedTo(ix, pool[2]);
  assert.equal(r2[0].x.id, 'f'); assert.equal(r2[0].why, '同一件事的其他报道');
  assert.ok(!r2.some(o => o.x.id === 'e'));
  assert.ok(tokens('Claude Code 发布').has('claude'));
  assert.deepEqual(sharedPhrases('工具调用增长', '模型的工具调用能力', () => 3), ['工具调用']);
});

import { buildTree, attach, visible, maxDepth, frontier, kwRegex, cleanKids } from '../src/core/taxonomy.js';
import { DOCS } from '../src/core/schema.js';
import { readFileSync } from 'node:fs';
test('知识树：预置两层、个人细分、扩散层数、资讯挂到最细的匹配节点', () => {
  const tax = JSON.parse(readFileSync(new URL('../content/taxonomy.json', import.meta.url)));
  for (const L of Object.values(tax.tracks)) for (const a of L) { assert.ok(a.kids.length >= 2, a.id); for (const b of a.kids) assert.ok(b.kw.length >= 2, b.id); }
  const mine = { 'agent.proto.mcp': { kids: [{ k: 'x1', name: 'MCP 传输层', en: 'Transport', kw: ['stdio', 'Streamable HTTP', '传输层'] }], u: 1 } };
  assert.ok(DOCS.tree('agent.proto.mcp', mine['agent.proto.mcp']));
  const T = buildTree({ tax, tracks: [{ id: 'agent', name: '智能体' }, { id: 'llm', name: '大模型' }], mine });
  assert.equal(T.byId.get('agent.proto.mcp.x1').ai, true); assert.equal(T.byId.get('agent.proto.mcp.x1').depth, 4);
  assert.deepEqual(visible(T, 1).map(n => n.id), ['domain', 'agent', 'llm']);
  assert.equal(maxDepth(T), 4); assert.equal(maxDepth(T, 'agent.proto'), 2);
  assert.ok(frontier(T, 3).some(n => n.id === 'agent.proto.a2a') && !frontier(T, 3).some(n => n.id === 'agent.proto.mcp'));
  const items = [{ id: 'n1', t: 'MCP 的 Streamable HTTP 传输层', k: ['agent'], r: [] }, { id: 'n2', t: 'Claude Code 新功能', k: ['agent'], r: [] }, { id: 'n3', t: '一条不相干的', k: ['agent'], r: [] },
    { id: 'p1', t: 'Mixture of experts routing', type: 'paper', k: [], r: [] }];
  const A = attach(T, items, { c1: { t: '我的 MCP 笔记', at: 'agent.s02' } });
  assert.ok(A.get('agent.proto.mcp.x1').news.has('n1')); assert.ok(A.get('agent.proto').news.has('n1'));
  assert.ok(A.get('agent.apps.coding').news.has('n2'));
  assert.ok(A.get('agent').news.has('n3') && !A.get('agent.proto').news.has('n3'));
  assert.ok(A.get('llm.arch.moe').papers.has('p1') && !A.get('agent').papers.has('p1'), '论文只进匹配到的子方向');
  assert.ok(A.get('agent.proto').notes.has('c1'));
  assert.equal(A.get('domain').news.size, 3);
  assert.ok(!kwRegex(['MoE']).test('smoke') && kwRegex(['quantiz']).test('Quantization'));
  assert.deepEqual(Object.keys(cleanKids({ kids: { 'agent.x': [{ name: 'a', kw: ['k1'] }], 'evil': [{ name: 'b', kw: ['k'] }], 'agent.y': [{ name: 'c', kw: [] }] } }, new Set(['agent.x', 'agent.y']))), ['agent.x']);
});

test('App 内更新：只接受本仓库 Releases 的、带校验值的更高版本', async () => {
  globalThis.localStorage = globalThis.localStorage || { getItem: () => null, setItem() {} };
  const { isNewer } = await import('../src/update.js');
  const ok = { versionCode: 12, url: 'https://github.com/pawsey0319/studying-roadmap/releases/download/v3.0.1/learning-hub-3.0.12.apk', sha256: 'a'.repeat(64) };
  assert.ok(isNewer(ok, 11)); assert.ok(!isNewer(ok, 12)); assert.ok(!isNewer({ ...ok, url: 'https://evil.com/x.apk' }, 1)); assert.ok(!isNewer({ ...ok, sha256: '' }, 1));
});
