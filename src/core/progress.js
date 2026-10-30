// 进度计算（纯函数，可在 Node 里测试）
export const WEEKS = 26;

export const stageItemIds = stage => stage.items.map(i => i.id);
export const trackItemIds = track => track.stages.flatMap(stageItemIds);

// done：{ 任务 ID: 完成日期 }
export const pct = (done, ids) => ids.length ? ids.filter(id => done[id]).length / ids.length : 0;
export const countDone = (done, ids) => ids.filter(id => done[id]).length;

// 开始日期起算的第几周（第 1 周从开始当天算起）
export function curWeek(start, today) {
  const st = new Date(start + 'T00:00:00');
  return Math.floor((today - st) / 864e5 / 7) + 1;
}
export const stageAt = (track, week) => track.stages.find(s => week >= s.weeks[0] && week <= s.weeks[1]);
