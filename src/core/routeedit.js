// 路线编辑：在已有方向上增删阶段（纯函数）。
// 公共方向不改原文件：新增阶段放到 ext.<方向> 的 stages，删除 = 记进 hidden，随时能恢复。
// 自己的方向（导入或 Agent 起草的 u…）直接改整条路线。
import { guessMode } from './ids.js';

const pad = n => String(n).padStart(2, '0');
const text = v => String(v == null ? '' : v).trim();

// 新增阶段的 ID：用 .sxNN，避开公共路线以后可能新增的 .sNN
export function nextStageId(trackId, usedIds = []) {
  const used = new Set(usedIds);
  for (let i = 1; i < 1000; i++) {
    const id = `${trackId}.sx${pad(i)}`;
    if (!used.has(id)) return id;
  }
  return `${trackId}.sx${Date.now().toString(36)}`;
}

// 新阶段：任务一行一条；以“写、做、搭、跑通…”开头的自动归到实践验证
export function makeStage(trackId, usedIds, { title = '新阶段', goal = '', items = [] } = {}) {
  const id = nextStageId(trackId, usedIds);
  const list = (Array.isArray(items) ? items : String(items).split('\n'))
    .map(x => (typeof x === 'string' ? { text: x } : x))
    .filter(x => x && text(x.text));
  return {
    id,
    title: text(title).slice(0, 120) || '新阶段',
    goal: text(goal).slice(0, 600),
    items: list.slice(0, 40).map((x, k) => ({
      id: `${id}.i${pad(k + 1)}`,
      kind: x.kind || 'tech',
      mode: x.mode === 'practice' || x.mode === 'theory' ? x.mode : guessMode(x.text),
      text: text(x.text).slice(0, 500)
    })),
    resources: [],
    output: ''
  };
}

// 公共方向的个人扩展：stages 追加在末尾，hidden 里的阶段不显示
export const newExt = (old = {}) => ({
  ...old,
  stages: Array.isArray(old.stages) ? old.stages.slice() : [],
  hidden: Array.isArray(old.hidden) ? old.hidden.filter(Boolean).slice(0, 200) : []
});

export function addExtStage(ext, stage) {
  const e = newExt(ext);
  return { ...e, stages: e.stages.concat(stage).slice(0, 40), hidden: e.hidden.filter(id => id !== stage.id) };
}

export function hideExtStage(ext, stageId) {
  const e = newExt(ext);
  return { ...e, hidden: [...new Set([...e.hidden, stageId])] };
}

export function unhideExtStage(ext, stageId) {
  const e = newExt(ext);
  return { ...e, hidden: e.hidden.filter(id => id !== stageId) };
}

export function removeExtStage(ext, stageId) {
  const e = newExt(ext);
  return { ...e, stages: e.stages.filter(s => s.id !== stageId), hidden: e.hidden.filter(id => id !== stageId) };
}

// 合并公共阶段和个人扩展；个人阶段永远排在公共阶段之后
export function mergeStages(base = [], ext = {}) {
  const hidden = new Set(Array.isArray(ext.hidden) ? ext.hidden : []);
  return base.filter(s => !hidden.has(s.id)).concat(Array.isArray(ext.stages) ? ext.stages : []);
}

// 自己的方向：直接增删
export function addOwnStage(track, stage) {
  return { ...track, stages: (track.stages || []).concat(stage).slice(0, 40) };
}
export function removeOwnStage(track, stageId) {
  return { ...track, stages: (track.stages || []).filter(s => s.id !== stageId) };
}
export function renameStage(track, stageId, patch = {}) {
  return { ...track, stages: (track.stages || []).map(s => s.id === stageId ? { ...s, ...patch } : s) };
}

// 给界面用：这条方向当前可见的阶段 ID
export const stageIds = stages => (stages || []).map(s => s.id);
