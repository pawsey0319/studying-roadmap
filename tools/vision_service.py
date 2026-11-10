"""Independent loopback image chat gateway; no network media fetching or ASR."""
import asyncio
import base64
import binascii
from io import BytesIO
import time
from pathlib import Path
import tempfile

from fastapi import HTTPException, Request
from starlette.concurrency import run_in_threadpool
try:
    from .media_service import Settings, create_app as media_app
except ImportError:
    from media_service import Settings, create_app as media_app


class LocalVision:
    def __init__(self, path):
        self.path, self.loaded = path, None

    def generate(self, raw, prompt, tokens):
        from PIL import Image
        from mlx_vlm import load, generate
        from mlx_vlm.prompt_utils import apply_chat_template
        from mlx_vlm.utils import load_config
        import psutil
        if self.loaded is None:
            if psutil.virtual_memory().available < 2 * 1024**3:
                raise HTTPException(503, 'vision_requires_2GiB_available_memory')
            self.loaded = load(self.path)
        model, processor = self.loaded
        formatted = apply_chat_template(processor, load_config(self.path), prompt,
                                        num_images=1, enable_thinking=False)
        with tempfile.TemporaryDirectory(prefix='lh-vision-') as directory:
            image = Path(directory) / 'image.png'
            with Image.open(BytesIO(raw)) as im:
                im.convert('RGB').save(image)
            return generate(model, processor, formatted, [str(image)], max_tokens=tokens,
                            temperature=0, verbose=False)


def generation_metadata(result):
    """Preserve reported termination, never infer it from a token count."""
    reason = getattr(result, 'finish_reason', None)
    if reason not in ('stop', 'length', 'content_filter', 'tool_calls'):
        reason = None
    usage = {}
    for source, destination in (('prompt_tokens', 'prompt_tokens'),
                                ('generation_tokens', 'completion_tokens'),
                                ('total_tokens', 'total_tokens')):
        value = getattr(result, source, None)
        if type(value) is int and value >= 0:
            usage[destination] = value
    return reason, usage


def create_app(settings, model_path, backend=None):
    if not Path(model_path).is_dir():
        raise ValueError('Existing local vision snapshot required')
    app = media_app(settings)
    # Keep precisely the proven auth/CORS/body guard, replace media-only routes.
    app.router.routes.clear()
    backend = backend or LocalVision(model_path)
    lock = asyncio.Lock()

    @app.get('/health')
    async def health():
        return {'service': 'learning-hub-local-vision', 'ready': True,
                'capabilities': {'vision': True}, 'models': {'vision': 'local-vision'},
                'validation': 'single_synthetic_card_smoke_only'}

    @app.get('/v1/models')
    async def models():
        return {'object': 'list', 'data': [{'id': 'local-vision', 'object': 'model',
                                           'capabilities': ['vision']}]}

    @app.post('/v1/chat/completions')
    async def completions(request: Request):
        try:
            data = await request.json()
        except ValueError:
            raise HTTPException(400, 'invalid_json') from None
        if not isinstance(data, dict) or data.get('model') != 'local-vision':
            raise HTTPException(400, 'unsupported_model')
        messages = data.get('messages')
        if not isinstance(messages, list) or not 1 <= len(messages) <= 2:
            raise HTTPException(400, 'one_user_optional_system_required')
        prompts, images, users = [], [], 0
        for message in messages:
            if not isinstance(message, dict):
                raise HTTPException(400, 'invalid_message')
            if message.get('role') == 'system' and isinstance(message.get('content'), str):
                prompts.append(message['content'])
                continue
            if message.get('role') != 'user' or not isinstance(message.get('content'), list):
                raise HTTPException(400, 'invalid_message')
            users += 1
            if len(message['content']) > 3:
                raise HTTPException(400, 'too_many_content_parts')
            for item in message['content']:
                if not isinstance(item, dict):
                    raise HTTPException(400, 'invalid_content')
                if item.get('type') == 'text' and isinstance(item.get('text'), str):
                    prompts.append(item['text'])
                elif item.get('type') == 'image_url' and isinstance(item.get('image_url'), dict):
                    images.append(item['image_url'].get('url'))
                else:
                    raise HTTPException(400, 'unsupported_content')
        if users != 1 or len(images) != 1 or not isinstance(images[0], str):
            raise HTTPException(400, 'one_inline_image_required')
        header, separator, encoded = images[0].partition(',')
        if not separator or header not in ('data:image/png;base64', 'data:image/jpeg;base64', 'data:image/webp;base64'):
            raise HTTPException(400, 'inline_png_jpeg_webp_only_no_remote_urls')
        if len(encoded) > settings.max_bytes * 4 // 3 + 4:
            raise HTTPException(413, 'image_too_large')
        try:
            raw = base64.b64decode(encoded, validate=True)
        except (ValueError, binascii.Error):
            raise HTTPException(400, 'invalid_base64') from None
        if not raw or len(raw) > settings.max_bytes:
            raise HTTPException(413, 'image_size_invalid')
        from PIL import Image, UnidentifiedImageError
        try:
            with Image.open(BytesIO(raw)) as image:
                if image.format not in ('PNG', 'JPEG', 'WEBP'):
                    raise HTTPException(400, 'unsupported_image_format')
                if image.width * image.height > 12_000_000:
                    raise HTTPException(413, 'image_pixel_limit')
                image.verify()
        except (UnidentifiedImageError, OSError, ValueError, Image.DecompressionBombError):
            raise HTTPException(400, 'invalid_image') from None
        prompt, tokens = '\n'.join(prompts), data.get('max_tokens', 128)
        if len(prompt) > 8000 or type(tokens) is not int or not 1 <= tokens <= 512:
            raise HTTPException(400, 'prompt_or_generation_limit')
        if lock.locked():
            raise HTTPException(429, 'inference_busy')
        async with lock:
            started = time.perf_counter()
            result = await run_in_threadpool(backend.generate, raw, prompt, tokens)
            text = result if isinstance(result, str) else result.text
            reason, usage = generation_metadata(result)
            import mlx.core as mx
            import psutil
            evidence = {'mode': 'vision', 'inference_seconds': round(time.perf_counter() - started, 4),
                        'process_rss_bytes': psutil.Process().memory_info().rss, 'mlx_peak_bytes': mx.get_peak_memory()}
        return {'id': 'local-vision-response', 'object': 'chat.completion', 'model': 'local-vision',
                'choices': [{'index': 0, 'message': {'role': 'assistant', 'content': text}, 'finish_reason': reason}],
                'usage': usage, 'evidence': evidence}

    return app
