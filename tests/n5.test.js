// N5：公共区域（快照、采用、版本、敏感词、排序）
import test from 'node:test';
import assert from 'node:assert/strict';
import { snapshot, toTrack, validBody, sensitive, bodyText, sortItems, adoptedMap, upstreamNewer } from '../src/core/public.js';
import { DOCS } from '../src/core/schema.js';

const track = { id: 'agent', name: '智能体', goal: '能搭 Agent', stages: [
  { id: 'agent.s01', title: '范式', goal: 'g', items: [{ id: 'agent.s01.i01', text: '读 ReAct', mode: 'theory' }, { id: 'agent.s01.i02', text: '手写循环', mode: 'practice' }], resources: [{ name: 'ReAct', url: 'https://arxiv.org/abs/2210.03629' }, { name: '坏链接', url: 'javascript:x' }] },
  { id: 'agent.s02', title: '只有跳过的', goal: '', items: [{ id: 'agent.s02.i01', text: 'x' }], resources: [] }] };
const ov = { 'agent.s01': { edit: { 'agent.s01.i01': '精读 ReAct' }, add: [{ id: 'agent.s01.ukx1', text: '自己加的' }] }, 'agent.s02': { skip: ['agent.s02.i01'] } };

test('快照：按个人调整后的公开，跳过的不公开，不带进度', () => {
  const s = snapshot(track, ov);
  assert.equal(s.stages.length, 1);
  assert.deepEqual(s.stages[0].items.map(i => [i.k, i.text]), [['i01', '精读 ReAct'], ['i02', '手写循环'], ['ukx1', '自己加的']]);
  assert.deepEqual(s.stages[0].resources, [{ name: 'ReAct', url: 'https://arxiv.org/abs/2210.03629' }, { name: '坏链接' }]);
  assert.ok(validBody('track', s)); assert.ok(!JSON.stringify(s).includes('done'));
});

test('采用：变成自己的方向，ID 稳定，更新版本后进度能对上', () => {
  const s = snapshot(track, ov), item = { id: 7, version: 2, author_name: '张三', title: '智能体入门' };
  const t = toTrack(s, { tid: 'uabc123', item });
  assert.equal(t.stages[0].items[0].id, 'uabc123.s01.i01'); assert.deepEqual(t.pub, { id: 7, v: 2, by: '张三' });
  assert.ok(DOCS.tracks('uabc123', t));
  const t2 = toTrack(s, { tid: 'uabc123', item: { ...item, version: 3 } });
  assert.equal(t2.stages[0].items[2].id, t.stages[0].items[2].id);
  assert.deepEqual(adoptedMap({ uabc123: t, ext: {}, 'ext.agent': { stages: [] } }), { 7: { tid: 'uabc123', v: 2 } });
  assert.ok(upstreamNewer({ v: 2 }, { version: 3 })); assert.ok(!upstreamNewer({ v: 3 }, { version: 3 }));
});

test('敏感词：联系方式、赌博、违法交易会拦下，正常内容通过', () => {
  assert.deepEqual(sensitive('加微信 abc 领资料'), ['联系方式和引流']);
  assert.deepEqual(sensitive('联系 13812345678'), ['联系方式和引流']);
  assert.deepEqual(sensitive('网赌稳赚不赔'), ['赌博', '诈骗']);
  assert.deepEqual(sensitive('用 RAG 做企业知识库，评测 13 个模型，上下文 128000 token'), []);
  assert.match(bodyText('track', snapshot(track, ov)), /精读 ReAct/);
  assert.ok(!validBody('note', { text: '' })); assert.ok(validBody('note', { text: '笔记' }));
});

test('排序：采用最多 / 学完最多 / 最近更新', () => {
  const L = [{ id: 1, adopt_count: 5, done_count: 1, updated_at: '2026-10-01' }, { id: 2, adopt_count: 3, done_count: 3, updated_at: '2026-11-01' }, { id: 3, adopt_count: 9, done_count: 0, updated_at: '2026-09-01' }];
  assert.deepEqual(sortItems(L, 'adopt').map(x => x.id), [3, 1, 2]);
  assert.deepEqual(sortItems(L, 'done').map(x => x.id), [2, 1, 3]);
  assert.deepEqual(sortItems(L, 'new').map(x => x.id), [2, 1, 3]);
});
