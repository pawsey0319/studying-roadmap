"""Serial local direct-waveform audio experiment. Built with Llama.

Ultravox MIT components plus Llama 3.2 Community License/AUP apply.
Internal llama-server never receives user URLs/paths, only sanitized PCM WAV.
"""
import io
import json
import os
from pathlib import Path
import secrets
import signal
import subprocess
import threading
import time
import wave

import httpx
import psutil
from fastapi import HTTPException
try:
    from .media_service import Settings, create_app, audio_completion
    from .model_runtime_lock import acquire_model_lock
except ImportError:
    from media_service import Settings, create_app, audio_completion
    from model_runtime_lock import acquire_model_lock


class UltravoxBackend:
    def __init__(self, internal_token, child_pid=None):
        self.internal_token = internal_token
        self.child_pid = child_pid

    def resource_evidence(self):
        """Sample the child's current RSS, not a process/model peak or tree total."""
        return {'runtime': 'llama.cpp-b12244', 'runtime_process_rss_bytes': psutil.Process(self.child_pid).memory_info().rss} if self.child_pid else {}

    def understand(self, samples, prompt, max_tokens):
        # Context 1024 is bounded BEFORE sending; no historical messages are truncated.
        if len(samples) > 30 * 16000 or len(prompt) > 256 or max_tokens > 128:
            raise HTTPException(400, 'ultravox_context_budget_30s_256chars_128tokens')
        import base64
        import numpy as np
        stream = io.BytesIO()
        with wave.open(stream, 'wb') as wav:
            wav.setnchannels(1); wav.setsampwidth(2); wav.setframerate(16000)
            wav.writeframes((np.clip(samples, -1, 1) * 32767).astype('<i2').tobytes())
        payload = {'model': 'local-ultravox', 'stream': False, 'max_tokens': max_tokens,
                   'temperature': 0, 'messages': [{'role': 'user', 'content': [
                       {'type': 'text', 'text': prompt},
                       {'type': 'input_audio', 'input_audio': {'data': base64.b64encode(stream.getvalue()).decode(), 'format': 'wav'}}]}]}
        try:
            with httpx.Client(timeout=90, trust_env=False) as client:
                result = client.post('http://127.0.0.1:8792/v1/chat/completions', json=payload,
                                     headers={'Authorization': 'Bearer ' + self.internal_token})
            if result.status_code != 200:
                raise HTTPException(502, 'ultravox_internal_inference_rejected')
            body = result.json()
            choice = body['choices'][0]
            message = choice['message']
            return audio_completion({'text': message.get('content'),
                                     'refusal': message.get('refusal'),
                                     'finish_reason': choice.get('finish_reason'),
                                     'usage': body.get('usage')})
        except (httpx.HTTPError, KeyError, IndexError, ValueError, TypeError, AttributeError):
            raise HTTPException(502, 'ultravox_internal_inference_failed') from None


def stop_child(child, timeout=10):
    """Terminate and reap even an already-exited child; bound both waits."""
    if child.poll() is None:
        try:
            child.terminate()
        except ProcessLookupError:
            pass  # It exited between poll and terminate; still reap it below.
    try:
        child.wait(timeout=timeout)
    except subprocess.TimeoutExpired:
        try:
            child.kill()
        except ProcessLookupError:
            pass  # It exited between the timed-out wait and kill.
        child.wait(timeout=timeout)


def main():
    config = Path.home() / '.config/learning-hub/media.env'
    if not config.is_file() or config.is_symlink() or config.stat().st_mode & 0o077:
        raise SystemExit('Private media.env 0600 required; run tools/run_media.py --init-only')
    values = dict(line.split('=', 1) for line in config.read_text().splitlines() if '=' in line and not line.startswith('#'))
    root = Path.home() / '.cache/learning-hub'
    model = root / 'models/ultravox-v0_5-llama-3_2-1b-GGUF/5390c7c41cbd6f261f7f205fc0c5ae61bbdca650'
    binary = root / 'runtimes/llama-b12244/llama-b12244/llama-server'
    if not (model / 'download-evidence.json').is_file() or not binary.is_file():
        raise SystemExit('Pinned verified Ultravox weights/runtime missing; see eval/README.md')
    runtime_lock = acquire_model_lock()
    if psutil.virtual_memory().available < 3.5 * 1024**3:
        raise SystemExit('Ultravox requires 3.5GiB available: 2.03GiB weights plus ~1.5GiB KV/activation/headroom')
    token = secrets.token_urlsafe(32)
    env = os.environ.copy(); env['LLAMA_API_KEY'] = token
    command = [str(binary), '-m', str(model / 'Llama-3.2-1B-Instruct-Q4_K_M.gguf'),
               '--mmproj', str(model / 'mmproj-ultravox-v0_5-llama-3_2-1b-f16.gguf'),
               '--host', '127.0.0.1', '--port', '8792', '--alias', 'local-ultravox',
               '-c', '1024', '-np', '1', '-n', '128', '-b', '128', '-ub', '128',
               '--no-context-shift', '--fit', 'off', '--offline', '--no-slots', '--log-disable']
    def interrupted(signum, frame):
        raise KeyboardInterrupt
    signal.signal(signal.SIGTERM, interrupted)
    signal.signal(signal.SIGINT, interrupted)
    child = subprocess.Popen(command, env=env, stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL)
    stop = threading.Event()
    server = None
    try:
        ready = False
        deadline = time.monotonic() + 60
        with httpx.Client(timeout=1, trust_env=False) as client:
            while time.monotonic() < deadline:
                if child.poll() is not None:
                    raise RuntimeError('Isolated llama-server exited during load (no credential/prompt logs retained)')
                if psutil.virtual_memory().available < 512 * 1024**2:
                    raise RuntimeError('Memory headroom below 512MiB during load; stopped safely')
                try:
                    ready = client.get('http://127.0.0.1:8792/health', headers={'Authorization': 'Bearer ' + token}).status_code == 200
                except httpx.HTTPError:
                    pass
                if ready:
                    break
                stop.wait(.5)
        if not ready:
            raise RuntimeError('Isolated llama-server startup exceeded 60s')
        settings = Settings(token=values.get('MEDIA_TOKEN', ''), audio_path=str(model), max_seconds=30,
                            max_output_tokens=128, context_chars=256,
                            origins=tuple(values.get('MEDIA_ORIGINS', '').split(',')))
        app = create_app(settings, UltravoxBackend(token, child.pid))
        import uvicorn
        server = uvicorn.Server(uvicorn.Config(app, host='127.0.0.1', port=8790, access_log=False,
                                               timeout_keep_alive=5, limit_concurrency=4))
        def watch():
            while not stop.wait(1):
                if child.poll() is not None or psutil.virtual_memory().available < 512 * 1024**2:
                    server.should_exit = True
                    try:
                        child.terminate()  # Preserve prompt low-memory protection.
                    except ProcessLookupError:
                        pass  # The finally block still owns wait/reaping.
                    break
        watcher = threading.Thread(target=watch, daemon=True); watcher.start()
        server.run()
    except KeyboardInterrupt:
        pass  # Uvicorn re-raises the captured termination signal after graceful shutdown.
    finally:
        stop.set()
        stop_child(child)


if __name__ == '__main__':
    main()
