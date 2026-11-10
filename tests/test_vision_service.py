"""FakeBackend contract tests, not real model quality evidence."""
import base64
from io import BytesIO
from pathlib import Path
import tempfile
import unittest
from types import SimpleNamespace
from PIL import Image
from fastapi.testclient import TestClient
from tools.media_service import Settings
from tools.vision_service import create_app, LocalVision
from unittest.mock import patch
import sys


class VisionContract(unittest.TestCase):
    def setUp(self):
        self.tmp = tempfile.TemporaryDirectory()
        self.addCleanup(self.tmp.cleanup)
        self.calls = []
        class FakeBackend:
            def generate(inner, raw, prompt, tokens):
                self.calls.append((raw, prompt, tokens))
                return self.result
        self.result = 'FAKE_CONTRACT_RESULT'
        self.client = TestClient(create_app(Settings(token='x' * 32), self.tmp.name, FakeBackend()))
        self.headers = {'Authorization': 'Bearer ' + 'x' * 32}
        b = BytesIO(); Image.new('RGB', (10, 10)).save(b, format='PNG')
        self.url = 'data:image/png;base64,' + base64.b64encode(b.getvalue()).decode()

    def request(self, url=None, **extra):
        return self.client.post('/v1/chat/completions', headers=self.headers, json={
            'model': 'local-vision', 'messages': [{'role': 'user', 'content': [
                {'type': 'text', 'text': 'read'}, {'type': 'image_url', 'image_url': {'url': url or self.url}}]}], **extra})

    def test_local_adapter_preserves_native_result_without_model_load(self):
        native = SimpleNamespace(text='原样文本', finish_reason='length', generation_tokens=128)
        calls = []
        def generate(*args, **kwargs):
            calls.append(kwargs)
            return native
        modules = {
            'mlx_vlm': SimpleNamespace(load=lambda _: self.fail('must not load model'), generate=generate),
            'mlx_vlm.prompt_utils': SimpleNamespace(apply_chat_template=lambda *args, **kwargs: 'formatted'),
            'mlx_vlm.utils': SimpleNamespace(load_config=lambda _: {}),
        }
        backend = LocalVision(self.tmp.name)
        backend.loaded = (object(), object())
        b = BytesIO(); Image.new('RGB', (1, 1)).save(b, format='PNG')
        with patch.dict(sys.modules, modules):
            result = backend.generate(b.getvalue(), 'read', 128)
        self.assertIs(result, native)
        self.assertEqual(calls[0]['max_tokens'], 128)

    def test_auth_cors(self):
        self.assertEqual(self.client.get('/health').status_code, 401)
        self.assertEqual(self.client.get('/health', headers={**self.headers, 'Origin': 'https://bad.example'}).status_code, 403)
        self.assertEqual(self.client.get('/health', headers=self.headers).json()['models']['vision'], 'local-vision')

    def test_real_shape_contract_fake_backend(self):
        self.assertEqual(self.request().json()['choices'][0]['message']['content'], 'FAKE_CONTRACT_RESULT')
        self.assertEqual(len(self.calls), 1)

    def test_reported_stop_at_budget_is_not_inferred_as_length(self):
        self.result = SimpleNamespace(text='EOS at limit', finish_reason='stop',
                                      prompt_tokens=20, generation_tokens=512, total_tokens=532)
        body = self.request(max_tokens=512).json()
        self.assertEqual(body['choices'][0]['finish_reason'], 'stop')
        self.assertEqual(body['usage'], {'prompt_tokens': 20, 'completion_tokens': 512, 'total_tokens': 532})

    def test_reported_length_preserved(self):
        self.result = SimpleNamespace(text='partial', finish_reason='length', generation_tokens=128)
        body = self.request().json()
        self.assertEqual(body['choices'][0]['finish_reason'], 'length')
        self.assertEqual(body['usage'], {'completion_tokens': 128})

    def test_missing_metadata_is_unknown_and_invalid_counts_rejected(self):
        body = self.request().json()
        self.assertIsNone(body['choices'][0]['finish_reason'])
        self.assertEqual(body['usage'], {})
        self.result = SimpleNamespace(text='answer', finish_reason='made-up',
                                      prompt_tokens=True, generation_tokens=-1, total_tokens=1.5)
        body = self.request().json()
        self.assertIsNone(body['choices'][0]['finish_reason'])
        self.assertEqual(body['usage'], {})

    def test_no_remote_or_bad_base64(self):
        self.assertEqual(self.request('https://example.com/picture.png').status_code, 400)
        self.assertEqual(self.request('data:image/png;base64,???').status_code, 400)
        self.assertEqual(self.request('data:image/png;base64,' + base64.b64encode(b'bad').decode()).status_code, 400)
        self.assertEqual(self.calls, [])

    def test_limits_and_schema(self):
        self.assertEqual(self.request(max_tokens=513).status_code, 400)
        self.assertEqual(self.request(max_tokens=True).status_code, 400)
        self.assertEqual(self.client.post('/v1/chat/completions', headers=self.headers, json=[]).status_code, 400)
        self.assertEqual(self.client.post('/v1/chat/completions', headers=self.headers, json={'model': 'other'}).status_code, 400)


if __name__ == '__main__':
    unittest.main()
