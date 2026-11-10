"""Install one official pinned Apple Silicon release in external cache (no global changes)."""
import hashlib
import json
from pathlib import Path
import tarfile
try:
    from .setup_media import download_file
except ImportError:
    from setup_media import download_file

TAG = 'b12244'
SIZE = 16742962
SHA256 = '79ae4ca84303cfae2e2c573a6e0b8aa79b21f35c654cc67bea7c079028fcd41f'
URL = f'https://github.com/ggml-org/llama.cpp/releases/download/{TAG}/llama-{TAG}-bin-macos-arm64.tar.gz'


def main():
    root = Path.home() / '.cache/learning-hub/runtimes' / ('llama-' + TAG)
    root.mkdir(parents=True, exist_ok=True)
    archive = root / 'runtime.tar.gz'
    download_file(archive, URL, SIZE)
    if archive.stat().st_size != SIZE or hashlib.sha256(archive.read_bytes()).hexdigest() != SHA256:
        raise RuntimeError('Official runtime size/digest mismatch')
    with tarfile.open(archive) as stream:
        for item in stream.getmembers():
            if root.resolve() not in (root / item.name).resolve().parents:
                raise RuntimeError('Unsafe runtime archive path')
        stream.extractall(root, filter='data')
    (root / 'runtime-evidence.json').write_text(json.dumps({'tag': TAG, 'url': URL, 'bytes': SIZE, 'sha256': SHA256}, indent=2))
    print('Pinned verified runtime installed outside repository; no global configuration changed')


if __name__ == '__main__':
    main()
