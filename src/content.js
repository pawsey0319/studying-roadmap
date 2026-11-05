// 公共内容：从 content/ 和 data/ 读取 JSON。线上由 GitHub Pages 提供；本地预览要先运行 python3 -m http.server。
import { isNative, REMOTE } from './native.js';
// App 里：每天、每周更新的内容先从网站取最新的（4 秒超时），取不到用安装包里的
async function remote(url) {
  const c = new AbortController(), t = setTimeout(() => c.abort(), 4000);
  try { const r = await fetch(REMOTE + url, { cache: 'no-cache', signal: c.signal }); return r.ok ? await r.json() : null; } catch (e) { return null; } finally { clearTimeout(t); }
}
// App 里先用安装包自带的内容立刻显示，打开后再在后台取网站上的最新内容（见 refreshLive），不让用户等网络
const get = async (url, optional) => {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' 返回 ' + r.status);
    return await r.json();
  } catch (e) { if (optional) return null; throw e; }
};

export async function loadContent() {
  // 方向清单和其他文件同时请求，不再先等 domains 再等其余
  const [domains, feed, legacy, routes, biz, suggestions, sources, community, config, hot, github, taxonomy] = await Promise.all([
    get('content/domains.json'),
    get('content/feed.json'),
    get('content/legacy-v1.json'),
    get('content/routes.json'),
    get('content/biz.json'),
    get('content/suggestions.json', true),
    get('data/sources.json', true),     // 每天由 GitHub Actions 生成，本地可能没有
    get('data/community.json', true),   // 每周生成
    get('config.json', true),           // 云端公开配置，没有就只用本地 + Gist
    get('data/hot.json', true),         // 财经快讯快照（云端读不到时兜底）
    get('data/github.json', true),      // 关键项目新版本、新星项目（Actions 用令牌预取）
    get('content/taxonomy.json', true)  // 知识树前两层的分类
  ]);
  const tracks = await Promise.all(domains.flatMap(d => d.tracks).map(id => get(`content/tracks/${id}.json`)));
  return { domains, tracks, feed, legacy, routes, biz, suggestions: suggestions || { items: [] }, sources, community, hot, github, taxonomy, config: config || {} };
}

// App 打开后在后台取网站上最新的资讯、路线、快照；有更新就换进 C，返回是否有变化
export async function refreshLive(C) {
  if (!isNative()) return false;
  const want = { feed: 'content/feed.json', routes: 'content/routes.json', biz: 'content/biz.json', suggestions: 'content/suggestions.json', sources: 'data/sources.json', community: 'data/community.json', hot: 'data/hot.json', github: 'data/github.json' };
  const got = await Promise.all(Object.entries(want).map(async ([k, u]) => [k, await remote(u)]));
  let changed = false;
  for (const [k, v] of got) if (v) { C[k] = v; changed = true; }
  return changed;
}
