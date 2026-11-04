// 公共内容：从 content/ 和 data/ 读取 JSON。线上由 GitHub Pages 提供；本地预览要先运行 python3 -m http.server。
const get = async (url, optional) => {
  try {
    const r = await fetch(url, { cache: 'no-cache' });
    if (!r.ok) throw new Error(url + ' 返回 ' + r.status);
    return await r.json();
  } catch (e) { if (optional) return null; throw e; }
};

export async function loadContent() {
  const domains = await get('content/domains.json');
  const ids = domains.flatMap(d => d.tracks);
  const [tracks, feed, legacy, routes, biz, suggestions, sources, community, config, hot] = await Promise.all([
    Promise.all(ids.map(id => get(`content/tracks/${id}.json`))),
    get('content/feed.json'),
    get('content/legacy-v1.json'),
    get('content/routes.json'),
    get('content/biz.json'),
    get('content/suggestions.json', true),
    get('data/sources.json', true),     // 每天由 GitHub Actions 生成，本地可能没有
    get('data/community.json', true),   // 每周生成
    get('config.json', true),           // 云端公开配置，没有就只用本地 + Gist
    get('data/hot.json', true)          // 财经快讯快照（云端读不到时兜底）
  ]);
  return { domains, tracks, feed, legacy, routes, biz, suggestions: suggestions || { items: [] }, sources, community, hot, config: config || {} };
}
