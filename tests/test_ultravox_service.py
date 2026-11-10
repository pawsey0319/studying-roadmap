"""Mock transport and real lightweight process cleanup; no model inference."""
import base64
import io
import os
import select
import signal
import subprocess
import sys
import time
import unittest
from unittest.mock import Mock, call, patch
import wave
import numpy as np
from fastapi import HTTPException
from tools.run_ultravox import UltravoxBackend, stop_child


class UltravoxTransport(unittest.TestCase):
    def test_waveform_is_sent_not_transcript(self):
        backend = UltravoxBackend('private-test-only-token')
        with patch('tools.run_ultravox.httpx.Client') as factory:
            response = factory.return_value.__enter__.return_value.post.return_value
            response.status_code = 200
            response.json.return_value = {'choices': [{'message': {'content': 'FAKE_TRANSPORT_TEST'}}]}
            output = backend.understand(np.array([.1, -.1], dtype=np.float32), 'Describe', 32)
            payload = factory.return_value.__enter__.return_value.post.call_args.kwargs['json']
        self.assertEqual(output, {'text': 'FAKE_TRANSPORT_TEST', 'finish_reason': None, 'usage': {}, 'refusal': None})
        audio = payload['messages'][0]['content'][1]['input_audio']
        with wave.open(io.BytesIO(base64.b64decode(audio['data']))) as wav:
            self.assertEqual((wav.getframerate(), wav.getnframes()), (16000, 2))
        self.assertEqual(payload['messages'][0]['content'][0]['text'], 'Describe')

    def infer_response(self, body, status=200):
        with patch('tools.run_ultravox.httpx.Client') as factory:
            response = factory.return_value.__enter__.return_value.post.return_value
            response.status_code = status
            response.json.return_value = body
            return UltravoxBackend('test').understand(np.zeros(2), 'prompt', 128)

    def test_llama_http_termination_usage_and_refusal_whitelist(self):
        for reason in ('stop', 'length', 'content_filter', 'tool_calls', None, 'unknown'):
            with self.subTest(reason=reason):
                output = self.infer_response({
                    'choices': [{'finish_reason': reason, 'message': {'content': 'raw answer',
                        'refusal': 'cannot comply', 'extra': 'private'}, 'extra': 'private'}],
                    'usage': {'prompt_tokens': 0, 'completion_tokens': 128, 'total_tokens': 128,
                              'extra': 'private'}, 'extra': 'private'})
                self.assertEqual(output, {'text': 'raw answer', 'refusal': 'cannot comply',
                    'finish_reason': reason if reason != 'unknown' else None,
                    'usage': {'prompt_tokens': 0, 'completion_tokens': 128, 'total_tokens': 128}})

    def test_invalid_http_counts_and_unknown_reason_do_not_infer_stop(self):
        output = self.infer_response({'choices': [{'message': {'content': 'answer'}}],
            'usage': {'prompt_tokens': True, 'completion_tokens': -1, 'total_tokens': '128'}})
        self.assertIsNone(output['finish_reason'])
        self.assertEqual(output['usage'], {})
        output = self.infer_response({'choices': [{'message': {'content': 'answer'}}],
            'usage': {'completion_tokens': 128}})
        self.assertIsNone(output['finish_reason'])
        self.assertEqual(output['usage'], {'completion_tokens': 128})

    def test_empty_refusal_and_malformed_http_responses(self):
        output = self.infer_response({'choices': [{'message': {'content': None, 'refusal': 'denied'},
                                                  'finish_reason': 'content_filter'}]})
        self.assertEqual(output['text'], '')
        self.assertEqual(output['refusal'], 'denied')
        output = self.infer_response({'choices': [{'message': {'content': ''}, 'finish_reason': 'length'}]})
        self.assertEqual(output['finish_reason'], 'length')
        for body in (None, [], {}, {'choices': []}, {'choices': [None]},
                     {'choices': [{'message': None}]}, {'choices': [{'message': {}}]},
                     {'choices': [{'message': {'content': []}}]},
                     {'choices': [{'message': {'content': ' '}, 'finish_reason': 'stop'}]},
                     {'choices': [{'message': {'refusal': {'extra': 'private'}}}]}):
            with self.subTest(body=body), self.assertRaises(HTTPException) as result:
                self.infer_response(body)
            self.assertEqual(result.exception.status_code, 502)
        with self.assertRaises(HTTPException) as result:
            self.infer_response({}, status=503)
        self.assertEqual(result.exception.status_code, 502)

    def test_direct_only_health_and_budget_contract(self):
        from fastapi.testclient import TestClient
        from tools.media_service import Settings, create_app
        settings = Settings(token='x'*32, audio_path='.', max_seconds=30, max_output_tokens=128, context_chars=256)
        client = TestClient(create_app(settings, UltravoxBackend('test')))
        headers = {'Authorization': 'Bearer ' + 'x'*32}
        health = client.get('/health', headers=headers).json()
        self.assertEqual(health['capabilities'], {'asr': False, 'input_audio': True})
        self.assertEqual(health['limits']['max_output_tokens'], 128)
        self.assertEqual(health['limits']['context_chars'], 256)
        self.assertEqual(health['limits']['audio_seconds'], 30)
        self.assertEqual(client.post('/v1/audio/transcriptions', headers=headers).status_code, 503)

    def test_budget_is_rejected_not_truncated(self):
        backend = UltravoxBackend('test')
        for samples, prompt, tokens in [(np.zeros(30*16000+1), '', 32), (np.zeros(2), 'a'*257, 32), (np.zeros(2), '', 129)]:
            with self.assertRaises(HTTPException) as result:
                backend.understand(samples, prompt, tokens)
            self.assertEqual(result.exception.status_code, 400)


@unittest.skipUnless(os.name == 'posix', 'POSIX termination and zombie-reaping assertions')
class UltravoxChildCleanup(unittest.TestCase):
    def spawn_child(self, code):
        child = subprocess.Popen([sys.executable, '-u', '-c', code], stdout=subprocess.PIPE,
                                 stderr=subprocess.DEVNULL)
        self.addCleanup(self.ensure_reaped, child)
        return child

    def ensure_reaped(self, child):
        try:
            if child.poll() is None:
                child.kill()
        except ProcessLookupError:
            pass
        finally:
            try:
                child.wait(timeout=2)
            finally:
                child.stdout.close()

    def assert_reaped(self, child):
        self.assertIsNotNone(child.returncode)
        with self.assertRaises(ChildProcessError):
            os.waitpid(child.pid, os.WNOHANG)

    def test_already_exited_child_is_waited_and_reaped(self):
        import psutil
        child = self.spawn_child('raise SystemExit(7)')
        deadline = time.monotonic() + 3
        while psutil.Process(child.pid).status() != psutil.STATUS_ZOMBIE:
            if time.monotonic() >= deadline:
                self.fail('Lightweight child did not exit within 3s')
            time.sleep(.01)
        self.assertIsNone(child.returncode)  # No Popen wait/poll has reaped it yet.
        with patch.object(child, 'wait', wraps=child.wait) as waited:
            stop_child(child, timeout=.5)
        waited.assert_called_once_with(timeout=.5)
        self.assertEqual(child.returncode, 7)
        self.assert_reaped(child)

    def running_child(self, ignore_term=False):
        code = ('import signal, time\n'
                + ('signal.signal(signal.SIGTERM, signal.SIG_IGN)\n' if ignore_term else '')
                + 'print("ready", flush=True)\ntime.sleep(60)')
        child = self.spawn_child(code)
        self.assertTrue(select.select([child.stdout], [], [], 3)[0], 'Child readiness exceeded 3s')
        self.assertEqual(child.stdout.readline(), b'ready\n')
        return child

    def test_running_child_is_terminated_and_reaped(self):
        child = self.running_child()
        with patch.object(child, 'wait', wraps=child.wait) as waited:
            stop_child(child, timeout=.5)
        waited.assert_called_once_with(timeout=.5)
        self.assertEqual(child.returncode, -signal.SIGTERM)
        self.assert_reaped(child)

    def test_sigterm_ignored_child_is_killed_and_reaped(self):
        child = self.running_child(ignore_term=True)
        with patch.object(child, 'wait', wraps=child.wait) as waited:
            stop_child(child, timeout=.2)
        self.assertEqual(waited.call_args_list, [call(timeout=.2), call(timeout=.2)])
        self.assertEqual(child.returncode, -signal.SIGKILL)
        self.assert_reaped(child)


class UltravoxCleanupRaces(unittest.TestCase):
    def test_terminate_exit_race_still_waits(self):
        child = Mock()
        child.poll.return_value = None
        child.terminate.side_effect = ProcessLookupError()
        stop_child(child, timeout=.1)
        child.wait.assert_called_once_with(timeout=.1)
        child.kill.assert_not_called()

    def test_kill_exit_race_still_waits(self):
        child = Mock()
        child.poll.return_value = None
        child.wait.side_effect = [subprocess.TimeoutExpired('test-child', .1), 0]
        child.kill.side_effect = ProcessLookupError()
        stop_child(child, timeout=.1)
        self.assertEqual(child.wait.call_args_list, [call(timeout=.1), call(timeout=.1)])
        child.kill.assert_called_once_with()

    def test_unexpected_errors_are_not_hidden(self):
        for operation in ('poll', 'terminate', 'wait', 'kill'):
            with self.subTest(operation=operation):
                child = Mock()
                child.poll.return_value = None
                error = PermissionError('unexpected cleanup failure')
                getattr(child, operation).side_effect = error
                if operation == 'kill':
                    child.wait.side_effect = subprocess.TimeoutExpired('test-child', .1)
                with self.assertRaises(PermissionError) as raised:
                    stop_child(child, timeout=.1)
                self.assertIs(raised.exception, error)

    def test_post_kill_wait_timeout_is_bounded_and_visible(self):
        child = Mock()
        child.poll.return_value = None
        child.wait.side_effect = subprocess.TimeoutExpired('test-child', .1)
        with self.assertRaises(subprocess.TimeoutExpired):
            stop_child(child, timeout=.1)
        self.assertEqual(child.wait.call_args_list, [call(timeout=.1), call(timeout=.1)])
        child.kill.assert_called_once_with()


if __name__ == '__main__':
    unittest.main()
