import { createSession, appendSessionEvent, createCheckpoint } from './learning-session.js';
import { hash } from './ids.js';

// Convert chat metadata to a reviewable learning record. Never copies image/audio bytes or tool actions.
export function updateSessionLog(previous, { id, title, topic, messages, spec, at = Date.now() }) {
  let s = previous?.status !== 'deleted' && previous ? previous : createSession({ id, title, spec, at });
  s = { ...s, title: String(title || '').slice(0,120), topic: { kind: String(topic.kind || 'free'), id: String(topic.id || '') } };
  const known = new Set(s.events.map(e => e.id));
  for (const [i, m] of messages.entries()) {
    if (!['user','assistant'].includes(m.role)) continue;
    const eventId = `m${Number(m.ts) || 0}-${hash(m.role + ':' + String(m.show || m.content || ''))}`;
    if (known.has(eventId)) continue;
    s = appendSessionEvent(s, { id: eventId, type: m.role === 'assistant' ? 'answer' : m.inputMode === 'direct_audio' ? 'audio' : 'message', at: Number(m.ts) || at,
      summary: m.inputMode === 'direct_audio' ? '用户发送一段音频（未保存原声）' : String(m.show || m.content || '').slice(0,1000) });
    known.add(eventId);
  }
  const last = s.events.at(-1);
  if (last && s.checkpoints.at(-1)?.eventCount !== s.events.length) {
    s = createCheckpoint(s, { id: `c${s.events.length}-${at}`, at, summary: last.summary, nextStep: '继续提问或复做；任务完成不代表已经掌握，来源需重新授权。' });
    s = { ...s, checkpoints: s.checkpoints.slice(-100) };
  }
  return s;
}
