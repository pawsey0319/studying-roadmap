"""Contract/security tests use explicit fake backend; NOT real model evidence."""
import base64
import io
import unittest
import wave
from fastapi.testclient import TestClient
from tools.media_service import Settings, create_app, LocalModels, audio_completion
from types import SimpleNamespace
from unittest.mock import patch
from fastapi import HTTPException

TOKEN = 'unit-test-only-token-not-a-secret'


def wav(seconds=1):
    stream = io.BytesIO()
    with wave.open(stream, 'wb') as out:
        out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        out.writeframes(bytes(16000 * 2 * seconds))
    return stream.getvalue()


class FakeBackend:
    def __init__(self):
        self.asr_calls = 0
        self.audio_calls = 0

    def transcribe(self, samples):
        self.asr_calls += 1
        return 'contract fake'

    def understand(self, samples, prompt, max_tokens):
        self.audio_calls += 1
        return 'contract fake audio'


class MediaContract(unittest.TestCase):
    def setUp(self):
        self.backend = FakeBackend()
        self.client = TestClient(create_app(Settings(TOKEN, '.', '.'), self.backend))
        self.headers = {'Authorization': 'Bearer ' + TOKEN}

    def audio(self, **kw):
        body = {'model': 'local-audio', 'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': 'Describe sound'}, {'type': 'input_audio', 'input_audio': {'format': 'wav', 'data': base64.b64encode(wav()).decode()}}]}]}
        body.update(kw)
        return self.client.post('/v1/chat/completions', json=body, headers=self.headers)

    def test_auth_and_origin(self):
        self.assertEqual(self.client.get('/v1/models').status_code, 401)
        self.assertEqual(self.client.get('/v1/models', headers={**self.headers, 'Origin': 'https://evil.example'}).status_code, 403)
        response = self.client.options('/v1/models', headers={'Origin': 'http://localhost:8000'})
        self.assertEqual(response.headers['access-control-allow-origin'], 'http://localhost:8000')

    def test_transcription_contract(self):
        response = self.client.post('/v1/audio/transcriptions', data={'model': 'local-whisper'}, files={'file': ('voice.wav', wav(), 'audio/wav')}, headers=self.headers)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(response.json()['evidence']['audio_samples'], 16000)
        self.assertEqual(self.backend.asr_calls, 1)

    def test_direct_audio_never_calls_asr(self):
        response = self.audio(stream=True)
        self.assertEqual(response.status_code, 200, response.text)
        self.assertEqual(self.backend.asr_calls, 0)
        self.assertEqual(self.backend.audio_calls, 1)
        self.assertEqual(response.json()['evidence']['mode'], 'direct_audio')

    def test_legacy_string_has_unknown_metadata(self):
        body = self.audio().json()
        self.assertEqual(body['choices'][0]['message']['content'], 'contract fake audio')
        self.assertIsNone(body['choices'][0]['finish_reason'])
        self.assertEqual(body['usage'], {})

    def test_native_metadata_and_no_extra_fields(self):
        for reason in ('stop', 'length', 'content_filter', 'tool_calls'):
            native = SimpleNamespace(text=' partial answer ', finish_reason=reason,
                                     prompt_tokens=20, generation_tokens=128, total_tokens=148,
                                     extra='private', internal_prompt='secret')
            with self.subTest(reason=reason), patch.object(self.backend, 'understand', return_value=native):
                body = self.audio(max_tokens=128).json()
            self.assertEqual(body['choices'][0]['finish_reason'], reason)
            self.assertEqual(body['choices'][0]['message'], {'role': 'assistant', 'content': ' partial answer '})
            self.assertEqual(body['usage'], {'prompt_tokens': 20, 'completion_tokens': 128, 'total_tokens': 148})
            self.assertNotIn('secret', str(body))
            self.assertNotIn('private', str(body))

    def test_http_adapter_result_keeps_only_whitelisted_fields(self):
        result = {'text': 'answer', 'finish_reason': 'length',
                  'usage': {'prompt_tokens': 0, 'completion_tokens': 128, 'total_tokens': 128,
                            'extra': 'private'}, 'refusal': 'cannot comply', 'extra': 'private'}
        with patch.object(self.backend, 'understand', return_value=result):
            body = self.audio(max_tokens=128).json()
        self.assertEqual(body['choices'][0], {'index': 0, 'finish_reason': 'length',
                         'message': {'role': 'assistant', 'content': 'answer', 'refusal': 'cannot comply'}})
        self.assertEqual(body['usage'], {'prompt_tokens': 0, 'completion_tokens': 128, 'total_tokens': 128})
        self.assertNotIn('private', str(body))
        self.assertEqual(self.backend.asr_calls, 0)

    def test_unknown_reason_and_invalid_counts_are_not_inferred(self):
        for reason in (None, 'unknown', True, {'stop': True}):
            native = SimpleNamespace(text='answer', finish_reason=reason, prompt_tokens=True,
                                     generation_tokens=-1, total_tokens=1.5)
            with self.subTest(reason=reason), patch.object(self.backend, 'understand', return_value=native):
                body = self.audio(max_tokens=128).json()
            self.assertIsNone(body['choices'][0]['finish_reason'])
            self.assertEqual(body['usage'], {})
        native = SimpleNamespace(text='answer', generation_tokens=128)
        with patch.object(self.backend, 'understand', return_value=native):
            body = self.audio(max_tokens=128).json()
        self.assertIsNone(body['choices'][0]['finish_reason'])
        self.assertEqual(body['usage'], {'completion_tokens': 128})

    def test_empty_and_refusal_are_explicit(self):
        for result in ('', '  ', SimpleNamespace(text=None, finish_reason='stop'),
                       SimpleNamespace(text=['not text'])):
            with self.subTest(result=result), patch.object(self.backend, 'understand', return_value=result):
                self.assertEqual(self.audio().status_code, 502)
        for result in (SimpleNamespace(text=None, refusal='Not allowed', finish_reason='content_filter'),
                       SimpleNamespace(text='', finish_reason='length')):
            with self.subTest(result=result), patch.object(self.backend, 'understand', return_value=result):
                response = self.audio()
            self.assertEqual(response.status_code, 200)
            self.assertEqual(response.json()['choices'][0]['message']['content'], '')
        self.assertEqual(audio_completion({'text': '', 'refusal': 'x' * 5000})['refusal'], 'x' * 4096)
        with self.assertRaises(HTTPException):
            audio_completion({'text': None, 'refusal': {'internal': 'secret'}})
        self.assertEqual(self.backend.asr_calls, 0)

    def test_local_model_preserves_native_result_without_loading(self):
        native = SimpleNamespace(text='raw', finish_reason='length', generation_tokens=128)
        model = LocalModels(Settings(TOKEN))
        model.audio = SimpleNamespace(generate=lambda *args, **kwargs: native)
        self.assertIs(model.understand([.1], 'prompt', 128), native)

    def test_invalid_shapes(self):
        for body in [[], None, {'messages': [None], 'model': 'local-audio'}, {'messages': [{'role': 'user', 'content': [None]}], 'model': 'local-audio'}]:
            with self.subTest(body=body):
                response = self.client.post('/v1/chat/completions', json=body, headers=self.headers)
                self.assertEqual(response.status_code, 400)
        self.assertEqual(self.audio(max_tokens=10000).status_code, 400)

    def test_remote_url_rejected(self):
        response = self.audio(messages=[{'role': 'user', 'content': [{'type': 'audio_url', 'audio_url': {'url': 'http://127.0.0.1/private'}}]}])
        self.assertEqual(response.status_code, 400)
        self.assertEqual(self.backend.audio_calls, 0)

    def test_body_bound(self):
        client = TestClient(create_app(Settings(TOKEN, '.', '.', max_request_bytes=100), self.backend))
        self.assertEqual(client.post('/v1/chat/completions', content=b'x' * 101, headers=self.headers).status_code, 413)

    def test_duration_and_bad_media(self):
        for raw, expected in [(wav(61), 413), (b'invalid media', 400)]:
            response = self.client.post('/v1/audio/transcriptions', data={'model': 'local-whisper'}, files={'file': ('x.wav', raw)}, headers=self.headers)
            self.assertEqual(response.status_code, expected, response.text)

    def test_unconfigured_direct_fails_closed(self):
        client = TestClient(create_app(Settings(TOKEN, '.'), self.backend))
        response = client.post('/v1/chat/completions', json={}, headers=self.headers)
        self.assertEqual(response.status_code, 503)
        self.assertEqual(self.backend.asr_calls, 0)


if __name__ == '__main__':
    unittest.main()
