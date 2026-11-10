"""Local-only media gateway. No remote URL fetches, no ASR fallback for audio QA.
Run with the isolated environment; see eval/README.md. Secrets only in environment.
"""
from __future__ import annotations
import asyncio
import base64
import binascii
import hmac
import os
from pathlib import Path
import subprocess
import tempfile
import time
from dataclasses import dataclass

from fastapi import FastAPI, HTTPException, Request
from fastapi.responses import JSONResponse
from starlette.concurrency import run_in_threadpool


@dataclass(frozen=True)
class Settings:
    token: str
    asr_path: str = ""
    audio_path: str = ""
    origins: tuple[str, ...] = ("http://localhost:8000", "http://127.0.0.1:8000")
    max_bytes: int = 10 * 1024 * 1024
    max_seconds: int = 60
    max_request_bytes: int = 15 * 1024 * 1024
    max_output_tokens: int = 512
    context_chars: int = 8000

    @classmethod
    def environment(cls):
        return cls(os.environ.get("MEDIA_TOKEN", ""), os.environ.get("MEDIA_ASR_PATH", ""),
                   os.environ.get("MEDIA_AUDIO_PATH", ""),
                   tuple(x.strip() for x in os.environ.get("MEDIA_ORIGINS", "http://localhost:8000,http://127.0.0.1:8000").split(",") if x.strip()))


def decode_audio(raw: bytes, max_seconds: int):
    """ffmpeg receives a private local file, never an input URL or user option."""
    import numpy as np
    with tempfile.TemporaryDirectory(prefix="lh-media-") as directory:
        source = Path(directory) / "input"
        source.write_bytes(raw)
        try:
            result = subprocess.run(["ffmpeg", "-nostdin", "-v", "error", "-protocol_whitelist", "file,pipe",
                "-format_whitelist", "wav,mp3,matroska,webm,ogg,mov,aac,flac", "-i", str(source), "-t", str(max_seconds + 1), "-vn", "-ac", "1", "-ar", "16000", "-f", "s16le", "pipe:1"],
                capture_output=True, timeout=15, check=True)
        except (subprocess.SubprocessError, OSError):
            raise HTTPException(400, "invalid_or_unsupported_audio") from None
    samples = np.frombuffer(result.stdout, dtype="<i2").astype(np.float32) / 32768
    if not len(samples):
        raise HTTPException(400, "empty_audio")
    if len(samples) > max_seconds * 16000:
        raise HTTPException(413, "audio_duration_exceeded")
    return samples


class LocalModels:
    def __init__(self, settings):
        self.settings = settings
        self.audio = None

    def transcribe(self, samples):
        import mlx_whisper
        if max(abs(samples)) < 0.002:
            return ""  # explicit silence guard prevents Whisper silence hallucinations
        result = mlx_whisper.transcribe(samples, path_or_hf_repo=self.settings.asr_path,
            task="transcribe", temperature=0, condition_on_previous_text=False, verbose=False)
        return result["text"].strip()

    def understand(self, samples, prompt, max_tokens):
        # A separate model must consume actual audio; ASR is deliberately not called.
        if self.audio is None:
            import psutil
            if psutil.virtual_memory().available < 8 * 1024**3:
                raise HTTPException(503, "direct_audio_requires_8GiB_available_memory")
            from mlx_audio.stt.utils import load_model
            self.audio = load_model(self.settings.audio_path)
        return self.audio.generate(samples, prompt=prompt, max_tokens=max_tokens,
                                   temperature=0, verbose=False)


def audio_completion(result):
    """Whitelist reported metadata; missing evidence never implies natural stop."""
    def field(name):
        return result.get(name) if isinstance(result, dict) else getattr(result, name, None)

    text = result if isinstance(result, str) else field('text')
    reason = field('finish_reason')
    if reason not in ('stop', 'length', 'content_filter', 'tool_calls'):
        reason = None
    refusal = field('refusal')
    refusal = refusal.strip()[:4096] if isinstance(refusal, str) and refusal.strip() else None
    usage = {}
    reported = field('usage')
    for source, destination in (('prompt_tokens', 'prompt_tokens'),
                                ('generation_tokens', 'completion_tokens'),
                                ('total_tokens', 'total_tokens')):
        value = reported.get(destination) if isinstance(reported, dict) else field(source)
        if type(value) is int and value >= 0:
            usage[destination] = value
    # Empty refusals/non-natural endings are valid evidence, not successful answers.
    # Malformed content or unexplained empty output must fail explicitly, without ASR.
    if text is None:
        text = ''
    if not isinstance(text, str):
        raise HTTPException(502, 'direct_audio_invalid_model_response')
    if not text.strip() and not refusal and reason in (None, 'stop'):
        raise HTTPException(502, 'direct_audio_empty_model_response')
    return {'text': text, 'finish_reason': reason, 'usage': usage, 'refusal': refusal}


def create_app(settings: Settings | None = None, backend=None):
    settings = settings or Settings.environment()
    if len(settings.token) < 24:
        raise ValueError("MEDIA_TOKEN must contain at least 24 characters")
    if any(x == "*" or x == "null" for x in settings.origins):
        raise ValueError("Explicit non-null CORS origins required")
    for model in (settings.asr_path, settings.audio_path):
        if model and not Path(model).is_dir():
            raise ValueError("Model must be an existing local snapshot directory")
    backend = backend or LocalModels(settings)
    app = FastAPI(docs_url=None, redoc_url=None, openapi_url=None)
    lock = asyncio.Lock()

    @app.middleware("http")
    async def guard(request, call_next):
        origin = request.headers.get("origin")
        headers = {"Cache-Control": "no-store"}
        if origin:
            if origin not in settings.origins:
                return JSONResponse({"error": "origin_forbidden"}, 403, headers=headers)
            headers.update({"Access-Control-Allow-Origin": origin, "Vary": "Origin",
                "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
                "Access-Control-Allow-Headers": "authorization, content-type"})
        if request.method == "OPTIONS":
            return JSONResponse({}, headers=headers)
        auth = request.headers.get("authorization", "")
        if not hmac.compare_digest(auth.encode(), ("Bearer " + settings.token).encode()):
            return JSONResponse({"error": "unauthorized"}, 401, headers=headers)
        # Bound the complete body BEFORE multipart/JSON parsing, including chunked uploads.
        chunks, total = [], 0
        async for chunk in request.stream():
            total += len(chunk)
            if total > settings.max_request_bytes:
                return JSONResponse({"error": "request_too_large"}, 413, headers=headers)
            chunks.append(chunk)
        body = b"".join(chunks)
        sent = False
        async def receive():
            nonlocal sent
            if not sent:
                sent = True
                return {"type": "http.request", "body": body, "more_body": False}
            return {"type": "http.disconnect"}
        request._body = body
        request._receive = receive
        response = await call_next(request)
        response.headers.update(headers)
        return response

    @app.get("/health")
    async def health():
        return {"service": "learning-hub-local-media", "ready": True,
                "capabilities": {"asr": bool(settings.asr_path), "input_audio": bool(settings.audio_path)},
                "models": {"asr": "local-whisper" if settings.asr_path else None,
                           "input_audio": "local-audio" if settings.audio_path else None},
                "limits": {"audio_bytes": settings.max_bytes, "audio_seconds": settings.max_seconds,
                           "max_output_tokens": settings.max_output_tokens, "context_chars": settings.context_chars},
                "validation": {"asr": "synthetic_smoke_only", "input_audio": "experimental_not_validated"}}

    @app.get("/v1/models")
    async def models():
        items = []
        if settings.asr_path:
            items.append({"id": "local-whisper", "object": "model", "capabilities": ["dictation"]})
        if settings.audio_path:
            items.append({"id": "local-audio", "object": "model", "capabilities": ["input_audio"], "validation": "experimental_requires_real_eval"})
        return {"object": "list", "data": items, "audio_understanding": bool(settings.audio_path)}

    async def infer(mode, raw, prompt="", max_tokens=256):
        if not raw or len(raw) > settings.max_bytes:
            raise HTTPException(413 if raw else 400, "audio_size_invalid")
        if lock.locked():
            raise HTTPException(429, "inference_busy")
        async with lock:
            samples = await run_in_threadpool(decode_audio, raw, settings.max_seconds)
            started = time.perf_counter()
            if mode == "asr":
                text = await run_in_threadpool(backend.transcribe, samples)
            else:
                text = await run_in_threadpool(backend.understand, samples, prompt, max_tokens)
            import psutil
            evidence = {"mode": mode, "audio_samples": len(samples), "sample_rate": 16000,
                        "inference_seconds": round(time.perf_counter() - started, 4),
                        "process_rss_bytes": psutil.Process().memory_info().rss}
            try:
                import mlx.core as mx
                evidence["mlx_peak_bytes"] = mx.get_peak_memory()
            except ImportError:
                pass
            if hasattr(backend, 'resource_evidence'):
                evidence.update(backend.resource_evidence())
            return text, evidence

    @app.post("/v1/audio/transcriptions")
    async def transcriptions(request: Request):
        if not settings.asr_path:
            raise HTTPException(503, "asr_model_unavailable")
        form = await request.form(max_files=1, max_fields=5)
        if form.get("model") != "local-whisper":
            raise HTTPException(400, "unsupported_model")
        file = form.get("file")
        if not hasattr(file, "read"):
            raise HTTPException(400, "file_required")
        raw = await file.read(settings.max_bytes + 1)
        await file.close()
        text, evidence = await infer("asr", raw)
        return {"text": text, "model": "local-whisper", "evidence": evidence}

    @app.post("/v1/chat/completions")
    async def completions(request: Request):
        # Fail closed; never silently substitute transcription plus a text model.
        if not settings.audio_path:
            raise HTTPException(503, "direct_audio_backend_not_validated")
        try:
            data = await request.json()
        except ValueError:
            raise HTTPException(400, "invalid_json") from None
        if not isinstance(data, dict):
            raise HTTPException(400, "json_object_required")
        if data.get("model") != "local-audio":
            raise HTTPException(400, "unsupported_model")
        messages = data.get("messages")
        if not isinstance(messages, list) or len(messages) != 1 or not isinstance(messages[0], dict) or messages[0].get("role") != "user":
            raise HTTPException(400, "one_user_message_required")
        content = messages[0].get("content")
        if not isinstance(content, list) or len(content) > 3:
            raise HTTPException(400, "invalid_content")
        audio, prompt = [], []
        for item in content:
            if not isinstance(item, dict):
                raise HTTPException(400, "invalid_content")
            if item.get("type") == "text" and isinstance(item.get("text"), str):
                prompt.append(item["text"])
            elif item.get("type") == "input_audio":
                audio.append(item.get("input_audio", {}))
            else:
                raise HTTPException(400, "unsupported_content_no_remote_urls")
        if len(audio) != 1 or not isinstance(audio[0], dict) or audio[0].get("format") not in ("wav", "mp3"):
            raise HTTPException(400, "one_wav_or_mp3_required")
        encoded = audio[0].get("data")
        if not isinstance(encoded, str) or len(encoded) > (settings.max_bytes * 4 // 3 + 4):
            raise HTTPException(413, "audio_size_invalid")
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(400, "invalid_base64") from None
        prompt = "\n".join(prompt)
        tokens = data.get("max_tokens", 256)
        if len(prompt) > settings.context_chars or type(tokens) is not int or not 1 <= tokens <= settings.max_output_tokens:
            raise HTTPException(400, "prompt_or_generation_limit")
        result, evidence = await infer("direct_audio", raw, prompt, tokens)
        completion = audio_completion(result)
        message = {"role": "assistant", "content": completion['text']}
        if completion['refusal'] is not None:
            message['refusal'] = completion['refusal']
        return {"id": "local-audio-response", "object": "chat.completion", "model": "local-audio",
            "choices": [{"index": 0, "message": message, "finish_reason": completion['finish_reason']}],
            "usage": completion['usage'], "evidence": evidence}

    return app


if __name__ == "__main__":
    import uvicorn
    from model_runtime_lock import acquire_model_lock
    runtime_lock = acquire_model_lock()
    uvicorn.run(create_app(), host="127.0.0.1", port=int(os.environ.get("MEDIA_PORT", "8790")),
                access_log=False, timeout_keep_alive=5, limit_concurrency=4)
