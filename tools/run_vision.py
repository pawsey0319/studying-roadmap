"""Serial-only vision launcher using existing private media token; no credential output."""
import os
from pathlib import Path
from model_runtime_lock import acquire_model_lock
from media_service import Settings
from vision_service import create_app


def main():
    config = Path.home() / '.config/learning-hub/media.env'
    if not config.is_file() or config.is_symlink() or config.stat().st_mode & 0o077:
        raise SystemExit('Run tools/run_media.py --init-only first; private 0600 config required')
    values = dict(line.split('=', 1) for line in config.read_text().splitlines() if '=' in line and not line.startswith('#'))
    model = Path.home() / '.cache/learning-hub/models/Qwen3.5-0.8B-MLX-4bit/5d894f8cc4ef3e6c88537bf3746ed262f549da6a'
    if not (model / 'download-evidence.json').is_file():
        raise SystemExit('Pinned verified vision snapshot missing')
    runtime_lock = acquire_model_lock()
    os.environ['HF_HUB_OFFLINE'] = '1'
    settings = Settings(token=values.get('MEDIA_TOKEN', ''), origins=tuple(values.get('MEDIA_ORIGINS', '').split(',')))
    import uvicorn
    uvicorn.run(create_app(settings, str(model)), host='127.0.0.1', port=8791,
                access_log=False, timeout_keep_alive=5, limit_concurrency=4)


if __name__ == '__main__':
    main()
