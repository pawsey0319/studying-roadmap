// 阶段四纯数据契约；调用者负责本地存储。原媒体/授权令牌永不进入快照。
export const SESSION_SCHEMA = 'lh-session/1';
export const QUALITY_SCHEMA = 'lh-quality-feedback/1';
const text = (v, n = 500) => String(v ?? '').slice(0, n);
const fail = code => { throw Object.assign(new Error(code), { code }); };
const id = v => { const s = text(v, 100); if (!/^[\w.:-]{1,100}$/.test(s)) fail('INVALID_ID'); return s; };
const time = v => { if (!Number.isFinite(v) || v < 0) fail('INVALID_TIME'); return v; };
const spec = v => typeof v === 'string' && v ? text(v, 100) : 'unknown';
export function sourceSnapshot(s = {}) {
  return { id: id(s.id), kind: text(s.kind, 30), title: text(s.title, 120), version: text(s.version, 100), deviceId: text(s.deviceId, 100) };
}
export function createSession({ id: sessionId, title = '', spec: version, at, source = null }) {
  return { schema: SESSION_SCHEMA, id: id(sessionId), title: text(title, 120), spec: spec(version), createdAt: time(at), updatedAt: at,
    status: 'active', source: source ? sourceSnapshot(source) : null, events: [], evidence: [], checkpoints: [], deletionIndex: { attachmentIds: [], qualityFeedbackIds: [], evaluationSampleIds: [] } };
}
export function migrateSession(value) {
  if (!value || (value.schema && value.schema !== SESSION_SCHEMA)) fail('UNKNOWN_SESSION_SCHEMA');
  const out = createSession(value);
  // 旧快照只迁移安全元数据，不导入任意旧执行或媒体对象。
  return { ...out, status: 'paused', migration: value.schema ? 'metadata-only' : 'legacy-metadata-only' };
}
const check = s => { if (s?.schema !== SESSION_SCHEMA) fail('UNKNOWN_SESSION_SCHEMA'); if (s.status === 'deleted') fail('SESSION_DELETED'); };
export function appendSessionEvent(s, { id: eventId, type, at, requestId = '', sourceVersion = '', summary = '' }) {
  check(s);
  if (!['message', 'answer', 'source_changed', 'authorization_granted', 'authorization_revoked', 'stopped', 'completed', 'error', 'audio'].includes(type)) fail('INVALID_EVENT_TYPE');
  if (s.events.some(e => e.id === eventId)) fail('DUPLICATE_EVENT');
  const event = { id: id(eventId), type, at: time(at), requestId: text(requestId, 100), sourceVersion: text(sourceVersion, 100), summary: text(summary, 1000), spec: s.spec };
  return { ...s, updatedAt: at, status: type === 'completed' ? 'completed' : ['stopped', 'authorization_revoked'].includes(type) ? 'paused' : s.status, events: [...s.events, event] };
}
export function addSessionEvidence(s, { id: evidenceId, eventId, kind, excerpt = '', sourceVersion = '', at }) {
  check(s);
  if (!['text', 'observation', 'reference'].includes(kind)) fail('RAW_MEDIA_NOT_PERSISTED');
  if (!s.events.some(e => e.id === eventId)) fail('EVENT_NOT_FOUND');
  if (s.evidence.some(e => e.id === evidenceId)) fail('DUPLICATE_EVIDENCE');
  return { ...s, updatedAt: time(at), evidence: [...s.evidence, { id: id(evidenceId), eventId: id(eventId), kind, excerpt: text(excerpt, 1000), sourceVersion: text(sourceVersion, 100), at }] };
}
export function createCheckpoint(s, { id: checkpointId, at, summary = '', nextStep = '' }) {
  check(s);
  if (s.checkpoints.some(c => c.id === checkpointId)) fail('DUPLICATE_CHECKPOINT');
  return { ...s, updatedAt: time(at), checkpoints: [...s.checkpoints, { id: id(checkpointId), at, summary: text(summary, 1000), nextStep: text(nextStep, 500), source: s.source ? sourceSnapshot(s.source) : null, eventCount: s.events.length }] };
}
// 仅提出续接建议；永远没有可重放的执行或持久授权。
export function planSessionResume(s, { source = null, deviceId = '' } = {}) {
  check(s);
  const old = s.checkpoints.at(-1)?.source || s.source;
  const current = source ? sourceSnapshot(source) : null;
  const sourceChanged = !!old && (!current || old.id !== current.id || old.version !== current.version);
  const deviceChanged = !!old?.deviceId && old.deviceId !== deviceId;
  return { sessionId: s.id, checkpoint: s.checkpoints.at(-1) || null, sourceChanged, deviceChanged, requiresAuthorization: true, canExecute: false, replayActions: [] };
}
export function indexSessionDeletion(s, { attachmentIds = [], qualityFeedbackIds = [], evaluationSampleIds = [] } = {}) {
  check(s);
  const merge = (key, values) => [...new Set([...s.deletionIndex[key], ...values.map(id)])];
  return { ...s, deletionIndex: { attachmentIds: merge('attachmentIds', attachmentIds), qualityFeedbackIds: merge('qualityFeedbackIds', qualityFeedbackIds), evaluationSampleIds: merge('evaluationSampleIds', evaluationSampleIds) } };
}
export function deleteSession(s, at) {
  check(s);
  return { session: { schema: SESSION_SCHEMA, id: s.id, status: 'deleted', updatedAt: time(at) }, cleanup: { sessionId: s.id, ...s.deletionIndex, revokeAuthorization: true } };
}

// 私人反馈继续走原feedback同步；质量反馈必须先预览，再逐项确认。绝不自动遍历/搬运feedback。
export const QUALITY_FIELDS = Object.freeze(['rating', 'reason', 'note', 'excerpt', 'context', 'sourceTitles']);
export function createQualityPreview({ id: previewId, feedback, fields = [], sessionId = '', at }) {
  if (!feedback || !Array.isArray(fields) || fields.some(k => !QUALITY_FIELDS.includes(k))) fail('INVALID_SHARED_FIELD');
  const material = {};
  for (const key of [...new Set(fields)]) {
    if (key === 'sourceTitles') material[key] = (Array.isArray(feedback.src) ? feedback.src : []).slice(0, 8).map(s => text(s, 120));
    else if (key === 'rating') { if (!['up', 'down'].includes(feedback.rating)) fail('INVALID_RATING'); material.rating = feedback.rating; }
    else material[key] = text(feedback[key], key === 'excerpt' ? 1000 : 600);
  }
  return { schema: QUALITY_SCHEMA, id: id(previewId), sessionId: sessionId ? id(sessionId) : '', spec: spec(feedback.spec), at: time(at), fields: Object.keys(material), material };
}
export function authorizeQualityFeedback(preview, { confirmed = false, fields = [], previewId } = {}) {
  if (preview?.schema !== QUALITY_SCHEMA || !confirmed || previewId !== preview.id) fail('QUALITY_CONSENT_REQUIRED');
  if (!Array.isArray(fields) || JSON.stringify([...new Set(fields)].sort()) !== JSON.stringify([...preview.fields].sort())) fail('QUALITY_CONSENT_MISMATCH');
  // 再按白名单构造，调用方给预览对象塞入的附件、Key、聊天历史均被丢弃。
  const safe = createQualityPreview({ id: preview.id, sessionId: preview.sessionId, at: preview.at, feedback: { ...preview.material, spec: preview.spec, src: preview.material.sourceTitles }, fields });
  return { ...safe, consent: { confirmed: true, previewId: safe.id, fields: safe.fields } };
}
