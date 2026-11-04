// N4：上下文导出（场景、工具格式、长度拆分、效果回流）
import test from 'node:test';
import assert from 'node:assert/strict';
import { TOOLS, build, split, prefillUrl, mergeTools, bestCombo, reqSections } from '../src/core/ctxpack.js';

const T = id => TOOLS.find(t => t.id === id);
const req = { title: '客户回访助手', users: '小微企业销售', scene: '每天打开看今天该回访谁', style: '简洁',
  pages: [{ name: '今日回访', purpose: '列出待回访客户', elements: ['客户卡片', '一键记录'] }, { name: '客户详情', elements: ['历史记录'] }],
  data: ['20 条客户记录'], accept: ['能把一位客户标为已回访'] };

test('需求包分节：概览 + 每页一节 + 数据 + 验收', () => {
  const s = reqSections(req);
  assert.deepEqual(s.map(x => x.h), ['要做什么', '页面：今日回访', '页面：客户详情', '数据', '验收标准']);
  assert.match(s[0].body, /页面（2 个）：今日回访、客户详情/);
});

test('每种工具各导出一次：格式和长度都符合', () => {
  const secs = reqSections(req).map(x => ({ id: 'req', ...x }));
  for (const t of TOOLS) {
    const o = build({ scene: 'demo', tool: t, sections: secs, extra: '风格参考飞书', title: '客户回访助手' });
    for (const p of o.parts) assert.ok(p.length <= t.max, `${t.name} 超长`);
    if (t.kind === 'builder') assert.match(o.parts[0], /^帮我做一个可以演示的 Web 应用 demo/);
    if (t.kind === 'chat') assert.match(o.parts[0], /先读完，用一两句话复述/);
    if (t.kind === 'file') { assert.equal(o.file, t.file); assert.match(o.parts[0], /^# 客户回访助手/); assert.match(o.parts[0], /## 工作方式/); }
    if (t.kind === 'skill') assert.match(o.parts[0], /^---\nname: [a-z0-9-]+\ndescription: .+\n---/);
    assert.match(o.parts.join(''), /我补充的话\n风格参考飞书/);
  }
});

test('超过上限时拆段：每段不超长、第一段说明总段数、后面每段说明是续写', () => {
  const secs = Array.from({ length: 12 }, (_, i) => ({ h: '页面 ' + i, body: ('这一页要有的东西。').repeat(30) }));
  const parts = split('开头说明', secs, 1200);
  assert.ok(parts.length > 2);
  parts.forEach(p => assert.ok(p.length <= 1200, p.length));
  assert.match(parts[0], new RegExp(`分 ${parts.length} 段`)); assert.match(parts[1], new RegExp(`第 2 段（共 ${parts.length} 段）`));
  // 单节就超长：按行切开
  const big = split('x', [{ h: '大', body: Array.from({ length: 200 }, (_, i) => '- 第 ' + i + ' 行内容').join('\n') }], 800);
  big.forEach(p => assert.ok(p.length <= 800)); assert.match(big[1], /## 大（续）/);
  assert.deepEqual(split('短', [{ h: 'a', body: 'b' }], 1000), ['短\n\n## a\nb']);
});

test('预填链接、配置表合并、评分最高的组合', () => {
  assert.match(prefillUrl(T('lovable'), '做一个 todo'), /^https:\/\/lovable\.dev\/\?autosubmit=true#prompt=%E5%81%9A/);
  assert.equal(prefillUrl(T('v0'), 'x'), '');
  assert.equal(prefillUrl(T('lovable'), 'x'.repeat(20000)), '');
  const L = mergeTools([{ id: 'v0', name: 'v0', kind: 'builder', max: 3000 }, { id: 'mine', name: '自建', kind: 'chat', max: 500, url: 'javascript:alert(1)' }, { id: 'BAD ID', name: 'x', kind: 'chat', max: 1 }]);
  assert.equal(L.find(t => t.id === 'v0').max, 3000); assert.equal(L.find(t => t.id === 'mine').url, ''); assert.equal(L.length, TOOLS.length + 1);
  const log = [{ scene: 'demo', picks: ['req'], rating: 3, tool: 'v0' }, { scene: 'demo', picks: ['biz', 'req'], rating: 5, tool: 'v0' }, { scene: 'demo', picks: ['req', 'biz'], rating: 4, tool: 'lovable' }, { scene: 'study', picks: ['x'], rating: 5 }, { scene: 'demo', picks: ['x'], rating: 0 }];
  const b = bestCombo(log, 'demo'); assert.deepEqual(b.picks, ['biz', 'req']); assert.equal(b.avg, 4.5); assert.equal(b.n, 2);
  assert.equal(bestCombo([], 'demo'), null);
});
