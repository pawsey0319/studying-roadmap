// 第一版：回答依据、引用整条路线、导出我的学习 Agent（Skill）
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { srcItem, mergeSources, sourcesText, backgroundSources, SRC_MAX } from '../src/core/sources.js';
import { copyTrack, snapshot } from '../src/core/public.js';
import { agentSkill, SKILL_NAME } from '../src/core/ctxpack.js';
import { DOCS, ITEM_RE, STAGE_RE } from '../src/core/schema.js';
import { makeRef, refOk } from '../src/core/marks.js';

test('依据：校验、截断、去重、上限、文字', () => {
  assert.equal(srcItem('x', 'a', 'b'), null, '类型不在范围内');
  assert.equal(srcItem('card', '', 't'), null, '没有 ID');
  assert.equal(srcItem('card', 'c1', '  一  二 ').title, '一 二');
  assert.equal(srcItem('card', 'c1', '字'.repeat(50)).title.length, 40);
  assert.equal(srcItem('card', 'c1', '').title, 'c1', '没有标题时用 ID');
  const a = srcItem('stage', 'agent.s02', '阶段二'), b = srcItem('card', 'c1abc', '卡片');
  assert.deepEqual(mergeSources([a, b], [a, null, { t: 'bad', id: 1 }]), [a, b]);
  assert.equal(mergeSources([...Array(12)].map((_, i) => srcItem('news', 'n' + i, 'x'))).length, SRC_MAX);
  assert.equal(sourcesText([]), '没有引用你的资料，以下是通用知识');
  assert.equal(sourcesText([a, b]), '参考了：阶段「阶段二」、笔记「卡片」');
  const bg = backgroundSources({ profile: '懂 Python', method: '- 先看例子', memory: '', recent: '', journal: '', tests: '' });
  assert.deepEqual(bg.map(x => [x.t, x.id, x.title]), [['background', 'profile', '学习者档案'], ['background', 'method', '学习方法档案']]);
});

test('引用整条路线：复制个人调整后的结构，ID 合法且稳定，原方向不变，可以记一条引用', () => {
  const t = JSON.parse(fs.readFileSync(new URL('../content/tracks/agent.json', import.meta.url)));
  const before = JSON.stringify(t);
  const s0 = t.stages[0], i0 = s0.items[0];
  const ov = { [s0.id]: { skip: [i0.id], add: [{ id: s0.id + '.uabcdefgh12', text: '新任务', mode: 'practice' }] } };
  const tid = 'uabcdefghij', c = copyTrack(t, ov, { tid, color: '#000000' });
  assert.ok(DOCS.tracks(tid, c), '能通过 tracks 文档的校验');
  assert.equal(c.stages.length, t.stages.length);
  for (const s of c.stages) { assert.match(s.id, STAGE_RE); assert.ok(s.id.startsWith(tid + '.')); for (const i of s.items) assert.match(i.id, ITEM_RE); }
  assert.ok(!c.stages[0].items.some(i => i.text === i0.text), '跳过的任务不复制');
  assert.ok(c.stages[0].items.some(i => i.text === '新任务' && i.mode === 'practice'), '个人新增的任务复制');
  assert.equal(c.source, '引用自：' + t.name);
  assert.equal(JSON.stringify(t), before, '原方向没有被改动');
  assert.deepEqual(copyTrack(t, ov, { tid }).stages.map(s => s.id), c.stages.map(s => s.id), '同一个 tid 结果一样');
  const [qid, r] = makeRef({ from: { k: 'track', id: tid }, to: { k: 'track', id: t.id }, text: t.goal, id: 'q1abcdef', now: 1 });
  assert.ok(refOk(qid, r));
  // 某个阶段的任务被全部跳过：引用时保留这个阶段（阶段数不变），公开快照仍然去掉空阶段
  const ov2 = { [s0.id]: { skip: s0.items.map(i => i.id) } };
  assert.equal(copyTrack(t, ov2, { tid: 'uabcdefghik' }).stages.length, t.stages.length, '空阶段也保留');
  assert.equal(snapshot(t, ov2).stages.length, t.stages.length - 1, '发布快照去掉空阶段');
});

test('导出我的学习 Agent：SKILL.md 符合规范', () => {
  const o = agentSkill({ sections: [{ h: '我的学习方法', body: '- 呈现偏好：先看例子' }, { h: '空的', body: '  ' }], date: '2026-11-06', version: '20261106-1530' });
  const t = o.parts[0];
  assert.equal(o.file, 'SKILL.md'); assert.equal(o.dir, SKILL_NAME);
  const fm = t.match(/^---\n([\s\S]*?)\n---\n/); assert.ok(fm, '有 frontmatter');
  const name = fm[1].match(/^name: (.+)$/m)[1], desc = fm[1].match(/^description: (.+)$/m)[1];
  assert.match(name, /^[a-z0-9]+(-[a-z0-9]+)*$/); assert.ok(name.length <= 64);
  assert.ok(desc.length > 0 && desc.length <= 1024); assert.ok(!/: /.test(desc), 'description 里没有会破坏 YAML 的英文冒号加空格');
  assert.match(t, /不会随我在 App 里的学习自动更新/); assert.match(t, /## 我的学习方法\n- 呈现偏好：先看例子/); assert.ok(!/## 空的/.test(t));
  const long = agentSkill({ sections: [{ h: '长', body: 'x'.repeat(30000) }], date: 'd', version: 'v', max: 20000 });
  assert.ok(long.over && long.parts[0].length <= 20000);
  assert.throws(() => agentSkill({ sections: [], date: 'd', version: 'v', name: 'My Agent' }), /小写字母/);
});

import { bumpStat, weekStats } from '../src/core/progress.js';
test('使用统计：按天累计，最近 7 天汇总，只留 60 天', () => {
  let s = bumpStat(null, '2026-11-06', 'o'); s = bumpStat(s, '2026-11-06', 'o'); s = bumpStat(s, '2026-11-06', 'a'); s = bumpStat(s, '2026-11-06', 'a', 2); s = bumpStat(s, '2026-11-01', 't');
  assert.deepEqual(s.d['2026-11-06'], { o: 1, a: 3, t: 0 });
  assert.deepEqual(weekStats(s, '2026-11-06'), { open: 1, agent: 3, tasks: 1 });
  assert.deepEqual(weekStats(s, '2026-11-13'), { open: 0, agent: 0, tasks: 0 });
  let z = null; for (let i = 0; i < 70; i++) z = bumpStat(z, new Date(Date.UTC(2026, 0, 1 + i)).toISOString().slice(0, 10), 'o');
  assert.equal(Object.keys(z.d).length, 60); assert.ok(!z.d['2026-01-01']);
});
