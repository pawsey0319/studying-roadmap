import test from 'node:test';
import assert from 'node:assert/strict';
import { audioCapabilities } from '../src/ai/capabilities.js';
import { understandAudio, transcribe, MAX_AUDIO_BYTES } from '../src/ai/providers.js';

const cfg = { provider: 'hosted', base: 'https://hosted.invalid', key: 'hosted-secret', audioBase: 'https://audio.test/v1/', audioModel: 'audio-model', audioKey: 'audio-secret', endpoint: () => { throw new Error('不得调用 hosted'); } };
const wav = () => new Blob([new Uint8Array([82, 73, 70, 70, 0, 255, 128, 1])], { type: 'audio/wav' });
function mockFetch(t, fn) { const old = globalThis.fetch; globalThis.fetch = fn; t.after(() => { globalThis.fetch = old; }); }
const reply = (extra = {}) => new Response(JSON.stringify({ choices: [{ message: { content: '听出了疑问' } }], ...extra }), { headers: { 'content-type': 'application/json' } });

test('能力区分转写和直听，不假定 hosted 或普通聊天配置已支持音频', () => {
  const cap = audioCapabilities({ provider: 'hosted', base: 'https://hosted.invalid', key: 'secret', model: 'text' });
  assert.equal(cap.dictation.supported, false);
  assert.equal(cap.directAudio.supported, false);
  const direct = audioCapabilities(cfg).directAudio;
  assert.equal(direct.supported, true);
  assert.equal(direct.verified, false);
  assert.deepEqual(direct.formats, ['wav', 'mp3']);
  assert.equal(audioCapabilities({ provider: 'custom', base: 'https://custom.test' }).dictation.supported, true);
  assert.equal(audioCapabilities({ provider: 'hosted', sttBase: 'https://stt.test' }).dictation.supported, true);
});

test('直听真实 WAV 字节通过 input_audio 发往独立 custom 配置，并返回 usage', async t => {
  const controller = new AbortController();
  let calls = 0;
  mockFetch(t, async (url, init) => {
    calls++;
    assert.equal(url, 'https://audio.test/v1/chat/completions');
    assert.equal(init.signal, controller.signal);
    assert.equal(init.headers.authorization, 'Bearer audio-secret');
    const body = JSON.parse(init.body);
    assert.equal(body.model, 'audio-model');
    assert.equal(body.stream, true);
    const parts = body.messages.at(-1).content;
    assert.match(parts[0].text, /上一轮问题/);
    assert.equal(parts[1].type, 'input_audio');
    assert.equal(parts[1].input_audio.format, 'wav');
    assert.deepEqual(Buffer.from(parts[1].input_audio.data, 'base64'), Buffer.from([82, 73, 70, 70, 0, 255, 128, 1]));
    assert.ok(!init.body.includes('hosted-secret'));
    return reply({ usage: { prompt_tokens: 123, completion_tokens: 9 } });
  });
  const deltas = [];
  const result = await understandAudio(cfg, wav(), { signal: controller.signal, context: '上一轮问题', onDelta: x => deltas.push(x) });
  assert.deepEqual(result, { text: '听出了疑问', usage: { in: 123, out: 9 }, estimated: false, completion: { finishReason: null, refusal: null } });
  assert.deepEqual(deltas, ['听出了疑问']);
  assert.equal(calls, 1, '不先转写');
});

test('直听空回答明确失败，不写空消息或降级', async t => {
  mockFetch(t, async () => reply({ choices: [{ message: { content: '' } }] }));
  await assert.rejects(understandAudio(cfg, wav()), /没有返回文字回答/);
});

test('MP3 以 mp3 模式发送，缺省 audioKey 也绝不继承 hosted Key', async t => {
  mockFetch(t, async (url, init) => {
    assert.equal(init.headers.authorization, undefined);
    const part = JSON.parse(init.body).messages.at(-1).content[1];
    assert.equal(part.input_audio.format, 'mp3');
    assert.equal(part.input_audio.data, 'AQID');
    return reply();
  });
  const result = await understandAudio({ ...cfg, audioKey: '' }, new Blob([new Uint8Array([1, 2, 3])], { type: 'audio/mpeg' }));
  assert.equal(result.estimated, true);
});

test('直听拒绝 WebM/未知格式、空音频、超限、缺配置和非字符串上下文，均不发请求', async t => {
  mockFetch(t, () => { assert.fail('校验失败不能发网络请求'); });
  await assert.rejects(understandAudio(cfg, new Blob(['webm'], { type: 'audio/webm;codecs=opus' })), /不支持 WebM/);
  await assert.rejects(understandAudio(cfg, new Blob(['?'])), /仅支持 WAV\/MP3/);
  await assert.rejects(understandAudio(cfg, new Blob([], { type: 'audio/wav' })), /不能为空/);
  const huge = { size: MAX_AUDIO_BYTES + 1, arrayBuffer() { assert.fail('不能读取超限文件'); } };
  await assert.rejects(understandAudio(cfg, huge), /25 MiB/);
  await assert.rejects(understandAudio({ provider: 'hosted', base: 'https://wrong', model: 'text' }, wav()), /独立配置/);
  await assert.rejects(understandAudio(cfg, wav(), { context: [] }), /必须是字符串/);
});

test('直听 HTTP/网络失败不降级到转写；支持预取消和 fetch AbortError', async t => {
  let calls = 0;
  mockFetch(t, async () => { calls++; return new Response('{"error":{"message":"audio unsupported"}}', { status: 400 }); });
  await assert.rejects(understandAudio(cfg, wav()), /audio unsupported/);
  assert.equal(calls, 1);
  globalThis.fetch = async () => { throw new Error('offline'); };
  await assert.rejects(understandAudio(cfg, wav()), /连不上/);
  const controller = new AbortController(); controller.abort();
  globalThis.fetch = () => { assert.fail('预取消不发请求'); };
  await assert.rejects(understandAudio(cfg, wav(), { signal: controller.signal }), { name: 'AbortError' });
  const abort = new DOMException('cancelled', 'AbortError');
  globalThis.fetch = async () => { throw abort; };
  await assert.rejects(understandAudio(cfg, wav()), e => e === abort);
});

test('转写发送原始音频 FormData、signal 和模型，返回非空文字', async t => {
  const controller = new AbortController();
  mockFetch(t, async (url, init) => {
    assert.equal(url, 'https://stt.test/v1/audio/transcriptions');
    assert.equal(init.signal, controller.signal);
    assert.equal(init.headers.authorization, 'Bearer stt-only');
    assert.equal(init.body.get('model'), 'whisper-1');
    assert.deepEqual(Buffer.from(await init.body.get('file').arrayBuffer()), Buffer.from(await wav().arrayBuffer()));
    return new Response('{"text":"  测试转写  "}');
  });
  assert.equal(await transcribe({ provider: 'hosted', sttBase: 'https://stt.test/v1', sttKey: 'stt-only' }, wav(), { signal: controller.signal }), '测试转写');
});

test('转写拒绝 hosted 配置继承、空文件、超限、空结果和 HTTP 失败', async t => {
  mockFetch(t, () => { assert.fail('校验失败不发请求'); });
  await assert.rejects(transcribe(cfg, wav()), /接口地址/);
  await assert.rejects(transcribe(cfg, new Blob()), /不能为空/);
  await assert.rejects(transcribe(cfg, { size: MAX_AUDIO_BYTES + 1, arrayBuffer() {} }), /25 MiB/);
  const stt = { provider: 'custom', sttBase: 'https://stt.test' };
  globalThis.fetch = async () => new Response('{"text":"  "}');
  await assert.rejects(transcribe(stt, wav()), /没有听清/);
  globalThis.fetch = async () => new Response('{"error":{"message":"bad format"}}', { status: 415 });
  await assert.rejects(transcribe(stt, wav()), /415.*bad format/);
});

test('转写保留预取消、fetch取消、读取响应取消的 AbortError', async t => {
  const stt = { provider: 'custom', sttBase: 'https://stt.test' };
  mockFetch(t, () => { assert.fail('预取消不发请求'); });
  const controller = new AbortController(); controller.abort();
  await assert.rejects(transcribe(stt, wav(), { signal: controller.signal }), { name: 'AbortError' });
  const abort = new DOMException('cancelled', 'AbortError');
  globalThis.fetch = async () => { throw abort; };
  await assert.rejects(transcribe(stt, wav()), e => e === abort);
  globalThis.fetch = async () => ({ ok: true, json: async () => { throw abort; } });
  await assert.rejects(transcribe(stt, wav()), e => e === abort);
});
