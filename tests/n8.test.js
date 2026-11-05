// 点赞与引用
import test from 'node:test';
import assert from 'node:assert/strict';
import { likeKey, likeOk, refOk, refIndex, citedBy, citesOf, snapOf, quoteMd, refStatus, makeRef, isLiked } from '../src/core/marks.js';
import { DOCS, DOC_NAMES } from '../src/core/schema.js';

test('点赞：键和值的校验', () => {
  assert.ok(likeOk('card:cabc123', 1730000000000));
  assert.ok(likeOk('stage:agent.s02', 5));
  assert.ok(likeOk('track:agent', 5));
  assert.ok(!likeOk('card:cabc123', 0), '值必须是正整数');
  assert.ok(!likeOk('note:cabc123', 5), '类型必须在范围内');
  assert.ok(!likeOk('card:<script>', 5));
  assert.ok(!likeOk('cabc123', 5), '必须带类型前缀');
  assert.ok(DOC_NAMES.includes('likes') && DOC_NAMES.includes('refs'));
  assert.ok(DOCS.likes('track:quant', 9));
  assert.ok(isLiked({ [likeKey('card', 'c1abc')]: 3 }, 'card', 'c1abc'));
});

test('引用：创建、校验、索引、状态', () => {
  const [id, r] = makeRef({ from: { k: 'card', id: 'cnew001' }, to: { k: 'card', id: 'cold001' }, text: '> 引用\n原文一段', id: 'q1abcde', now: 100 });
  assert.equal(id, 'q1abcde'); assert.equal(r.snap, '引用\n原文一段'.replace(/\n/g, '\n'));
  assert.ok(refOk(id, r) && DOCS.refs(id, r));
  assert.ok(!refOk('x1abcde', r), '键必须以 q 开头');
  assert.ok(!refOk(id, { ...r, snap: 'x'.repeat(601) }), '快照不超过 600 字');
  assert.throws(() => makeRef({ from: { k: 'card', id: 'c1abc' }, to: { k: 'card', id: 'c1abc' }, text: 'x', id: 'q1', now: 1 }), /自己/);
  const refs = { q1abcde: r, q2abcde: { ...r, from: { k: 'stage', id: 'agent.s01' }, c: 200 } };
  const ix = refIndex(refs);
  assert.equal(citedBy(ix, 'card', 'cold001').length, 2);
  assert.equal(citedBy(ix, 'card', 'cold001')[0].qid, 'q2abcde', '新的在前');
  assert.equal(citesOf(ix, 'card', 'cnew001').length, 1);
  assert.equal(refStatus(r, '原文一段') === 'same' || refStatus(r, '引用\n原文一段') === 'same', true);
  assert.equal(refStatus(r, '改过了'), 'changed');
  assert.equal(refStatus(r, null), 'gone');
});

test('引用文字：长文截断，引用块格式', () => {
  assert.equal(snapOf('a'.repeat(700)).length, 600);
  assert.equal(quoteMd('标题', '第一行\n第二行'), '> 引用：标题\n> 第一行 第二行');
});
