// N13：路线的增删阶段（纯函数）与学习 Agent Harness 的规格/反馈格式
import test from 'node:test';
import assert from 'node:assert/strict';
import { nextStageId, makeStage, newExt, addExtStage, hideExtStage, unhideExtStage, removeExtStage, mergeStages, addOwnStage, removeOwnStage, renameStage } from '../src/core/routeedit.js';
import { AGENT_SPEC, specStamp, promptStamp, fingerprint, feedbackJsonl } from '../src/ai/harness.js';
import { DOCS } from '../src/core/schema.js';

test('路线编辑：阶段 ID 从 sx01 起，避开已有 ID', () => {
  assert.equal(nextStageId('llm', []), 'llm.sx01');
  assert.equal(nextStageId('llm', ['llm.sx01']), 'llm.sx02');
  assert.equal(nextStageId('llm', ['llm.sx01', 'llm.sx02']), 'llm.sx03');
});

test('路线编辑：makeStage 清洗标题、任务和模式', () => {
  const st = makeStage('llm', [], { title: '  测试新阶段  ', goal: '能跑通', items: '读一遍文档\n写一个最小 demo' });
  assert.equal(st.id, 'llm.sx01');
  assert.equal(st.title, '测试新阶段');
  assert.equal(st.goal, '能跑通');
  assert.equal(st.items.length, 2);
  assert.equal(st.items[0].mode, 'theory');
  assert.equal(st.items[1].mode, 'practice');
  assert.equal(st.items[1].id, 'llm.sx01.i02');
  const empty = makeStage('x', [], { items: '' });
  assert.equal(empty.title, '新阶段');
  assert.equal(empty.items.length, 0);
});

test('路线编辑：公共方向只隐藏不删除，恢复后回到原位置，个人阶段排在最后', () => {
  const base = [{ id: 'a' }, { id: 'b' }];
  let ext = addExtStage(newExt(), { id: 'a.sx01', title: '我的阶段' });
  ext = hideExtStage(ext, 'a');
  assert.deepEqual(mergeStages(base, ext).map(s => s.id), ['b', 'a.sx01']);
  ext = unhideExtStage(ext, 'a');
  assert.deepEqual(mergeStages(base, ext).map(s => s.id), ['a', 'b', 'a.sx01']);
  ext = removeExtStage(ext, 'a.sx01');
  assert.deepEqual(mergeStages(base, ext).map(s => s.id), ['a', 'b']);
  assert.deepEqual(base.map(s => s.id), ['a', 'b'], '不修改传入的公共阶段');
});

test('路线编辑：自己的方向可以直接增删和改名', () => {
  const t = { id: 'u1', stages: [{ id: 'u1.s01', title: '旧' }] };
  const t2 = addOwnStage(t, { id: 'u1.s02', title: '新' });
  assert.deepEqual(t2.stages.map(s => s.id), ['u1.s01', 'u1.s02']);
  const t3 = renameStage(t2, 'u1.s02', { title: '改名' });
  assert.equal(t3.stages[1].title, '改名');
  const t4 = removeOwnStage(t3, 'u1.s01');
  assert.deepEqual(t4.stages.map(s => s.id), ['u1.s02']);
  assert.equal(t.stages.length, 1, '不修改原路线');
});

test('Harness：规格固定、版本可追踪、指纹稳定', () => {
  assert.ok(Object.isFrozen(AGENT_SPEC));
  assert.equal(AGENT_SPEC.id, 'learning-agent');
  assert.equal(AGENT_SPEC.version, '2026.11.1');
  assert.equal(specStamp(), 'learning-agent@2026.11.1');
  assert.match(promptStamp('系统提示词'), /^learning-agent@2026\.11\.1#[0-9a-f]{8}$/);
  assert.equal(fingerprint('abc'), fingerprint('abc'));
  assert.notEqual(fingerprint('abc'), fingerprint('abd'));
  assert.ok(AGENT_SPEC.tools.includes('get_notes'));
  assert.ok(!AGENT_SPEC.tools.includes('write_anything'));
});

test('Harness：反馈 JSONL 一行一条，带版本号', () => {
  const s = feedbackJsonl([
    ['fabc123', { rating: 'down', reason: 'wrong', note: '事实不对', at: 1, kind: 'agent' }],
    ['fabc124', { rating: 'up', at: 2, kind: 'agent' }]
  ]);
  const lines = s.trim().split('\n');
  assert.equal(lines.length, 2);
  assert.equal(JSON.parse(lines[0]).rating, 'down');
  assert.equal(JSON.parse(lines[0]).spec, 'unknown');
  assert.equal(JSON.parse(lines[1]).rating, 'up');
  assert.equal(feedbackJsonl([]), '');
});

test('反馈文档校验：只接受带评分的短记录', () => {
  const ok = { rating: 'down', reason: 'wrong', note: '', at: 1, spec: 'learning-agent@2026.11.1', provider: 'openai', model: 'gpt', kind: 'agent', title: '自由对话', excerpt: '节选', src: [{ t: 'note', title: '笔记' }], context: '' };
  assert.equal(DOCS.feedback('fabc123', ok), true);
  assert.equal(DOCS.feedback('fabc123', { ...ok, rating: 'meh' }), false);
  assert.equal(DOCS.feedback('bad key', ok), false);
  assert.equal(DOCS.feedback('fabc123', { ...ok, note: 'x'.repeat(601) }), false);
});
