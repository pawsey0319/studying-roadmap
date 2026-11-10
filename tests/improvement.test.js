import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile, mkdtemp, writeFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createServer } from 'node:http';
import { parseArgs, parseFeedbackJSONL, validateFeedback, validateCases, validateSuggestion, validateEndpoint, run, LIMITS } from '../tools/agent_improvement.mjs';

const suite = JSON.parse(await readFile(new URL('../eval/agent-eval-cases.json', import.meta.url), 'utf8'));
const feedback = () => ({ schema: 'lh-quality-feedback/1', id: 'feedback-1', sessionId: '', spec: 'unknown', at: 1, fields: ['reason'], material: { reason: '来源过期却仍引用旧位置' }, consent: { confirmed: true, previewId: 'feedback-1', fields: ['reason'] }, redaction: { reviewed: true, method: 'manual' } });
const suggestion = () => ({ schema: 'lh-agent-suggestions/1', summary: '建议重新验证来源版本', proposals: [{ title: '校验来源', rationale: '反馈发现陈旧引用', kind: 'policy', description: '回答前重新校验版本，失败则明确暂停。', risks: ['可能增加延迟'], evidenceIds: ['feedback-1'], evalCaseIds: ['stale-source-version'] }] });
async function fixture() { const dir = await mkdtemp(join(tmpdir(), 'lh-improvement-')); const input = join(dir, 'authorized.jsonl'); await writeFile(input, JSON.stringify(feedback()) + '\n'); return { dir, input }; }
async function server(handler, fn) { const s = createServer(handler); await new Promise(r => s.listen(0, '127.0.0.1', r)); try { await fn(`http://127.0.0.1:${s.address().port}/v1/chat/completions`); } finally { await new Promise(r => { s.close(r); s.closeAllConnections(); }); } }

test('CLI defaults to offline dry run even with endpoint; explicit opt-in required', () => {
  assert.equal(parseArgs(['--input', 'x', '--out', 'y', '--endpoint', 'http://localhost:1']).dryRun, true);
  assert.throws(() => parseArgs(['--input', 'x', '--out', 'y', '--invoke-model']), /EXPLICIT_MODEL_ENDPOINT_REQUIRED/);
  assert.throws(() => parseArgs(['--input', 'x', '--out', 'y', '--timeout-ms', '60000']), /TIMEOUT_LIMIT/);
  assert.throws(() => parseArgs(['--input', 'x', '--out', 'y', '--approve']), /INVALID_ARGUMENT/);
});
test('quality schema and explicit consent mandatory; no private migration', () => {
  assert.equal(validateFeedback(feedback()).spec, 'unknown');
  for (const changes of [{ schema: 'private-feedback' }, { consent: { confirmed: false } }, { consent: { confirmed: true, previewId: 'other', fields: ['reason'] } }, { redaction: undefined }, { sessionId: undefined }, { material: { reason: 'ok', chat: 'secret' } }, { fields: ['excerpt'] }]) {
    assert.throws(() => validateFeedback({ ...feedback(), ...changes }));
  }
});
test('redaction declaration is required and obvious identifiers/secrets rejected', () => {
  for (const reason of ['a@example.com', 'Bearer secretsecretsecret', '-----BEGIN RSA PRIVATE KEY-----']) {
    const f = feedback(); f.material.reason = reason; assert.throws(() => validateFeedback(f), /POSSIBLE_SECRET_OR_IDENTIFIER/);
  }
});
test('JSONL has byte, count, duplicate and strict text limits', () => {
  assert.throws(() => parseFeedbackJSONL('{bad}\n'), /INVALID_JSONL/);
  assert.throws(() => parseFeedbackJSONL(''), /RECORD_LIMIT/);
  assert.throws(() => parseFeedbackJSONL(' '.repeat(LIMITS.inputBytes + 1)), /INPUT_LIMIT/);
  assert.throws(() => parseFeedbackJSONL([feedback(), feedback()].map(JSON.stringify).join('\n')), /DUPLICATE_FEEDBACK_ID/);
  assert.throws(() => parseFeedbackJSONL(Array.from({ length: 201 }, () => '{}').join('\n')), /RECORD_LIMIT/);
});
test('fixed eval covers at least twelve scenarios and critical contracts', () => {
  assert.equal(validateCases(suite), suite); assert.ok(suite.cases.length >= 12);
  for (const category of ['permission', 'stale_source', 'mastery', 'voice_direct', 'voice_dictation', 'privacy', 'injection', 'evaluation']) assert.ok(suite.cases.some(c => c.category === category));
  assert.throws(() => validateCases({ ...suite, cases: suite.cases.slice(0, 2) }));
});
test('model output must be JSON suggestions, no patch/shell/tool/self-score/approval fields', () => {
  assert.equal(validateSuggestion(suggestion(), [feedback()], suite).proposals.length, 1);
  for (const field of ['shell', 'patch', 'tools', 'passed', 'score', 'approve', 'deploy', 'url']) {
    assert.throws(() => validateSuggestion({ ...suggestion(), [field]: 'bad' }, [feedback()], suite));
    const value = suggestion(); value.proposals[0][field] = 'bad'; assert.throws(() => validateSuggestion(value, [feedback()], suite));
  }
  const forged = suggestion(); forged.proposals[0].evidenceIds = ['unknown']; assert.throws(() => validateSuggestion(forged, [feedback()], suite));
});
test('endpoint permits local HTTP or explicit HTTPS but rejects auth/query/fragment/nonlocal HTTP', () => {
  assert.equal(validateEndpoint('http://localhost:1234/v1/chat/completions'), 'http://localhost:1234/v1/chat/completions');
  assert.equal(validateEndpoint('https://model.example/v1/chat/completions'), 'https://model.example/v1/chat/completions');
  for (const url of ['http://model.example/x', 'file:///etc/passwd', 'https://key:secret@model.example/x', 'https://model.example/x?token=secret', 'https://model.example/#x']) assert.throws(() => validateEndpoint(url));
});
test('offline run never fetches; keeps behavioral unrun/null and fingerprints without raw material', async () => {
  const { dir, input } = await fixture(); const old = globalThis.fetch; globalThis.fetch = () => { throw new Error('network must not run'); };
  try {
    const result = await run({ ...parseArgs(['--input', input, '--out', join(dir, 'out')]), endpoint: 'https://unused.example/' });
    assert.equal(result.manifest.structural.passed, true); assert.equal(result.manifest.behavioral.passed, null); assert.equal(result.manifest.passed, null); assert.equal(result.manifest.releaseEligible, false);
    assert.ok(result.manifest.behavioral.cases.every(c => c.passed === null)); assert.equal(result.candidate.model, null); assert.equal(result.candidate.specVersions[0], 'unknown');
    const artifact = await readFile(join(result.directory, 'input-fingerprint.json'), 'utf8'); assert.match(artifact, /sha256/); assert.ok(!artifact.includes(feedback().material.reason));
  } finally { globalThis.fetch = old; }
});
test('explicit local model request has no tools and returns data-only candidate, not behavioral pass', async () => {
  const { dir, input } = await fixture(); let sent;
  await server(async (req, res) => { let body = ''; for await (const part of req) body += part; sent = JSON.parse(body); res.setHeader('Content-Type', 'application/json'); res.end(JSON.stringify({ choices: [{ message: { content: JSON.stringify(suggestion()) } }] })); }, async endpoint => {
    const result = await run(parseArgs(['--input', input, '--out', join(dir, 'out'), '--invoke-model', '--endpoint', endpoint, '--model', 'local-test']));
    assert.equal(sent.tools, undefined); assert.equal(sent.messages.length, 2); assert.ok(!sent.messages[1].content.includes('sessionId')); assert.equal(result.candidate.state, 'candidate'); assert.equal(result.manifest.behavioral.status, 'not_run'); assert.equal(result.manifest.passed, null);
  });
});
test('model tool calls, self-grading, invalid JSON and HTTP redirects fail closed', async () => {
  const { dir, input } = await fixture();
  for (const message of [{ content: 'not JSON' }, { content: JSON.stringify({ ...suggestion(), passed: true }) }, { content: JSON.stringify(suggestion()), tool_calls: [{ function: { name: 'shell' } }] }]) {
    await server((req, res) => res.end(JSON.stringify({ choices: [{ message }] })), async endpoint => {
      await assert.rejects(run(parseArgs(['--input', input, '--out', join(dir, 'out'), '--invoke-model', '--endpoint', endpoint, '--model', 'test'])));
    });
  }
  await server((req, res) => { res.writeHead(302, { Location: 'https://not-followed.invalid' }); res.end(); }, async endpoint => {
    await assert.rejects(run(parseArgs(['--input', input, '--out', join(dir, 'out'), '--invoke-model', '--endpoint', endpoint, '--model', 'test'])));
  });
});
test('valid JSON from incomplete, filtered, tool or refused responses cannot become a candidate', async () => {
  const { dir, input } = await fixture();
  for (const finish of ['length', 'content_filter', 'tool_calls', 'unknown', 1]) {
    await server((req, res) => res.end(JSON.stringify({ choices: [{ finish_reason: finish, message: { content: JSON.stringify(suggestion()) } }] })), async endpoint => {
      await assert.rejects(run({ input, out: join(dir, 'out'), dryRun: false, endpoint, model: 'test' }), /MODEL_INCOMPLETE_RESPONSE/);
    });
  }
  await server((req, res) => res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(suggestion()), refusal: 'refused' } }] })), async endpoint => {
    await assert.rejects(run({ input, out: join(dir, 'out'), dryRun: false, endpoint, model: 'test' }), /MODEL_REFUSAL/);
  });
});
test('explicit stop permits structural candidate only, never behavioral or release pass', async () => {
  const { dir, input } = await fixture();
  await server((req, res) => res.end(JSON.stringify({ choices: [{ finish_reason: 'stop', message: { content: JSON.stringify(suggestion()) } }] })), async endpoint => {
    const result = await run({ input, out: join(dir, 'out'), dryRun: false, endpoint, model: 'test' });
    assert.equal(result.manifest.behavioral.passed, null);
    assert.equal(result.manifest.releaseEligible, false);
  });
});
test('exported run defaults offline and validates hard limits independently of CLI', async () => {
  const { dir, input } = await fixture();
  const old = globalThis.fetch; globalThis.fetch = () => { throw new Error('network forbidden'); };
  try {
    const result = await run({ input, out: join(dir, 'out') });
    assert.equal(result.candidate.model, null);
    await assert.rejects(run({ input, out: join(dir, 'out'), timeoutMs: 60000 }), /TIMEOUT_LIMIT/);
    await assert.rejects(run({ input, out: join(dir, 'out'), dryRun: false }), /EXPLICIT_MODEL_ENDPOINT_REQUIRED/);
    await assert.rejects(run({ input, out: join(dir, 'out'), dryRun: false, endpoint: 'http://localhost:1/x', model: 'test', tokenEnv: 'LH_TEST_NONEXISTENT_TOKEN_9191' }), /TOKEN_ENV_MISSING/);
  } finally { globalThis.fetch = old; }
});

test('timeout and response size bounded', async () => {
  const { dir, input } = await fixture();
  await server((req, res) => {}, async endpoint => { await assert.rejects(run(parseArgs(['--input', input, '--out', join(dir, 'out'), '--invoke-model', '--endpoint', endpoint, '--model', 'test', '--timeout-ms', '100']))); });
  await server((req, res) => res.end('x'.repeat(LIMITS.responseBytes + 1)), async endpoint => { await assert.rejects(run(parseArgs(['--input', input, '--out', join(dir, 'out'), '--invoke-model', '--endpoint', endpoint, '--model', 'test'])), /MODEL_RESPONSE_LIMIT/); });
});
