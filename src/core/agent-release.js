// 人工审核发布记录，不含生产Key、不执行部署。候选只能给出数据，不能自批/发布。
export const RELEASE_SCHEMA = 'lh-agent-release/1';
const fail = code => { throw Object.assign(new Error(code), { code }); };
const text = (v, n = 200) => String(v ?? '').slice(0, n);
const admin = a => { if (!a?.id || a.role !== 'admin') fail('ADMIN_REQUIRED'); };
export function createReleaseCandidate({ id, spec, modelRevision, at, summary = '' }) {
  if (!id || !spec || !modelRevision || !Number.isFinite(at)) fail('INVALID_CANDIDATE');
  return { schema: RELEASE_SCHEMA, id: text(id, 100), spec: text(spec, 100), modelRevision: text(modelRevision, 100), summary: text(summary, 1000), state: 'candidate', evaluation: null, rollout: 0, history: [{ action: 'candidate', at }], productionCredentials: false };
}
export function transitionRelease(candidate, action, { actor, at, evaluation, rollout, previousReleaseId = '' } = {}) {
  admin(actor);
  if (candidate?.schema !== RELEASE_SCHEMA || !Number.isFinite(at)) fail('INVALID_RELEASE');
  const next = { ...candidate, history: [...candidate.history, { action, actorId: actor.id, at }], productionCredentials: false };
  const state = candidate.state;
  if (action === 'review' && state === 'candidate') next.state = 'reviewed';
  else if (action === 'evaluate' && ['reviewed', 'evaluated'].includes(state)) {
    // A client-supplied manifest/passed flag is not trusted behavioral evidence.
    // No trusted evaluator registry is installed in this version: fail closed.
    fail('EVALUATOR_NOT_CONFIGURED');
  } else if (action === 'approve' && state === 'evaluated') {
    fail('EVALUATOR_NOT_CONFIGURED');
  } else if (action === 'canary' && ['approved', 'canary'].includes(state)) {
    if (!Number.isInteger(rollout) || rollout < 1 || rollout > 99 || rollout < candidate.rollout) fail('INVALID_ROLLOUT');
    if (!previousReleaseId) fail('ROLLBACK_TARGET_REQUIRED');
    next.state = 'canary'; next.rollout = rollout; next.previousReleaseId = text(previousReleaseId, 100);
  } else if (action === 'release' && state === 'canary') { next.state = 'released'; next.rollout = 100; }
  else if (action === 'rollback' && ['canary', 'released'].includes(state)) {
    if (!candidate.previousReleaseId) fail('ROLLBACK_TARGET_REQUIRED');
    next.state = 'rolled_back'; next.rollout = 0; next.rollbackTarget = candidate.previousReleaseId;
    next.rollbackNotice = '仅回退后续配置，不撤销已执行的数据变更';
  } else if (action === 'reject' && ['candidate', 'reviewed', 'evaluated', 'approved'].includes(state)) next.state = 'rejected';
  else fail('INVALID_RELEASE_TRANSITION');
  return next;
}
