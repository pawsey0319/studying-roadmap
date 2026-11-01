// 个人层：把用户的调整叠加到公共路线上（纯函数）。原版永远不改，恢复原版 = 删掉这条调整。
// overlay 结构：{ goal?, mastered?, skip?: [任务 ID], add?: [{id,text,mode}], edit?: {任务 ID: 新文本}, res?: [{id,name,url,ai}], at?: 时间 }
import { guessMode } from './ids.js';

export function effectiveStage(stage, ov) {
  ov = ov || {};
  const skip = new Set(ov.skip || []);
  const edit = ov.edit || {};
  const items = stage.items.map(i => ({ ...i, text: edit[i.id] || i.text, edited: !!edit[i.id], skipped: skip.has(i.id) }))
    .concat((ov.add || []).map(a => ({ id: a.id, text: a.text, mode: a.mode || guessMode(a.text), added: true, skipped: skip.has(a.id), ai: !!a.ai })));
  return {
    ...stage,
    goal: ov.goal || stage.goal,
    goalEdited: !!ov.goal,
    items,
    resources: (stage.resources || []).concat((ov.res || []).map(r => ({ ...r, added: true }))),
    mastered: !!ov.mastered,
    personalized: !!(ov.goal || ov.mastered || (ov.skip && ov.skip.length) || (ov.add && ov.add.length) || Object.keys(edit).length || (ov.res && ov.res.length))
  };
}

// 计入进度的任务：已掌握的阶段全部算完成；跳过的任务不计入
export function stageProgress(es, done) {
  const active = es.items.filter(i => !i.skipped);
  const n = es.mastered ? active.length : active.filter(i => done[i.id]).length;
  return { n, total: active.length, pct: active.length ? n / active.length : (es.mastered ? 1 : 0), complete: es.mastered || (active.length > 0 && n === active.length) };
}

// 应用一份修改方案（Agent 或每周建议给出的 ops），返回新的 overlay，不修改入参。
// op 类型：goal{text}、skip{id}、unskip{id}、add{text,mode}、edit{id,text}、res{name,url}、mastered{}、unmastered{}
export function applyOps(ov, ops, idGen) {
  const o = JSON.parse(JSON.stringify(ov || {}));
  for (const op of ops || []) {
    switch (op.op) {
      case 'goal': if (op.text) o.goal = String(op.text).slice(0, 600); break;
      case 'skip': o.skip = [...new Set([...(o.skip || []), op.id])]; break;
      case 'unskip': o.skip = (o.skip || []).filter(x => x !== op.id); break;
      case 'add': if (op.text) (o.add = o.add || []).push({ id: idGen(), text: String(op.text).slice(0, 500), mode: op.mode === 'practice' ? 'practice' : op.mode === 'theory' ? 'theory' : guessMode(op.text), ...(op.ai ? { ai: true } : {}) }); break;
      case 'edit': if (op.id && op.text) (o.edit = o.edit || {})[op.id] = String(op.text).slice(0, 500); break;
      case 'res': if (op.name) (o.res = o.res || []).push({ id: idGen(), name: String(op.name).slice(0, 200), ...(/^https?:\/\//.test(op.url || '') ? { url: op.url } : {}), ...(op.ai ? { ai: true } : {}) }); break;
      case 'mastered': o.mastered = true; break;
      case 'unmastered': delete o.mastered; break;
      case 'remove': // 删除自己新增的任务或资源
        o.add = (o.add || []).filter(x => x.id !== op.id); o.res = (o.res || []).filter(x => x.id !== op.id); break;
    }
  }
  for (const k of ['skip', 'add', 'res']) if (o[k] && !o[k].length) delete o[k];
  if (o.edit && !Object.keys(o.edit).length) delete o.edit;
  return o;
}

// 校验并清洗模型给出的 ops：只保留认识的类型、存在的任务 ID
export function cleanOps(ops, stage) {
  const ids = new Set(stage.items.map(i => i.id));
  const ok = [];
  for (const op of Array.isArray(ops) ? ops : []) {
    if (!op || typeof op !== 'object') continue;
    const why = typeof op.why === 'string' ? op.why.slice(0, 300) : '';
    if (op.op === 'goal' && typeof op.text === 'string' && op.text.trim()) ok.push({ op: 'goal', text: op.text.trim(), why });
    else if ((op.op === 'skip' || op.op === 'unskip') && ids.has(op.id)) ok.push({ op: op.op, id: op.id, why });
    else if (op.op === 'edit' && ids.has(op.id) && typeof op.text === 'string' && op.text.trim()) ok.push({ op: 'edit', id: op.id, text: op.text.trim(), why });
    else if (op.op === 'add' && typeof op.text === 'string' && op.text.trim()) ok.push({ op: 'add', text: op.text.trim(), mode: op.mode, why });
    else if (op.op === 'res' && typeof op.name === 'string' && op.name.trim()) ok.push({ op: 'res', name: op.name.trim(), url: typeof op.url === 'string' ? op.url : '', why });
    else if (op.op === 'mastered' || op.op === 'unmastered') ok.push({ op: op.op, why });
  }
  return ok;
}

// 用户手动跳过只能由人发起：Agent 给出的 skip / mastered 默认不勾选
export const needsManualConfirm = op => op.op === 'skip' || op.op === 'mastered';
