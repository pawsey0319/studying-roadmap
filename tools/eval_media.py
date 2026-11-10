"""Reproducible LOCAL media smoke evaluation. No mocks; failures remain failures.
Fixtures are public synthetic macOS system speech, not human/Android acceptance.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import subprocess
import time
import unicodedata
import urllib.request
import urllib.error
import wave

ROOT = Path(__file__).resolve().parents[1]


def normalized(text):
    return ''.join(x.lower() for x in unicodedata.normalize('NFKC', text) if x.isalnum())


def distance(a, b):
    row = list(range(len(b) + 1))
    for i, x in enumerate(a, 1):
        nxt = [i]
        for j, y in enumerate(b, 1):
            nxt.append(min(nxt[-1] + 1, row[j] + 1, row[j - 1] + (x != y)))
        row = nxt
    return row[-1]


def fixtures(directory):
    directory.mkdir(parents=True, exist_ok=True)
    rows = []
    for ident, voice, text in [
        ('zh-clean', 'Tingting', '请把今天的学习任务改到明天下午三点。'),
        ('zh-entity', 'Tingting', '我想学习英语口语，每天练习二十分钟。'),
        ('en-clean', 'Samantha', 'Please help me practice English for twenty minutes every day.')]:
        aiff, wav = directory / (ident + '.aiff'), directory / (ident + '.wav')
        subprocess.run(['say', '-v', voice, '-o', str(aiff), text], check=True, timeout=30)
        subprocess.run(['ffmpeg', '-nostdin', '-v', 'error', '-y', '-i', str(aiff), '-ar', '16000', '-ac', '1', str(wav)], check=True, timeout=15)
        rows.append({'id': ident, 'path': str(wav.relative_to(ROOT)), 'reference': text, 'kind': 'system_tts_not_human', 'voice': voice})
    silent = directory / 'silence.wav'
    with wave.open(str(silent), 'wb') as out:
        out.setparams((1, 2, 16000, 0, 'NONE', 'not compressed'))
        out.writeframes(bytes(16000 * 2 * 2))
    rows.append({'id': 'silence', 'path': str(silent.relative_to(ROOT)), 'reference': '', 'kind': 'digital_silence'})
    for row in rows:
        row['sha256'] = hashlib.sha256((ROOT / row['path']).read_bytes()).hexdigest()
    return rows


def call(base, path, data, content_type, token):
    request = urllib.request.Request(base + path, data, {'Authorization': 'Bearer ' + token, 'Content-Type': content_type})
    with urllib.request.urlopen(request, timeout=180) as response:
        return json.load(response)


def main():
    parser = argparse.ArgumentParser()
    parser.add_argument('--base', default='http://127.0.0.1:8790/v1')
    parser.add_argument('--prepare', action='store_true')
    parser.add_argument('--direct-audio', action='store_true')
    parser.add_argument('--manifest', default='eval/fixtures/manifest.json')
    parser.add_argument('--output', default='eval/results/local-media.json')
    args = parser.parse_args()
    from urllib.parse import urlparse
    if urlparse(args.base).hostname not in ('localhost', '127.0.0.1'):
        parser.error('Evaluation only permits localhost; no external inference')
    manifest = ROOT / args.manifest
    if args.prepare:
        rows = fixtures(manifest.parent)
        manifest.write_text(json.dumps(rows, ensure_ascii=False, indent=2))
        print(f'Prepared {len(rows)} explicitly synthetic fixtures')
        return
    token = os.environ.get('MEDIA_TOKEN', '')
    if len(token) < 24:
        parser.error('MEDIA_TOKEN required, never read cloud LLM credentials')
    rows = json.loads(manifest.read_text())
    results = []
    for row in rows:
        raw = (ROOT / row['path']).read_bytes()
        item = {**row, 'mode': 'direct_audio' if args.direct_audio else 'asr', 'fixture_hash_verified': hashlib.sha256(raw).hexdigest() == row['sha256']}
        if not item['fixture_hash_verified']:
            raise ValueError('fixture hash mismatch')
        started = time.perf_counter()
        try:
            if args.direct_audio:
                payload = {'model': 'local-audio', 'max_tokens': 96, 'messages': [{'role': 'user', 'content': [{'type': 'text', 'text': 'Describe the actual sounds and language you hear. Do not infer any unheard facts.'}, {'type': 'input_audio', 'input_audio': {'format': 'wav', 'data': base64.b64encode(raw).decode()}}]}]}
                response = call(args.base, '/chat/completions', json.dumps(payload).encode(), 'application/json', token)
                item['text'] = response['choices'][0]['message']['content']
                item['semantic_grade'] = 'requires_human_review_not_automatic_pass'
            else:
                boundary = 'learning-hub-eval-boundary'
                body = (f'--{boundary}\r\nContent-Disposition: form-data; name="model"\r\n\r\nlocal-whisper\r\n--{boundary}\r\nContent-Disposition: form-data; name="file"; filename="sample.wav"\r\nContent-Type: audio/wav\r\n\r\n').encode() + raw + f'\r\n--{boundary}--\r\n'.encode()
                response = call(args.base, '/audio/transcriptions', body, 'multipart/form-data; boundary=' + boundary, token)
                item['text'] = response['text']
                a, b = normalized(row['reference']), normalized(item['text'])
                item['cer'] = distance(a, b) / max(1, len(a))
                item['exact_normalized'] = a == b
            item['evidence'] = response.get('evidence')
            item['status'] = 'real_inference_completed'
        except (urllib.error.URLError, KeyError, ValueError, TimeoutError) as error:
            item['status'] = 'failed'
            item['error_type'] = type(error).__name__
            if isinstance(error, urllib.error.HTTPError):
                item['http_status'] = error.code
                item['error_body'] = error.read(1024).decode(errors='replace')
        item['wall_seconds'] = round(time.perf_counter() - started, 3)
        results.append(item)
    report = {'timestamp_utc': time.strftime('%Y-%m-%dT%H:%M:%SZ', time.gmtime()), 'real_inference_attempted': True, 'scope': 'synthetic_smoke_only_not_240_case_acceptance', 'results': results, 'completed': sum(x['status'] == 'real_inference_completed' for x in results)}
    output = ROOT / args.output
    output.parent.mkdir(parents=True, exist_ok=True)
    output.write_text(json.dumps(report, ensure_ascii=False, indent=2))
    print(json.dumps({'completed': report['completed'], 'total': len(results), 'output': args.output}))
    if report['completed'] != len(results):
        raise SystemExit(1)


if __name__ == '__main__':
    main()
