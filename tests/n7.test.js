// N7：知识树 A 档
import test from 'node:test';
import assert from 'node:assert/strict';
import { buildGraph, neighborhood } from '../src/core/graph.js';
import { trackState } from '../src/core/progress.js';

const track = { id: 'agent', name: '智能体', stages: [
  { id: 'agent.s01', title: '范式', goal: 'g', items: [{ id: 'agent.s01.i01', text: 'a' }, { id: 'agent.s01.i02', text: 'b', mode: 'practice' }], resources: [{ id: 'r1', name: 'ReAct', url: 'https://x' }] },
  { id: 'agent.s02', title: '协议', goal: 'g', items: [{ id: 'agent.s02.i01', text: 'c' }], resources: [] }] };
const routes = [{ id: 'agent.r01', title: 'MCP', from: 'agent.s02' }, { id: 'agent.r02', title: '孤儿', from: 'llm.s09' }];
const news = { 'agent.r01': [{ id: 'n1', t: '一', u: 'https://1' }, { id: 'n2', t: '二', u: 'https://2' }], 'agent.r02': [{ id: 'n1', t: '一', u: 'https://1' }] };

test('知识树：方向 → 阶段 → 任务/资源，路线挂在分出它的阶段，资讯挂路线，笔记挂阶段', () => {
  const st = trackState(track, {}, { 'agent.s01.i01': 'x', 'agent.s01.i02': 'x' });
  const g = buildGraph({ track, st, routes, newsOf: id => news[id] || [], cards: { c1: { t: 'x', at: 'agent.s02' } }, done: { 'agent.s01.i01': 1, 'agent.s01.i02': 1 } });
  const by = id => g.nodes.find(n => n.id === id);
  assert.equal(by('agent.s01').st, 'done'); assert.equal(by('agent.s02').st, 'now'); assert.equal(by('agent.s01.i02').practice, true);
  assert.ok(g.edges.some(e => e.source === 'agent.s01' && e.target === 'agent.s02' && e.k === 'next'));
  assert.ok(g.edges.some(e => e.source === 'agent.s02' && e.target === 'agent.r01'));
  assert.ok(g.edges.some(e => e.source === 'agent' && e.target === 'agent.r02'), '找不到来源阶段的路线挂在方向上');
  assert.equal(g.nodes.filter(n => n.id === 'n1').length, 1, '同一条资讯只出现一次');
  assert.equal(by('agent.s02#notes').n, 1);
  for (const e of g.edges) assert.ok(by(e.source) && by(e.target), '边的两端都存在：' + e.id);
  const loc = neighborhood(g, 'agent.s02');
  assert.deepEqual(loc.nodes.map(n => n.id).sort(), ['agent.r01', 'agent.s01', 'agent.s02', 'agent.s02#notes', 'agent.s02.i01'].sort());
  assert.equal(buildGraph({ track, st, routes, newsOf: () => [] }, { items: false }).nodes.some(n => n.type === 'item'), false);
});

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
  assert.ok(r2.some(o => o.x.id === 'd' && /DeepSeek|API|搜索/.test(o.why)));
  assert.ok(tokens('Claude Code 发布').has('claude'));
  assert.deepEqual(sharedPhrases('工具调用增长', '模型的工具调用能力', () => 3), ['工具调用']);
});
