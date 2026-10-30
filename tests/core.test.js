// 单元测试：node --test tests/*.test.js   （Node 18+ 自带，无需安装依赖）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { newDoc, setKey, delKey, mergeDoc, sameDoc } from '../src/core/doc.js';
import { migrateV1, validProgress, validNote, ITEM_RE, STAGE_RE } from '../src/store/migrate.js';
import { pct, curWeek, stageAt, trackItemIds } from '../src/core/progress.js';
import { groupByAge, daysAgo } from '../src/core/feed.js';

const legacy = JSON.parse(fs.readFileSync(new URL('../content/legacy-v1.json', import.meta.url)));
const track = id => JSON.parse(fs.readFileSync(new URL(`../content/tracks/${id}.json`, import.meta.url)));
const TRACKS = ['llm', 'slm', 'agent', 'quant'].map(track);

test('内容：所有 ID 唯一且格式正确', () => {
  const ids = new Set();
  for (const t of TRACKS) for (const s of t.stages) {
    assert.match(s.id, STAGE_RE);
    for (const i of s.items) { assert.match(i.id, ITEM_RE); assert.ok(!ids.has(i.id), '重复 ' + i.id); ids.add(i.id); }
  }
  assert.equal(ids.size, 109);
});

test('内容：旧 ID 对照表覆盖全部任务和阶段', () => {
  const all = new Set(TRACKS.flatMap(trackItemIds));
  assert.equal(Object.keys(legacy.done).length, all.size);
  for (const id of Object.values(legacy.done)) assert.ok(all.has(id));
  assert.equal(Object.keys(legacy.notes).length, TRACKS.reduce((a, t) => a + t.stages.length, 0));
  // 对照表顺序：旧版先 tech 后 prod，新版 items 也按这个顺序
  assert.equal(legacy.done['agent.1.prod.0'], 'agent.s02.i04');
});

test('迁移：v1 进度、笔记、取消勾选都正确转换', () => {
  const v1 = {
    start: '2026-10-12',
    done: { 'llm.0.tech.0': '2026-10-13', 'agent.1.prod.1': '2026-10-20', 'bogus.9.tech.9': 'x' },
    notes: { 'llm.0': 'nanoGPT 跑通了', 'quant.5': '' },
    mt: { start: 100, 'done.llm.0.tech.0': 200, 'done.slm.0.tech.0': 300, 'notes.llm.0': 400 }
  };
  const { progress, notes, unmapped } = migrateV1(v1, legacy);
  assert.equal(progress.e.start, '2026-10-12');
  assert.equal(progress.e['llm.s01.i01'], '2026-10-13');
  assert.equal(progress.mt['llm.s01.i01'], 200);
  assert.equal(progress.e['agent.s02.i05'], '2026-10-20');
  assert.equal(progress.mt['agent.s02.i05'], 1, '没有时间戳的旧数据记为 1');
  assert.ok(!('slm.s01.i01' in progress.e) && progress.mt['slm.s01.i01'] === 300, '保留“取消勾选”的记录');
  assert.equal(notes.e['llm.s01'], 'nanoGPT 跑通了');
  assert.ok(!('quant.s06' in notes.e), '空笔记不迁移');
  assert.deepEqual(unmapped, ['done.bogus.9.tech.9']);
});

test('迁移：空数据和坏数据不报错', () => {
  assert.deepEqual(migrateV1(null, legacy).progress, newDoc());
  const r = migrateV1({ start: 'abc', done: 'x', notes: 5 }, legacy);
  assert.deepEqual(r.progress.e, {});
});

test('合并：各项按修改时间取较新的一方，删除也能同步', () => {
  const a = newDoc(), b = newDoc();
  setKey(a, 'llm.s01.i01', '2026-10-01', 10);
  setKey(a, 'llm.s01.i02', '2026-10-01', 10);
  setKey(b, 'llm.s01.i01', '2026-10-05', 20);   // b 更新
  delKey(b, 'llm.s01.i02', 30);                // b 取消勾选
  setKey(b, 'llm.s01.i03', '2026-10-06', 5);   // b 新增
  assert.equal(mergeDoc(a, b, validProgress), true);
  assert.equal(a.e['llm.s01.i01'], '2026-10-05');
  assert.ok(!('llm.s01.i02' in a.e));
  assert.equal(a.e['llm.s01.i03'], '2026-10-06');
  assert.equal(mergeDoc(a, b, validProgress), false, '再合并一次没有变化');
  assert.ok(sameDoc(a, b));
});

test('合并：较旧的远端修改不会覆盖本地', () => {
  const a = newDoc(), b = newDoc();
  setKey(a, 'x.s01', '新笔记', 50);
  setKey(b, 'x.s01', '旧笔记', 40);
  assert.equal(mergeDoc(a, b, validNote), false);
  assert.equal(a.e['x.s01'], '新笔记');
});

test('合并：拒绝非法键值', () => {
  const a = newDoc();
  const evil = { e: { '__proto__': 'x', 'llm.s01.i01': 123, 'start': 'not-a-date', '<img>': 'y' }, mt: { '__proto__': 9, 'llm.s01.i01': 9, start: 9, '<img>': 9 } };
  mergeDoc(a, evil, validProgress);
  assert.deepEqual(Object.keys(a.e), []);
});

test('进度：完成比例、当前周、当前阶段', () => {
  assert.equal(pct({ a: 1, b: 1 }, ['a', 'b', 'c', 'd']), 0.5);
  assert.equal(pct({}, []), 0);
  const t0 = new Date('2026-10-12T00:00:00');
  assert.equal(curWeek('2026-10-12', t0), 1);
  assert.equal(curWeek('2026-10-12', new Date('2026-10-19T00:00:00')), 2);
  assert.equal(stageAt(track('agent'), 5).id, 'agent.s02');
});

test('资讯：按时间分组，支持月份和年份精度', () => {
  const today = new Date('2026-10-30T00:00:00');
  assert.equal(daysAgo('2026-10-30', today), 0);
  const g = groupByAge([{ d: '2026-10-28' }, { d: '2026-10-10' }, { d: '2026-09' }, { d: '2025-04-03' }], today);
  assert.deepEqual(g.map(x => [x.id, x.items.length]), [['w', 1], ['m', 1], ['q', 1], ['o', 1]]);
});
