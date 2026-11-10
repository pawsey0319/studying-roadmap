"""Zero-choice local ASR launcher; creates private config, never prints credentials.
Managed caller must track this process and stop it; no daemon installation.
"""
import argparse
import json
import os
from pathlib import Path
import secrets
import subprocess
import sys


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--init-only', action='store_true')
    parser.add_argument('--enable-experimental-audio', action='store_true')
    args = parser.parse_args()
    config = Path.home() / '.config/learning-hub/media.env'
    root = Path.home() / '.cache/learning-hub/models'
    asr = root / 'whisper-small-mlx/45f3915923c7a79a5a5b5a7d909d39aeb0e5630e'
    audio = root / 'Qwen2-Audio-7B-Instruct-4bit/c65570002626f41b4dc08b7b54f42f99f3e82e7f'
    if not (asr / 'download-evidence.json').is_file():
        parser.error('Pinned ASR missing: run tools/setup_media.py with the isolated Python first')
    if not config.exists():
        config.parent.mkdir(parents=True, exist_ok=True)
        fd = os.open(config, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
        with os.fdopen(fd, 'w') as out:
            out.write('MEDIA_TOKEN=' + secrets.token_urlsafe(32) + '\nMEDIA_PORT=8790\nMEDIA_ASR_PATH=' + str(asr) + '\nMEDIA_ORIGINS=http://localhost:8000,http://127.0.0.1:8000,http://localhost:8811,http://127.0.0.1:8811\n')
    if config.is_symlink() or config.stat().st_mode & 0o077:
        parser.error('Private config must be regular, not symlink, permissions 0600')
    for line in config.read_text().splitlines():
        if line and not line.startswith('#') and '=' in line:
            key, value = line.split('=', 1)
            if key in ('MEDIA_TOKEN', 'MEDIA_PORT', 'MEDIA_ASR_PATH', 'MEDIA_ORIGINS'):
                os.environ[key] = value
    os.environ['HF_HUB_OFFLINE'] = '1'
    os.environ.pop('MEDIA_AUDIO_PATH', None)
    if args.enable_experimental_audio:
        if not (audio / 'download-evidence.json').is_file():
            parser.error('Direct audio model is not fully downloaded and verified')
        os.environ['MEDIA_AUDIO_PATH'] = str(audio)
    preset = config.with_name('media-browser.json')
    if preset.is_symlink():
        parser.error('Browser preset must not be a symlink')
    fd = os.open(preset, os.O_WRONLY | os.O_CREAT | os.O_TRUNC, 0o600)
    os.fchmod(fd, 0o600)
    with os.fdopen(fd, 'w') as out:
        json.dump({'schema': 'lh-local-media/1', 'stt': {
            'base': 'http://127.0.0.1:' + os.environ['MEDIA_PORT'] + '/v1',
            'model': 'local-whisper', 'key': os.environ['MEDIA_TOKEN']}}, out, indent=2)
    print('Private local media configuration and browser preset ready (0600); no token printed.', flush=True)
    if not args.init_only:
        os.execv(sys.executable, [sys.executable, str(Path(__file__).with_name('media_service.py'))])


if __name__ == '__main__':
    main()
