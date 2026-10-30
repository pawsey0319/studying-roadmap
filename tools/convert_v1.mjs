// 一次性脚本：把 v1 的 data/*.js 转成 v2 的 content/*.json，并给每个阶段、任务、资源分配稳定 ID。
// 同时生成 content/legacy-v1.json：旧版“板块.阶段序号.tech|prod.序号”到新 ID 的对照表，用于迁移用户进度。
// 用法：node tools/convert_v1.mjs（只在 M0 运行过一次，保留作为记录）
import fs from 'node:fs';
import vm from 'node:vm';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const rd = f => fs.readFileSync(path.join(ROOT, f), 'utf8');
const pad = n => String(n).padStart(2, '0');

const HUB = { tracks: [], track(t) { this.tracks.push(t); }, feed: {}, domains: [] };
const ctx = vm.createContext({ HUB });
for (const f of ['llm', 'slm', 'agent', 'quant']) vm.runInContext(rd(`data/${f}.js`), ctx);
vm.runInContext(rd('data/feed.js'), ctx);
if (fs.existsSync(path.join(ROOT, 'data/domains.js'))) vm.runInContext(rd('data/domains.js'), ctx);

const legacy = { done: {}, notes: {} };
fs.mkdirSync(path.join(ROOT, 'content/tracks'), { recursive: true });

for (const t of HUB.tracks) {
  const out = {
    id: t.id, domain: 'ai', name: t.name, short: t.short, color: t.color, hours: t.hours,
    goal: t.goal, ...(t.note ? { note: t.note } : {}), live: t.live,
    stages: t.stages.map((s, si) => {
      const sid = `${t.id}.s${pad(si + 1)}`;
      legacy.notes[`${t.id}.${si}`] = sid;
      let n = 0;
      const items = [];
      for (const kind of ['tech', 'prod']) {
        s[kind].forEach((text, i) => {
          const id = `${sid}.i${pad(++n)}`;
          legacy.done[`${t.id}.${si}.${kind}.${i}`] = id;
          items.push({ id, kind, text });
        });
      }
      return {
        id: sid, title: s.t, weeks: s.w, goal: s.goal, items,
        resources: s.res.map((r, i) => ({ id: `${sid}.r${pad(i + 1)}`, name: r[0], ...(r[1] ? { url: r[1] } : {}) })),
        output: s.out
      };
    }),
    frontier: t.frontier.map((x, i) => ({ id: `${t.id}.f${pad(i + 1)}`, title: x.t, desc: x.d, links: (x.l || []).map(([name, url]) => ({ name, url })) })),
    biz: {
      fresh: t.biz.fresh.map((x, i) => ({ id: `${t.id}.bn${pad(i + 1)}`, title: x.t, desc: x.d, links: (x.l || []).map(([name, url]) => ({ name, url })) })),
      old: t.biz.old.map((x, i) => ({ id: `${t.id}.bo${pad(i + 1)}`, title: x.t, desc: x.d, links: (x.l || []).map(([name, url]) => ({ name, url })) }))
    }
  };
  fs.writeFileSync(path.join(ROOT, `content/tracks/${t.id}.json`), JSON.stringify(out, null, 2) + '\n');
}

const feed = {
  updated: HUB.feed.updated,
  items: HUB.feed.items.map(x => ({ d: x.d, k: x.k, type: x.type, t: x.t, s: x.s, u: x.u, src: x.src, lvl: x.lvl }))
};
fs.writeFileSync(path.join(ROOT, 'content/feed.json'), JSON.stringify(feed, null, 1) + '\n');

const domains = (HUB.domains.length ? HUB.domains : [{ id: 'ai', name: 'AI 与量化' }])
  .map(d => ({ id: d.id, name: d.name, lede: d.lede, profile: d.profile, tracks: HUB.tracks.map(t => t.id) }));
fs.writeFileSync(path.join(ROOT, 'content/domains.json'), JSON.stringify(domains, null, 2) + '\n');
fs.writeFileSync(path.join(ROOT, 'content/legacy-v1.json'), JSON.stringify(legacy, null, 1) + '\n');

console.log(`tracks ${HUB.tracks.length}, tasks ${Object.keys(legacy.done).length}, stages ${Object.keys(legacy.notes).length}, feed ${feed.items.length}`);
