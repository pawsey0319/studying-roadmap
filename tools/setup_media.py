"""Download public small ASR to external cache, pinned by repository revision.
Only public model files; no credentials and no inference calls. Uses HF_ENDPOINT if set.
"""
import hashlib
import json
import os
from pathlib import Path
import urllib.request
import subprocess

REPO = "mlx-community/whisper-small-mlx"
REVISION = "45f3915923c7a79a5a5b5a7d909d39aeb0e5630e"


def download_file(target, url, expected_size):
    """Resume partial public files; never restart/overwrite on unsupported Range.

    A failed curl retains partial bytes. The caller must verify final size and LFS
    SHA256 before writing a completed snapshot manifest.
    """
    offset = target.stat().st_size if target.exists() else 0
    if offset > expected_size:
        raise RuntimeError('Cached file exceeds expected size; inspect it before retrying')
    if offset == expected_size:
        return
    command = ['curl', '--fail', '--location', '--silent', '--show-error',
               '--connect-timeout', '20', '--max-time', '600', '--retry', '1']
    if offset:
        command += ['--continue-at', str(offset)]
    command += ['--output', str(target), url]
    subprocess.run(command, check=True, timeout=650)


def install(repo=REPO, revision=REVISION, selected_files=None):
    endpoint = os.environ.get("HF_ENDPOINT", "https://huggingface.co").rstrip("/")
    root = Path.home() / ".cache/learning-hub/models" / repo.split("/")[-1] / revision
    root.mkdir(parents=True, exist_ok=True)
    metadata_path = os.environ.get("MEDIA_PUBLIC_METADATA")
    if metadata_path:
        metadata = json.loads(Path(metadata_path).read_text())
    else:
        with urllib.request.urlopen(f"{endpoint}/api/models/{repo}/revision/{revision}?blobs=true", timeout=30) as response:
            metadata = json.load(response)
    if metadata.get("sha") != revision:
        raise RuntimeError("Repository revision mismatch")
    files = [x for x in metadata["siblings"] if (x["rfilename"] in selected_files if selected_files is not None else x["rfilename"].endswith((".json", ".npz", ".safetensors", ".txt", ".model", ".md", ".jinja")))]
    if selected_files is not None and set(selected_files) != {x['rfilename'] for x in files}:
        raise RuntimeError('Requested pinned model files missing from metadata')
    if sum(x.get("size", 0) for x in files) > 7 * 1024**3:
        raise RuntimeError("Download exceeds 7 GiB safety budget")
    manifest = {"repo": repo, "revision": revision, "endpoint_kind": "official" if endpoint == "https://huggingface.co" else "explicit_mirror", "files": []}
    for item in files:
        name = item["rfilename"]
        target = (root / name).resolve()
        if root.resolve() not in target.parents:
            raise RuntimeError("unsafe repository path")
        target.parent.mkdir(parents=True, exist_ok=True)
        if not target.exists() or target.stat().st_size != item.get("size"):
            print(f"Downloading public file: {name} ({item.get('size')} bytes)", flush=True)
            route = "resolve" if item.get("lfs") else "raw"
            download_file(target, f"{endpoint}/{repo}/{route}/{revision}/{name}", item['size'])
        if target.stat().st_size != item.get("size"):
            raise RuntimeError("File size mismatch")
        digest = hashlib.sha256()
        with target.open("rb") as stream:
            while chunk := stream.read(1024 * 1024):
                digest.update(chunk)
        sha = digest.hexdigest()
        expected = item.get("lfs", {}).get("sha256")
        if expected and sha != expected:
            raise RuntimeError("Weight checksum mismatch")
        manifest["files"].append({"file": name, "bytes": target.stat().st_size, "sha256": sha, "lfs_verified": bool(expected)})
    (root / "download-evidence.json").write_text(json.dumps(manifest, indent=2))
    print(str(root), flush=True)
    return root


if __name__ == "__main__":
    import argparse
    parser = argparse.ArgumentParser()
    choice = parser.add_mutually_exclusive_group()
    choice.add_argument("--audio", action="store_true")
    choice.add_argument("--ultravox", action="store_true")
    args = parser.parse_args()
    if args.ultravox:
        install('ggml-org/ultravox-v0_5-llama-3_2-1b-GGUF', '5390c7c41cbd6f261f7f205fc0c5ae61bbdca650',
                ['Llama-3.2-1B-Instruct-Q4_K_M.gguf', 'mmproj-ultravox-v0_5-llama-3_2-1b-f16.gguf'])
    elif args.audio:
        install("mlx-community/Qwen2-Audio-7B-Instruct-4bit", "c65570002626f41b4dc08b7b54f42f99f3e82e7f")
    else:
        install()
