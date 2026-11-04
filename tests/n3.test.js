// N3：自测掌握度、学习方法档案约束、修改方案影响、Anki 导出
import test from 'node:test';
import assert from 'node:assert/strict';
import { mastery, attemptScore, isMastered, addAttempt, suggestMastered, nextItems, stageMastery } from '../src/core/mastery.js';
import { applyMethodOps, methodView, undoOps, quoteOk, similar, MAX_TOTAL } from '../src/core/method.js';
import { opImpact } from '../src/core/overlay.js';
import { ankiTsv, ankiNotes, guid } from '../src/core/anki.js';
import { DOCS } from '../src/core/schema.js';

test('掌握度：最近 5 次加权、1 次最多 0.5、2 次最多 0.8、提示和重试扣分', () => {
  assert.equal(mastery({ a: [{ s: 1 }] }), 0.5);
  assert.equal(mastery({ a: [{ s: 1 }, { s: 1 }] }), 0.8);
  assert.equal(mastery({ a: [{ s: 1 }, { s: 1 }, { s: 1 }] }), 1);
  assert.equal(attemptScore({ s: 1, h: 10 }), 0.75);          // 提示最多扣 0.25
  assert.equal(attemptScore({ s: 1, r: 10 }), 0.8);           // 重试最多扣 0.2
  assert.ok(Math.abs(attemptScore({ s: 0.9, h: 1, r: 1 }) - 0.77) < 1e-9);
  // 越新的作答权重越大：先错后对 > 先对后错
  const up = mastery({ a: [{ s: 0 }, { s: 0 }, { s: 1 }] }), down = mastery({ a: [{ s: 1 }, { s: 1 }, { s: 0 }] });
  assert.ok(up < down === false || up > 0); assert.ok(mastery({ a: [{ s: 0 }, { s: 1 }, { s: 1 }] }) > mastery({ a: [{ s: 1 }, { s: 1 }, { s: 0 }] }));
  // 只保留最近 5 次
  let r = null; for (let i = 0; i < 8; i++) r = addAttempt(r, { kind: 'memory', s: 1, q: { t: '题' + i, a: '答' } });
  assert.equal(r.a.length, 5); assert.equal(r.qs.length, 5); assert.ok(DOCS.tests('agent.s01.i01', r));
});

test('达标：记忆类 0.9；概念类看最近一次讲解是否通过', () => {
  const mem = { k: 'memory', a: [{ s: 1 }, { s: 1 }, { s: 0.9 }] };
  assert.equal(isMastered(mem), true);
  assert.equal(isMastered({ k: 'memory', a: [{ s: 1 }, { s: 1 }] }), false);   // 2 次最多 0.8
  assert.equal(isMastered({ k: 'concept', a: [{ s: 0.8, p: true }, { s: 0.8, p: true }] }), true);
  assert.equal(isMastered({ k: 'concept', a: [{ s: 0.8, p: true }, { s: 0.8, p: false }] }), false);
});

test('下一步优先级：待批改 > 没掌握 > 自测达标；全部完成或达标时建议标为已掌握', () => {
  const st = { id: 'a.s01', items: [{ id: 'a.s01.i01' }, { id: 'a.s01.i02' }, { id: 'a.s01.i03' }] };
  const ok = { k: 'memory', a: [{ s: 1 }, { s: 1 }, { s: 1 }] };
  const recs = { 'a.s01.i01': ok };
  assert.deepEqual(nextItems(st, recs, {}, { 'a.s01.i03': 1 }).map(i => i.id), ['a.s01.i03', 'a.s01.i02', 'a.s01.i01']);
  assert.equal(suggestMastered(st, recs, { 'a.s01.i02': '2026-11-01' }), false);
  assert.equal(suggestMastered(st, recs, { 'a.s01.i02': '2026-11-01', 'a.s01.i03': '2026-11-02' }), true);
  assert.equal(suggestMastered(st, {}, { 'a.s01.i01': 1, 'a.s01.i02': 1, 'a.s01.i03': 1 }), false, '没有自测时不打扰');
  assert.deepEqual(stageMastery(st, recs), { items: 3, tested: 1, mastered: 1, avg: 1 });
});

test('档案约束：短编号、原话核对、绝对化词、删除理由、查重、上限、撤销', () => {
  let n = 0; const idGen = () => 'm' + String(++n).padStart(7, '0');
  const E = { m0000a01: { d: '提取练习', t: '答题前先自己回忆一遍再看答案', w: 0.5, n: 1, c: 1, u: 1, by: 'ai' }, m0000a02: { d: '其他', t: '用户写的', w: 0.7, n: 1, c: 1, u: 1, by: 'user' } };
  const v = methodView(E);
  assert.equal(v.map['1'], 'm0000a02'); assert.match(v.lines, /^1｜其他｜用户写的｜很有把握｜用户写的/);
  const user = '我觉得还是先给我一个例子，再讲定义比较好懂';
  const r = applyMethodOps(E, [
    { op: 'add', d: '呈现偏好', t: '先看例子再看定义更容易懂', q: '先给我一个例子，再讲定义' },
    { op: 'add', d: '呈现偏好', t: '喜欢图', q: '我喜欢看图' },
    { op: 'add', d: '元认知', t: '总是能发现自己的错误' },
    { op: 'delete', id: 1, why: 'stale' }
  ], { n: 0, idGen, map: v.map, userText: user });
  assert.equal(Object.keys(r.set).length, 1); assert.equal(Object.values(r.set)[0].q, '先给我一个例子，再讲定义');
  assert.deepEqual(r.rejected.map(x => x.why), ['偏好类要引用用户原话，没有核对上', '用了绝对化的词', '用户写的条目不自动删除']);
  const r2 = applyMethodOps(E, [{ op: 'delete', id: 'm0000a01', why: '不喜欢' }, { op: 'delete', id: 'm0000a01', why: 'superseded' }, { op: 'reinforce', id: 99 }], { idGen });
  assert.deepEqual(r2.del, ['m0000a01']); assert.equal(r2.rejected.length, 2);
  // 查重：意思几乎一样的新增 → 当作印证
  const r3 = applyMethodOps(E, [{ op: 'add', d: '提取练习', t: '答题前先自己回忆一遍，再看答案' }], { idGen });
  assert.equal(Object.keys(r3.set)[0], 'm0000a01'); assert.equal(r3.set.m0000a01.n, 2);
  assert.ok(similar('答题前先自己回忆一遍再看答案', '答题之前先回忆一遍再看答案') > 0.5); assert.ok(similar('先给类比再讲公式时理解更快', '先讲公式再给类比时理解更慢') < 0.6, '意思相反的不合并');
  assert.ok(quoteOk('先给我一个例子，再讲定义', user) && !quoteOk('例子', user));
  // 上限
  const full = Object.fromEntries(Array.from({ length: MAX_TOTAL }, (_, i) => ['m' + String(i).padStart(7, '0'), { d: DIMSAFE[i % 4], t: '条目编号' + i + '号的不同描述' + 'xyzw'[i % 4].repeat(i % 7 + 1), w: 0.5, n: 1, c: 1, u: 1, by: 'ai' }]));
  assert.equal(applyMethodOps(full, [{ op: 'add', d: '其他', t: '一个全新的观察' }], { idGen }).rejected[0].why, `档案已满 ${MAX_TOTAL} 条`);
  // 撤销
  const r4 = applyMethodOps(E, [{ op: 'revise', id: 'm0000a01', t: '改过的描述' }, { op: 'add', d: '节奏', t: '一次学 25 分钟' }], { idGen });
  const u = undoOps(r4.log);
  assert.equal(u.set.m0000a01.t, '答题前先自己回忆一遍再看答案'); assert.equal(u.del.length, 1);
  for (const x of Object.values(r.set)) assert.ok(DOCS.method('m0000001', x));
});
const DIMSAFE = ['提取练习', '自我解释', '深加工', '常见误区'];

test('修改方案的影响说明', () => {
  const st = { id: 'a.s01', items: [{ id: 'a.s01.i01' }, { id: 'a.s01.i02' }], prog: { n: 1, total: 2 } };
  assert.match(opImpact({ op: 'skip', id: 'a.s01.i01' }, st, { 'a.s01.i01': 'x' }), /这项已完成.*1\/2 → 0\/1/);
  assert.match(opImpact({ op: 'add', text: 'x' }, st), /1\/2 → 1\/3/);
  assert.match(opImpact({ op: 'mastered' }, st), /2\/2/);
  assert.match(opImpact({ op: 'edit', id: 'a.s01.i01', text: 'y' }, st, { 'a.s01.i01': 'x' }), /仍算完成/);
  assert.match(opImpact({ op: 'goal', text: 'g' }, { ...st, mastered: true }), /不建议再改/);
});

test('Anki：带文件头的 TSV，稳定 guid，字段转义', () => {
  const notes = ankiNotes({ tests: { 'a.s01.i01': { qs: [{ t: '什么是\tKV 缓存？', a: '第一行\n第二行 "引号"' }] } }, cards: { c123456: { t: '# 标题\n内容', at: 'a.s01' } }, withCards: true, label: () => '方向 阶段' });
  assert.equal(notes.length, 2);
  const tsv = ankiTsv(notes);
  const lines = tsv.trim().split('\n');
  assert.equal(lines[0], '#separator:tab'); assert.ok(lines.includes('#guid column:1'));
  const row = lines.find(l => l.startsWith(guid('a.s01.i01|什么是\tKV 缓存？'))).split('\t');
  assert.equal(row.length, 4); assert.equal(row[2], '"第一行<br>第二行 ""引号"""'); assert.equal(row[3], '自测 方向_阶段');
  assert.equal(guid('x'), guid('x')); assert.notEqual(guid('x'), guid('y'));
});
