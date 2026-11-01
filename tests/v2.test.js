// v2 纯函数测试：个人层、前沿路线、ID、Markdown、数据校验、Agent 解析、文档导入
import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import { effectiveStage, stageProgress, applyOps, cleanOps, needsManualConfirm } from '../src/core/overlay.js';
import { matchRoutes, tagNews, hasNew, visibleRoutes, timeline } from '../src/core/routes.js';
import { normUrl, newsId, guessMode } from '../src/core/ids.js';
import { md } from '../src/core/md.js';
import { DOCS, ITEM_RE, STAGE_RE } from '../src/core/schema.js';
import { extractBlocks, looseJSON, cleanPlan, summaryStatus } from '../src/ai/agent.js';
import { fromPaste, ruleParse, normalizeTrack, dupStages } from '../src/import/parse.js';

const read = p => JSON.parse(fs.readFileSync(new URL(p, import.meta.url)));
const agent = read('../content/tracks/agent.json');
const ROUTES = read('../content/routes.json').routes;
const s2 = agent.stages[1];
let n = 0; const gen = () => `${s2.id}.u${(++n).toString(36).padStart(4, '0')}`;

test('内容：每个阶段都有理论和实践验证，路线和商机字段齐全', () => {
  for (const id of ['llm', 'slm', 'agent', 'quant']) {
    for (const s of read(`../content/tracks/${id}.json`).stages) {
      assert.ok(s.items.some(i => i.mode === 'theory'), s.id + ' 缺理论');
      assert.ok(s.items.some(i => i.mode === 'practice'), s.id + ' 缺实践验证');
    }
  }
  const ids = new Set();
  for (const r of ROUTES) {
    assert.match(r.id, STAGE_RE); assert.ok(!ids.has(r.id)); ids.add(r.id);
    assert.ok(r.kw.length && r.title && r.track);
    for (const l of r.learn) assert.match(l.id, ITEM_RE);
  }
  for (const b of read('../content/biz.json').items) assert.ok(b.title && b.track && ['new', 'old'].includes(b.kind));
});

test('个人层：跳过、改写、新增、已掌握，原版不变，可恢复', () => {
  const before = JSON.stringify(s2);
  const ov = applyOps({}, [
    { op: 'skip', id: s2.items[0].id }, { op: 'edit', id: s2.items[1].id, text: '改写后的任务' },
    { op: 'add', text: '写一个 MCP Server' }, { op: 'goal', text: '新目标' }, { op: 'res', name: '规范', url: 'javascript:alert(1)' }
  ], gen);
  const es = effectiveStage(s2, ov);
  assert.equal(JSON.stringify(s2), before, '公共路线不被修改');
  assert.ok(es.personalized && es.goal === '新目标' && es.items[0].skipped && es.items[1].text === '改写后的任务');
  const added = es.items.at(-1);
  assert.equal(added.mode, 'practice'); assert.match(added.id, ITEM_RE);
  assert.ok(!('url' in es.resources.at(-1)), '非 http 链接被丢弃');
  const p = stageProgress(es, {});
  assert.equal(p.total, es.items.length - 1, '跳过的任务不计入');
  const m = stageProgress(effectiveStage(s2, applyOps(ov, [{ op: 'mastered' }], gen)), {});
  assert.ok(m.complete && m.pct === 1);
  const back = applyOps(ov, [{ op: 'unskip', id: s2.items[0].id }, { op: 'remove', id: added.id }], gen);
  assert.ok(!back.skip && !back.add);
  assert.equal(effectiveStage(s2, null).personalized, false, '删掉调整 = 恢复原版');
});

test('个人层：清洗模型给出的方案，跳过和已掌握需要手动确认', () => {
  const ops = cleanOps([{ op: 'skip', id: 'agent.s99.i01' }, { op: 'skip', id: s2.items[0].id }, { op: 'drop' }, null, { op: 'add', text: '  ' }, { op: 'mastered' }], s2);
  assert.deepEqual(ops.map(o => o.op), ['skip', 'mastered']);
  assert.ok(ops.every(needsManualConfirm));
  assert.equal(needsManualConfirm({ op: 'add' }), false);
});

test('前沿路线：关键词按词边界匹配，只在本方向内，已合并的路线归到新路线', () => {
  const R = [{ id: 'a.r01', track: 'a', kw: ['MCP', '协议'], status: 'active' }, { id: 'a.r02', track: 'a', kw: ['A2A'], status: 'merged', into: 'a.r01' }, { id: 'b.r01', track: 'b', kw: ['MCP'], status: 'active' }];
  assert.deepEqual(matchRoutes('新版 MCP 规范', ['a'], R), ['a.r01']);
  assert.deepEqual(matchRoutes('SMCPX 无关', ['a'], R), []);
  assert.deepEqual(matchRoutes('A2A 更新', ['a'], R), ['a.r01']);
  assert.deepEqual(tagNews({ t: 'x', k: 'a', r: ['a.r09'] }, R), ['a.r09'], '每周整理给定的路线优先');
  const news = [{ d: '2026-11-01', r: ['a.r01'] }, { d: '2026-10-01', r: ['a.r01'] }];
  assert.ok(hasNew('a.r01', news, new Date('2026-11-02')));
  assert.ok(!hasNew('a.r01', news, new Date('2026-11-20')));
  assert.equal(timeline('a.r01', news)[0].d, '2026-11-01');
  const v = visibleRoutes(R, { 'a.r01': { name: '我的名字', stopped: true } }, 'a');
  assert.equal(v.length, 1); assert.ok(v[0].title === '我的名字' && v[0].stopped);
  // 内容里的每条路线都能用自己的关键词命中自己
  for (const r of ROUTES.filter(r => r.status === 'active')) assert.ok(matchRoutes(r.kw[0], [r.track], ROUTES).includes(r.id), r.id);
});

test('ID：链接规范化后同一篇资讯 ID 一致', () => {
  assert.equal(normUrl('https://www.Example.com/a/?utm_source=x#h'), 'example.com/a');
  assert.equal(newsId('https://example.com/a'), newsId('http://www.example.com/a/?ref=hn'));
  assert.match(newsId('https://x.org/1'), /^n[0-9a-f]{12}$/);
  assert.equal(guessMode('跑通 nanoGPT'), 'practice');
  assert.equal(guessMode('理解注意力机制'), 'theory');
});

test('Markdown：不执行 HTML，只允许 http 链接', () => {
  const h = md('# 标题\n<img src=x onerror=alert(1)>\n[a](javascript:alert(1)) [b](https://ok.com)\n- 一\n- 二\n```\n<b>\n```');
  assert.ok(!h.includes('<img') && h.includes('&lt;img'));
  assert.ok(!/href="javascript/.test(h) && h.includes('href="https://ok.com"'));
  assert.ok(h.includes('<ul><li>一</li><li>二</li></ul>') && h.includes('<pre><code>&lt;b&gt;</code></pre>'));
});

test('数据校验：各文档拒绝不合法的键值', () => {
  assert.ok(DOCS.progress('agent.s02.i03', '2026-11-01') && DOCS.progress('agent.s02.u1abc', '2026-11-01') && DOCS.progress('u1abcd.s01.i01', '2026-11-01'));
  assert.ok(!DOCS.progress('__proto__', 'x') && !DOCS.progress('agent.s02.i03', 5));
  assert.ok(DOCS.cards('c1abcdef', { t: 'x', at: 'agent.s02', c: 1 }) && !DOCS.cards('c1abcdef', { t: 'x', at: '<b>', c: 1 }));
  assert.ok(DOCS.later('n0123456789ab', { t: 'x', u: 'https://a.b' }) && !DOCS.later('n0123456789ab', { t: 'x', u: 'javascript:1' }));
  assert.ok(DOCS.meta('onboarded', '2026-11-01') && !DOCS.meta('v', 2), 'meta 只接受约定的键');
  assert.ok(DOCS.tracks('ext.agent', { stages: [] }) && !DOCS.tracks('agent', {}));
});

test('Agent：解析回复里的结构化代码块，容忍尾逗号', () => {
  const r = extractBlocks('先说结论。\n```plan\n{"stage":"agent.s02","title":"补动手","ops":[{"op":"add","text":"写 MCP Server",},],}\n```\n```note\n{"text":"笔记"}\n```\n```plan\n不是 JSON\n```');
  assert.equal(r.text, '先说结论。');
  assert.deepEqual(r.blocks.map(b => b.type), ['plan', 'note']);
  assert.equal(looseJSON('{"a":1,}').a, 1);
  const p = cleanPlan(r.blocks[0].data, s2);
  assert.equal(p.stage, s2.id); assert.equal(p.ops.length, 1);
  assert.equal(cleanPlan({ ops: [{ op: 'skip', id: 'nope' }] }, s2), null, '没有有效修改就不出方案');
  const st = summaryStatus({ tracks: [{ name: '智能体', level: '' }], purpose: '求职' });
  assert.ok(st.tracks && !st.levels && st.purpose && !st.ratio);
});

test('导入：Markdown 按标题分阶段，资源和产出归位，结构不清时交给 Agent', () => {
  const ex = fromPaste('# 推荐系统\n## 召回\n目标：理解召回\n- 读 YouTube DNN 论文\n- 实现一个双塔召回\n### 资源\n- [论文](https://arxiv.org/abs/1)\n## 排序\n- 学习 Wide&Deep\n- 跑通 DeepFM\n产出：一个排序 demo');
  const t = ruleParse(ex);
  assert.equal(t.name, '推荐系统');
  assert.deepEqual(t.stages.map(s => s.title), ['召回', '排序']);
  assert.equal(t.stages[0].goal, '理解召回');
  assert.equal(t.stages[0].resources[0].url, 'https://arxiv.org/abs/1');
  assert.equal(t.stages[0].items[1].mode, 'practice');
  assert.equal(t.stages[1].output, '一个排序 demo');
  for (const s of t.stages) for (const i of s.items) assert.match(i.id, ITEM_RE);
  assert.equal(ruleParse(fromPaste('只有一段话，没有结构。')), null);
  const tr = normalizeTrack({ name: 'x', stages: [{ title: '召回基础', items: ['读论文'] }, { title: '空', items: [] }] });
  assert.equal(tr.stages.length, 1, '空阶段被丢弃');
  const d = dupStages(tr, { stages: [{ title: '召回 基础' }, { title: '别的' }] });
  assert.equal(d[0].dup.title, '召回 基础');
});

test('每周自动生成的内容：精选、路线、待确认建议都能被网站正确读取', () => {
  const feed = read('../content/feed.json'), sugs = read('../content/suggestions.json');
  const stages = new Map(['llm', 'slm', 'agent', 'quant'].flatMap(id => read(`../content/tracks/${id}.json`).stages.map(s => [s.id, s])));
  const rids = new Set(ROUTES.map(r => r.id));
  for (const x of feed.items) {
    assert.match(x.d, /^\d{4}(-\d{2}){0,2}$/, x.t);
    assert.ok(['llm', 'slm', 'agent', 'quant'].includes(x.k) && ['news', 'paper', 'dir', 'biz'].includes(x.type), x.t);
    assert.match(x.u, /^https?:\/\//); assert.ok(['A', 'B'].includes(x.lvl), x.t);
    for (const r of x.r || []) assert.ok(rids.has(r), `${x.t} 的路线 ${r} 不存在`);
  }
  for (const r of ROUTES) if (r.status === 'merged') assert.ok(rids.has(r.into), r.id + ' 合并到了不存在的路线');
  for (const s of sugs.items) {
    assert.ok(DOCS.sugs(s.id, 'applied'), '建议 ID 格式不对：' + s.id);
    const st = stages.get(s.stage); assert.ok(st, s.id + ' 的阶段不存在');
    assert.equal(cleanOps(s.ops, st).length, s.ops.length, s.id + ' 有无效的修改');
  }
});
