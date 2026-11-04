// 中英双语：词典完整、占位符一致
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
test('英文词典：没有残留中文，{} 数量一致；路线、商机、知识树都有译文', () => {
  const D = JSON.parse(readFileSync(new URL('../src/i18n-en.json', import.meta.url)));
  for (const [k, v] of Object.entries(D)) { assert.ok(!/[㐀-鿿]/.test(v), k); assert.equal(k.split('{}').length, v.split('{}').length, k); }
  const norm = s => s.replace(/\s+/g, ' ').trim();
  for (const id of ['llm', 'slm', 'agent', 'quant']) {
    const t = JSON.parse(readFileSync(new URL(`../content/tracks/${id}.json`, import.meta.url)));
    for (const s of t.stages) assert.ok(D[norm(s.title)], s.title);
  }
  for (const x of JSON.parse(readFileSync(new URL('../content/biz.json', import.meta.url))).items) assert.ok(D[norm(x.title)], x.title);
  const tax = JSON.parse(readFileSync(new URL('../content/taxonomy.json', import.meta.url)));
  for (const L of Object.values(tax.tracks)) for (const a of L) assert.ok(D[a.name], a.name);
});
