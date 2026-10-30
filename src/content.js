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
  const [tracks, feed, legacy, sources, community] = await Promise.all([
    Promise.all(ids.map(id => get(`content/tracks/${id}.json`))),
    get('content/feed.json'),
    get('content/legacy-v1.json'),
    get('data/sources.json', true),     // 每天由 GitHub Actions 生成，本地可能没有
    get('data/community.json', true)    // 每周生成
  ]);
  return { domains, tracks, feed, legacy, sources, community };
}
