// 页面里预取的脚本清单要和 src 下的模块一致，新增模块忘了加会拖慢首屏
import test from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
const walk = d => readdirSync(d).flatMap(f => { const p = join(d, f); return statSync(p).isDirectory() ? walk(p) : p.endsWith('.js') ? [p] : []; });
test('index.html 预取了 src 下全部脚本模块', () => {
  const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
  const root = fileURLToPath(new URL('..', import.meta.url));
  for (const f of walk(join(root, 'src'))) {
    const rel = f.slice(root.length);
    assert.ok(html.includes(`<link rel="modulepreload" href="${rel}">`), rel);
  }
});
