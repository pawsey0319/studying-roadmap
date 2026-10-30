// 资讯分组（纯函数）
// 时间分组：近 7 天、近 30 天默认展开，其余折叠
export const GROUPS = [
  { id: 'w', name: '最近 7 天', max: 7, open: true },
  { id: 'm', name: '最近 30 天', max: 30, open: true },
  { id: 'q', name: '1–3 个月前', max: 92, open: false },
  { id: 'o', name: '3 个月以前', max: Infinity, open: false }
];

// 支持 YYYY-MM-DD、YYYY-MM、YYYY 三种精度
export function daysAgo(d, today) {
  const full = d.length === 7 ? d + '-01' : d.length === 4 ? d + '-01-01' : d;
  return (today - new Date(full + 'T00:00:00')) / 864e5;
}

export function groupByAge(items, today) {
  let lo = -Infinity;
  return GROUPS.map(g => {
    const its = items.filter(x => { const a = daysAgo(x.d, today); return a > lo && a <= g.max; });
    lo = g.max;
    return { ...g, items: its };
  }).filter(g => g.items.length);
}

export const byDateDesc = (a, b) => (a.d < b.d ? 1 : a.d > b.d ? -1 : 0);
