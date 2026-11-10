import test from 'node:test';
import assert from 'node:assert/strict';
import { chat, understandAudio } from '../src/ai/providers.js';

const cfg = { provider: 'custom', base: 'https://audio.test/v1', audioBase: 'https://audio.test/v1', audioModel: 'audio' };
const messages = [{ role: 'user', content: '问题' }];
const wav = () => new Blob(['RIFF'], { type: 'audio/wav' });
const usage = { prompt_tokens: 5, completion_tokens: 8 };
function mockFetch(t, response) {
  const old = globalThis.fetch;
  let calls = 0;
  globalThis.fetch = async url => { calls++; assert.match(url, /\/chat\/completions$/); return response(); };
  t.after(() => { globalThis.fetch = old; });
  return () => calls;
}
function response(kind, reason, refusal, { text = '回答', tail = false } = {}) {
  if (kind === 'JSON') return new Response(JSON.stringify({ choices: [{ message: { content: text, refusal }, finish_reason: reason }], usage }), { headers: { 'content-type': 'application/json' } });
  const lines = [
    'data: ' + JSON.stringify({ choices: [{ delta: { content: text } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { refusal: typeof refusal === 'string' ? refusal.slice(0, 2) : refusal } }] }),
    'data: ' + JSON.stringify({ choices: [{ delta: { refusal: typeof refusal === 'string' ? refusal.slice(2) : undefined }, finish_reason: reason }] }),
    'data: ' + JSON.stringify({ choices: [], usage })
  ];
  // 小块分割涵盖 UTF-8 与 JSON 跨 chunk；tail 让结束帧成为无换行的流尾。
  const encoded = new TextEncoder().encode(tail ? lines.slice(0, 3).join('\r\n') : lines.join('\r\n') + '\r\ndata: [DONE]\r\n');
  return new Response(new ReadableStream({ start(controller) { for (let i = 0; i < encoded.length; i += 7) controller.enqueue(encoded.slice(i, i + 7)); controller.close(); } }), { headers: { 'content-type': 'text/event-stream' } });
}

for (const kind of ['JSON', 'SSE']) {
  test(`${kind}: 普通 chat 默认返回形状完全不变，显式 false 同样兼容`, async t => {
    mockFetch(t, () => response(kind, 'length', '敏感拒绝'));
    for (const options of [{}, { captureCompletion: false }]) {
      assert.deepEqual(await chat(cfg, messages, options), { text: '回答', usage: { in: 5, out: 8 }, estimated: false });
    }
  });
  for (const reason of ['stop', 'length', 'content_filter', 'tool_calls', 'vendor_custom', ' ', null, undefined, '', 7]) {
    test(`${kind}: captureCompletion 保留 ${JSON.stringify(reason)} 且直听只接受 stop 或未知`, async t => {
      const calls = mockFetch(t, () => response(kind, reason));
      const completion = { finishReason: typeof reason === 'string' && reason.length ? reason : null, refusal: null };
      assert.deepEqual((await chat(cfg, messages, { captureCompletion: true })).completion, completion);
      if (completion.finishReason && completion.finishReason !== 'stop') {
        await assert.rejects(understandAudio(cfg, wav()), /回答不完整/);
      } else {
        const result = await understandAudio(cfg, wav(), { maxTokens: 8 });
        assert.deepEqual(result.completion, completion, '到达 token 预算仍不能推断结束原因');
      }
      assert.equal(calls(), 2, '不调用 ASR 或重试');
    });
  }
  for (const reason of ['stop', 'length', null]) {
    test(`${kind}: refusal 优先失败，不泄露长原文（reason=${reason}）`, async t => {
      const refusal = '私密内容'.repeat(10000);
      const calls = mockFetch(t, () => response(kind, reason, refusal, { text: '' }));
      assert.equal((await chat(cfg, messages, { captureCompletion: true })).completion.refusal, refusal);
      await assert.rejects(understandAudio(cfg, wav()), error => {
        assert.equal(error.message, '音频模型拒绝回答本次请求；不会自动转写');
        assert.ok(!error.message.includes('私密内容'));
        return true;
      });
      assert.equal(calls(), 2);
    });
  }
  test(`${kind}: 空 refusal 不当拒绝；非字符串 refusal 保持未知`, async t => {
    mockFetch(t, () => response(kind, 'stop', ''));
    assert.deepEqual((await understandAudio(cfg, wav())).completion, { finishReason: 'stop', refusal: null });
    globalThis.fetch = async () => response(kind, undefined, { private: true });
    assert.deepEqual((await understandAudio(cfg, wav())).completion, { finishReason: null, refusal: null });
  });
}

for (const reason of ['stop', 'length', 'tool_calls', null]) {
  test(`SSE: 无 content 的最后结束帧无换行也捕获 ${reason}`, async t => {
    mockFetch(t, () => response('SSE', reason, undefined, { tail: true }));
    const result = await chat(cfg, messages, { captureCompletion: true });
    assert.equal(result.text, '回答');
    assert.deepEqual(result.completion, { finishReason: reason, refusal: null });
  });
}
test('SSE: [DONE] 与 usage-only 帧不把未知覆盖为 stop，也不清除已知 reason', async t => {
  mockFetch(t, () => response('SSE', undefined));
  assert.deepEqual((await understandAudio(cfg, wav())).completion, { finishReason: null, refusal: null });
  globalThis.fetch = async () => response('SSE', 'length');
  await assert.rejects(understandAudio(cfg, wav()), /回答不完整/);
});
test('SSE: 无换行 refusal-only 尾帧也阻止成功', async t => {
  mockFetch(t, () => response('SSE', undefined, '拒绝原文', { tail: true }));
  await assert.rejects(understandAudio(cfg, wav()), /拒绝回答/);
});
