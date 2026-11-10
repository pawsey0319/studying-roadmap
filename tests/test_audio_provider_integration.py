"""Real HTTP cross-layer audio integration; FakeBackend is protocol-only, not model evidence."""
from __future__ import annotations

import base64
import io
import json
from pathlib import Path
import subprocess
import tempfile
import threading
import time
import unittest
import wave

import httpx
import uvicorn

from tools.media_service import Settings, create_app


ROOT = Path(__file__).resolve().parents[1]
PROVIDERS = ROOT / "src" / "ai" / "providers.js"
TOKEN = "integration-only-" + "a" * 32
ORIGIN = "http://localhost:8000"


def wav_bytes() -> bytes:
    stream = io.BytesIO()
    with wave.open(stream, "wb") as out:
        out.setparams((1, 2, 16000, 0, "NONE", "not compressed"))
        out.writeframes(b"\x00\x00" * 1600)
    return stream.getvalue()


class FakeBackend:
    """Shape-compatible backend only: no model and no ASR fallback."""

    def __init__(self, result):
        self.result = result
        self.audio_calls = 0
        self.asr_calls = 0
        self.prompts = []

    def understand(self, samples, prompt, max_tokens):
        self.audio_calls += 1
        self.prompts.append(prompt)
        return self.result

    def transcribe(self, samples):
        self.asr_calls += 1
        return "must never be called"


class AudioProviderHTTP(unittest.TestCase):
    def setUp(self):
        temporary = tempfile.TemporaryDirectory(prefix="audio-provider-integration-")
        self.addCleanup(temporary.cleanup)
        self.fixture = Path(temporary.name) / "audio.wav"
        self.fixture.write_bytes(wav_bytes())
        self.backend = FakeBackend({"text": "fake direct-audio answer", "finish_reason": "stop"})
        # audio_path is an existing directory to enable the route; it is not loaded.
        app = create_app(Settings(TOKEN, asr_path="", audio_path=str(ROOT), origins=(ORIGIN,)), self.backend)
        self.server = uvicorn.Server(uvicorn.Config(app, host="127.0.0.1", port=0, log_level="error", access_log=False))
        self.thread = threading.Thread(target=self.server.run, name="audio-integration-uvicorn", daemon=True)
        self.thread.start()
        self.addCleanup(self.stop_server)
        deadline = time.monotonic() + 10
        while not self.server.started and time.monotonic() < deadline:
            time.sleep(0.01)
        self.assertTrue(self.server.started, "temporary uvicorn did not start")
        sockets = self.server.servers
        self.assertTrue(sockets and sockets[0].sockets)
        self.port = sockets[0].sockets[0].getsockname()[1]
        self.base = f"http://127.0.0.1:{self.port}"
        self.client = httpx.Client(timeout=10)
        self.addCleanup(self.client.close)

    def stop_server(self):
        self.server.should_exit = True
        self.thread.join(timeout=10)
        self.assertFalse(self.thread.is_alive(), "temporary uvicorn did not stop within bound")

    def request_body(self):
        return {
            "model": "local-audio",
            "messages": [{"role": "user", "content": [
                {"type": "text", "text": "Describe this sound"},
                {"type": "input_audio", "input_audio": {
                    "format": "wav", "data": base64.b64encode(wav_bytes()).decode("ascii")
                }},
            ]}],
            "max_tokens": 128,
        }

    def run_node(self, locale="zh", **config_overrides):
        script = r"""
import { readFile } from 'node:fs/promises';
const locale = process.argv[5];
Object.defineProperty(globalThis, 'navigator', {value:{language:locale === 'en' ? 'en-US' : 'zh-CN'}, configurable:true});
globalThis.localStorage = {getItem: () => locale};
const { understandAudio } = await import(process.argv[1]);
const wav = await readFile(process.argv[4]);
try {
  const result = await understandAudio(
    {provider:'custom', audioBase:process.argv[2] + '/v1', audioModel:'local-audio', audioKey:process.argv[3], ...JSON.parse(process.argv[6])},
    new Blob([wav], {type:'audio/wav'}), {durationMs:100, maxTokens:128}
  );
  console.log(JSON.stringify({ok:true, result}));
} catch (e) { console.log(JSON.stringify({ok:false, error:String(e?.message || e)})); }
"""
        proc = subprocess.run(
            ["node", "--input-type=module", "-e", script, str(PROVIDERS),
             self.base, TOKEN, str(self.fixture), locale, json.dumps(config_overrides)],
            cwd=ROOT, capture_output=True, text=True, timeout=15, check=False,
        )
        if proc.returncode:
            # Do not include child output: configuration contains a credential.
            raise AssertionError(f"Node provider exited with status {proc.returncode}")
        return json.loads(proc.stdout.strip())

    @staticmethod
    def prompt_chars(prompt):
        # Match JavaScript String.length even if a future rule contains astral characters.
        return len(prompt.encode("utf-16-le")) // 2

    def test_node_stop_uses_real_http_ffmpeg_and_never_asr(self):
        result = self.run_node()
        self.assertTrue(result["ok"], result)
        self.assertEqual(result["result"]["text"], "fake direct-audio answer")
        self.assertEqual(result["result"]["completion"]["finishReason"], "stop")
        self.assertEqual(self.backend.audio_calls, 1)
        self.assertEqual(self.backend.asr_calls, 0)

    def test_node_length_with_nonempty_text_is_rejected(self):
        self.backend.result = {"text": "partial", "finish_reason": "length"}
        result = self.run_node()
        self.assertFalse(result["ok"])
        self.assertIn("不完整", result["error"])

    def test_node_refusal_rejected_without_backend_text(self):
        self.backend.result = {"text": "backend private answer", "refusal": "private refusal", "finish_reason": "content_filter"}
        result = self.run_node()
        self.assertFalse(result["ok"])
        self.assertEqual(result["error"], "音频模型拒绝回答本次请求；不会自动转写")
        self.assertNotIn("private", result["error"])

    def test_english_locale_keeps_one_user_message_and_adds_language_rule(self):
        result = self.run_node(locale="en")
        self.assertTrue(result["ok"], result)
        self.assertEqual(self.backend.audio_calls, 1)
        self.assertEqual(self.backend.asr_calls, 0)
        # The real service rejects anything other than one user message with audio.
        self.assertIn("The user reads this site in English", self.backend.prompts[0])

    def test_english_language_rule_counts_toward_full_prompt_budget(self):
        chinese = self.run_node()
        self.assertTrue(chinese["ok"], chinese)
        chinese_chars = self.prompt_chars(self.backend.prompts[-1])
        english = self.run_node(locale="en")
        self.assertTrue(english["ok"], english)
        english_chars = self.prompt_chars(self.backend.prompts[-1])
        self.assertGreater(english_chars, chinese_chars)
        self.assertEqual(self.backend.audio_calls, 2)
        self.assertEqual(self.backend.asr_calls, 0)

        # Derive the budget from actual provider output, not copied language rules.
        self.backend.audio_calls = 0
        self.backend.prompts.clear()
        allowed = self.run_node(audioContextChars=chinese_chars)
        self.assertTrue(allowed["ok"], allowed)
        self.assertEqual(self.backend.audio_calls, 1)
        self.assertEqual(self.backend.asr_calls, 0)
        self.backend.audio_calls = 0
        self.backend.prompts.clear()
        rejected = self.run_node(locale="en", audioContextChars=chinese_chars)
        self.assertFalse(rejected["ok"], rejected)
        self.assertIn("音频完整提示超过", rejected["error"])
        self.assertIn("未截断或发送", rejected["error"])
        self.assertEqual(self.backend.audio_calls, 0)
        self.assertEqual(self.backend.asr_calls, 0)
        self.assertEqual(self.backend.prompts, [])

    def test_english_full_prompt_budget_exact_boundary(self):
        reference = self.run_node(locale="en")
        self.assertTrue(reference["ok"], reference)
        prompt = self.backend.prompts[-1]
        full_chars = self.prompt_chars(prompt)
        self.assertEqual(self.backend.audio_calls, 1)
        self.assertEqual(self.backend.asr_calls, 0)

        self.backend.audio_calls = 0
        self.backend.prompts.clear()
        allowed = self.run_node(locale="en", audioContextChars=full_chars)
        self.assertTrue(allowed["ok"], allowed)
        self.assertEqual(self.backend.audio_calls, 1)
        self.assertEqual(self.backend.asr_calls, 0)
        self.assertEqual(self.backend.prompts, [prompt])

        self.backend.audio_calls = 0
        self.backend.prompts.clear()
        rejected = self.run_node(locale="en", audioContextChars=full_chars - 1)
        self.assertFalse(rejected["ok"], rejected)
        self.assertIn("音频完整提示超过", rejected["error"])
        self.assertIn("未截断或发送", rejected["error"])
        self.assertEqual(self.backend.audio_calls, 0)
        self.assertEqual(self.backend.asr_calls, 0)
        self.assertEqual(self.backend.prompts, [])

    def test_unknown_reason_is_compatible_null(self):
        self.backend.result = {"text": "legacy answer"}
        result = self.run_node()
        self.assertTrue(result["ok"], result)
        self.assertIsNone(result["result"]["completion"]["finishReason"])

    def test_missing_token_and_wrong_origin_are_rejected_by_real_http(self):
        payload = self.request_body()
        missing = self.client.post(self.base + "/v1/chat/completions", json=payload, headers={"Origin": ORIGIN})
        self.assertEqual(missing.status_code, 401)
        wrong_origin = self.client.post(self.base + "/v1/chat/completions", json=payload,
                                        headers={"Authorization": "Bearer " + TOKEN, "Origin": "http://evil.example"})
        self.assertEqual(wrong_origin.status_code, 403)


if __name__ == "__main__":
    unittest.main()
