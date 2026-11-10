"""Synthetic development-only visual extraction suite; deterministic scoring, no model judge.
prepare/score are offline. infer only calls an explicitly supplied local vision service.
Never loads model weights, rewrites previous results, or claims the planned 240 cases exist.
"""
import argparse
import base64
import hashlib
import json
import os
from pathlib import Path
import platform
import time
import urllib.request
import urllib.parse

ROOT = Path(__file__).resolve().parents[1]
FONT_DEFAULT = '/System/Library/Fonts/STHeiti Medium.ttc'
SCHEMA = 'lh-project-visual-dev/1'
PROMPT_VERSION = 'strict-fields-locators-v1'
# Authored synthetic facts, NOT real contracts/financial advice or sampled human records.
CARDS = [
 ('study-specific', '学习计划', [('科目','英语口语'),('时间','明天下午三点'),('时长','20分钟'),('状态','未开始')], 'detail'),
 ('study-reading', '学习计划', [('科目','英语阅读'),('时间','周五上午九点'),('时长','35分钟'),('状态','进行中')], 'detail'),
 ('study-mastery', '学习回顾', [('任务','已完成'),('掌握度','未确认'),('测验','未参加'),('下一步','用户决定')], 'negation'),
 ('study-correction', '日程更正', [('原时间','周一14:00'),('现时间','周二16:30'),('科目','法律基础'),('状态','原时间已取消')], 'correction'),
 ('money-units', '模拟费用表', [('金额','1200.50元'),('税率','6%'),('数量','12件'),('截止日','2026-12-03')], 'numeric'),
 ('money-negative', '模拟账目', [('收入','800元'),('支出','950元'),('净额','-150元'),('单位','人民币元')], 'numeric'),
 ('money-percent', '模拟研究记录', [('样本数','240'),('误差','0.8%'),('比例','12.5%'),('结论','不保证收益')], 'numeric'),
 ('money-decimal', '模拟测量表', [('温度','-3.5℃'),('长度','0.08米'),('质量','2.05千克'),('编号','A-0012')], 'numeric'),
 ('legal-not', '模拟合同学习卡', [('允许','只读材料'),('禁止','对外提交'),('签署','不授权'),('付款','不授权')], 'negation'),
 ('legal-except', '模拟例外条款', [('规则','不得转发'),('例外','经书面同意可转发摘要'),('原文','仍不得公开'),('有效期','仅本次任务')], 'exception'),
 ('legal-before', '模拟提交条件', [('提交前提','管理员审核'),('当前状态','尚未审核'),('能否提交','不能'),('取消期限','2026-11-30前')], 'negation'),
 ('legal-revoke', '模拟授权记录', [('历史权限','可写入'),('当前权限','已撤销'),('待执行动作','立即停止'),('旧操作','不保证撤回')], 'negation'),
 ('absent-author', '阅读卡', [('标题','河流与城市'),('作者',None),('日期','2026-10-04'),('页码','第2页')], 'absent'),
 ('absent-date', '阅读卡', [('标题','色彩练习'),('作者','示例作者甲'),('日期',None),('技法','水彩')], 'absent'),
 ('absent-price', '展览信息', [('展名','合成空间'),('地点','示例展厅'),('票价',None),('时间','14:00')], 'absent'),
 ('absent-version', '工具说明', [('工具','示例编辑器'),('版本',None),('系统','演示系统'),('状态','未连接')], 'absent'),
 ('source-stale', '观察状态', [('图像时间','10:00:00'),('当前时间','10:02:00'),('来源状态','已过期'),('可否当实时','不能')], 'provenance'),
 ('source-hidden', '来源状态', [('来源','外部浏览器'),('当前画面','咨询界面'),('文章可见','否'),('引用状态','待重新确认')], 'provenance'),
 ('source-scope', '授权范围', [('对象','指定窗口'),('范围','仅可见区域'),('后台全文','不可读取'),('权限','仅观察')], 'provenance'),
 ('source-version', '版本记录', [('旧版本','r017'),('新版本','r018'),('旧行号','不可直接复用'),('处理','重新定位')], 'provenance'),
 ('small-tech', '小字技术卡', [('模型','Qwen3.5-0.8B'),('量化','4bit'),('上下文','1024 tokens'),('权重','不等于总内存')], 'small_text'),
 ('small-english', '中英术语卡', [('模式','direct_audio'),('转写','dictation'),('默认输出','文字'),('回退','不得静默转换')], 'small_text'),
 ('small-time', '小字时间表', [('开始','09:05'),('结束','09:50'),('日期','2026-12-08'),('时区','Asia/Shanghai')], 'small_text'),
 ('small-formula', '公式与实验卡', [('公式','E = mc²'),('单位','J'),('条件','v < c'),('结果','未验证')], 'small_text'),
]


def sha(data):
    return hashlib.sha256(data).hexdigest()


def write_new(path, data):
    path = Path(path)
    path.parent.mkdir(parents=True, exist_ok=True)
    with path.open('x', encoding='utf-8') as f:
        json.dump(data, f, ensure_ascii=False, indent=2)
        f.write('\n')


def prepare(directory, font_path):
    from PIL import Image, ImageDraw, ImageFont, __version__ as pillow_version
    directory = Path(directory)
    # Refuse existing suite rather than silently change fixture identity.
    directory.mkdir(parents=True, exist_ok=False)
    font_bytes = Path(font_path).read_bytes()
    cases = []
    for case_id, title, rows, category in CARDS:
        size = 20 if category == 'small_text' else 32
        font = ImageFont.truetype(str(font_path), size)
        image = Image.new('RGB', (900, 520), 'white')
        draw = ImageDraw.Draw(image)
        draw.text((24, 20), f'L1 标题：{title}', font=font, fill='black')
        fields = {}
        visible_index = 2
        for key, value in rows:
            if value is None:
                fields[key] = {'value': None, 'locator': None}
                continue
            locator = f'L{visible_index}'
            draw.text((24, 40 + (visible_index - 1) * 86), f'{locator} {key}：{value}', font=font, fill='black')
            fields[key] = {'value': value, 'locator': locator}
            visible_index += 1
        target = directory / f'{case_id}.png'
        image.save(target, optimize=False)
        cases.append({'id': case_id, 'category': category, 'origin': 'synthetic_authored', 'split': 'development', 'image': target.name,
                      'sha256': sha(target.read_bytes()), 'width': 900, 'height': 520, 'font_size': size,
                      'requested_fields': list(fields), 'reference': fields, 'reference_review': 'author_defined_not_independently_reviewed'})
    manifest = {'schema': SCHEMA, 'suite_id': 'zh-reading-dev-v1', 'scope': '24_synthetic_development_cards_not_production_acceptance',
                'prompt_version': PROMPT_VERSION, 'renderer': {'pillow': pillow_version, 'font_sha256': sha(font_bytes), 'font_file_name': Path(font_path).name},
                'provenance_counts': {'synthetic_authored': len(cases), 'public_licensed': 0, 'consented_human': 0},
                'split_counts': {'development': len(cases), 'frozen_acceptance': 0},
                'planned_formal_suite': {'total': 240, 'per_modality': {'asr': 60, 'direct_audio': 60, 'reading_visual': 60, 'pc_scene': 60},
                    'status': 'not_collected_or_frozen', 'accepted_formal_samples': 0,
                    'warning': 'These 24 authored development cards and prior smoke do not complete any formal quota. No public or human samples claimed.',
                    'collection_requirements': ['licensed public source manifest and original hashes', 'explicit consent for human/device recordings', 'independent reference review', 'split before tuning; frozen holdout access restricted', 'numbers/negation/noise/accents/art/formulas/PC occlusion/staleness coverage']},
                'cases': cases}
    write_new(directory / 'manifest.json', manifest)
    return manifest


def load_manifest(path):
    path = Path(path)
    raw = path.read_bytes()
    manifest = json.loads(raw)
    if manifest.get('schema') != SCHEMA or len(manifest.get('cases', [])) != 24:
        raise ValueError('unexpected suite schema/count')
    ids = set()
    for case in manifest['cases']:
        if case['id'] in ids or case['split'] != 'development' or case['origin'] != 'synthetic_authored':
            raise ValueError('invalid case provenance/split')
        ids.add(case['id'])
        image = (path.parent / case['image']).resolve()
        if image.parent != path.parent.resolve() or sha(image.read_bytes()) != case['sha256']:
            raise ValueError('fixture hash/path mismatch')
    return manifest, sha(raw)


def prompt(case, version=PROMPT_VERSION):
    if version == 'strict-fields-locators-v2':
        skeleton = {'fields': {key: {'value': None, 'locator': None} for key in case['requested_fields']}}
        return ('你是逐字抄录器。只返回下面形状的一个合法JSON对象，禁止markdown围栏、数组或额外解释。'
                '每个指定字段都保留value与locator两项；将空值替换为图片中该字段冒号后的原文和同一行左侧L编号。'
                'L1是页面标题行，不可用页面标题替换正文中的同名字段。找不到该字段时两项均保持null，不能猜测。'
                '必须逐字复制Unicode字符，不换单位，不改公式或数字，不概括，不漏时间限定词。'
                '输出结构（null仅为空位，不是答案）：' + json.dumps(skeleton, ensure_ascii=False, separators=(',', ':')))
    if version != PROMPT_VERSION:
        raise ValueError('unknown prompt version')
    return ('读取图片，逐字提取指定字段，不得概括、省略限定词、改变数字/单位/否定词。'
            '仅输出JSON对象 {"fields":{"字段名":{"value":"原文值","locator":"L行号"}}}。'
            'value必须保持原文；locator填写图片左侧L行号；图中不存在的信息value和locator都填null。'
            '不要猜测，不要markdown，不要评分。指定字段：' + json.dumps(case['requested_fields'], ensure_ascii=False))


def decode_answer(text):
    value = json.loads(text)
    if not isinstance(value, dict) or set(value) != {'fields'} or not isinstance(value['fields'], dict):
        raise ValueError('answer must only contain fields object')
    for field in value['fields'].values():
        if not isinstance(field, dict) or set(field) != {'value', 'locator'}:
            raise ValueError('field must only contain value/locator')
        if any(v is not None and not isinstance(v, str) for v in field.values()):
            raise ValueError('field values must be strings or null')
    return value['fields']


def score(manifest_path, responses_path):
    manifest, manifest_hash = load_manifest(manifest_path)
    rows = [json.loads(line) for line in Path(responses_path).read_text().splitlines() if line.strip()]
    known = {c['id']: c for c in manifest['cases']}
    results = {}
    for row in rows:
        if row.get('id') not in known or row['id'] in results:
            raise ValueError('unknown or duplicate response id')
        if row.get('manifest_sha256') != manifest_hash or row.get('image_sha256') != known[row['id']]['sha256']:
            raise ValueError('response provenance hash mismatch')
        results[row['id']] = row
    scored = []
    for case in manifest['cases']:
        row = results.get(case['id'])
        if row is None or row.get('request_error'):
            scored.append({'id': case['id'], 'category': case['category'],
                           'status': 'request_error' if row else 'not_run', 'passed': None})
            continue
        try:
            fields = decode_answer(row.get('text', ''))
            schema_ok = set(fields) == set(case['reference'])
        except (ValueError, TypeError):
            fields, schema_ok = {}, False
        details = {key: {'value_correct': key in fields and fields[key]['value'] == ref['value'],
                         'locator_correct': key in fields and fields[key]['locator'] == ref['locator'],
                         'expected': ref, 'actual': fields.get(key)} for key, ref in case['reference'].items()}
        finish = row.get('finish_reason')
        termination = 'unknown' if finish is None else ('stop' if finish == 'stop' else 'non_stop')
        scored.append({'id': case['id'], 'category': case['category'], 'status': 'completed', 'schema_correct': schema_ok,
                       'termination': termination,
                       'passed': termination != 'non_stop' and schema_ok and all(x['value_correct'] and x['locator_correct'] for x in details.values()), 'fields': details})
    completed = [r for r in scored if r['status'] == 'completed']
    fields = [f for row in completed for f in row['fields'].values()]
    return {'schema': 'lh-project-field-score/1', 'manifest_sha256': manifest_hash, 'responses_sha256': sha(Path(responses_path).read_bytes()),
            'scope': manifest['scope'], 'judge': 'deterministic_exact_unicode_values_and_locators_no_model_self_score',
            'run_metadata': [r.get('run_metadata') for r in rows], 'case_total': len(scored), 'cases_run': len(completed),
            'cases_correct': sum(r['passed'] for r in completed), 'field_total_run': len(fields),
            'field_values_correct': sum(f['value_correct'] for f in fields), 'field_locators_correct': sum(f['locator_correct'] for f in fields),
            'field_value_accuracy_on_run': sum(f['value_correct'] for f in fields) / len(fields) if fields else None,
            'passed': None, 'production_eligible': False,
            'warning': 'Development diagnostic only. Missing responses stay not_run; no benchmark/production pass. Strict exact matching intentionally counts omitted specificity and format changes.', 'cases': scored}


def diagnose_legacy(result_path, image_path):
    """Read-only recheck of the known original four-field smoke, not a new inference."""
    result_path, image_path = Path(result_path), Path(image_path)
    evidence = json.loads(result_path.read_bytes())
    if sha(image_path.read_bytes()) != evidence['fixture_sha256']:
        raise ValueError('legacy fixture hash mismatch')
    expected = {'学习科目': '英语口语', '计划时间': '明天下午三点', '每日时长': '20分钟', '当前状态': '未开始'}
    actual = {}
    for line in evidence['text'].splitlines():
        key, separator, value = line.partition('：')
        if separator:
            actual[key.strip()] = value.strip()
    details = {key: {'expected': value, 'actual': actual.get(key), 'correct': actual.get(key) == value}
               for key, value in expected.items()}
    return {'schema': 'lh-legacy-vision-diagnostic/1', 'source_result_sha256': sha(result_path.read_bytes()),
            'fixture_sha256': evidence['fixture_sha256'], 'model_snapshot': evidence['model_snapshot'],
            'new_inference': False, 'scope': 'single_original_synthetic_smoke_offline_recheck',
            'method': 'exact_field_text_after_colon_split_and_outer_whitespace_trim',
            'fields': details, 'correct_fields': sum(f['correct'] for f in details.values()), 'total_fields': 4,
            'field_check_passed': all(f['correct'] for f in details.values()),
            'locator_passed': None, 'behavioral_passed': None, 'production_eligible': False,
            'warning': 'Missing 口语 specificity fails exact field check. Original result unchanged; no new suite responses or frozen acceptance evidence.'}


class NoRedirect(urllib.request.HTTPRedirectHandler):
    def redirect_request(self, req, fp, code, msg, headers, newurl):
        raise ValueError('redirect forbidden')


def infer(manifest_path, output, endpoint, token_env, metadata_path, timeout, prompt_version=PROMPT_VERSION):
    parsed = urllib.parse.urlparse(endpoint)
    if parsed.scheme != 'http' or parsed.hostname not in ('localhost', '127.0.0.1', '::1') or parsed.username or parsed.password or parsed.query or parsed.fragment:
        raise ValueError('explicit localhost HTTP endpoint required')
    manifest, manifest_hash = load_manifest(manifest_path)
    metadata = json.loads(Path(metadata_path).read_text())
    required = {'model_id', 'revision', 'quantization', 'hardware', 'framework', 'license', 'input_policy'}
    if not required.issubset(metadata) or any(not isinstance(metadata[k], str) or not metadata[k] for k in required):
        raise ValueError('complete model revision/quantization/hardware/framework/license/input policy metadata required')
    token = os.environ.get(token_env) if token_env else None
    if token_env and not token:
        raise ValueError('explicit token env missing')
    if not 1 <= timeout <= 120:
        raise ValueError('timeout must be 1..120')
    opener = urllib.request.build_opener(urllib.request.ProxyHandler({}), NoRedirect())
    # Reserve before requests; never overwrite an older run. Flush every result for crash recovery.
    with Path(output).open('x', encoding='utf-8') as f:
        for case in manifest['cases']:
            image = (Path(manifest_path).parent / case['image']).read_bytes()
            body = {'model': metadata['model_id'], 'max_tokens': 512, 'temperature': 0, 'stream': False, 'messages': [{'role': 'user', 'content': [
                {'type': 'text', 'text': prompt(case, prompt_version)}, {'type': 'image_url', 'image_url': {'url': 'data:image/png;base64,' + base64.b64encode(image).decode()}}]}]}
            request = urllib.request.Request(endpoint, data=json.dumps(body).encode(), headers={'Content-Type': 'application/json', **({'Authorization': 'Bearer ' + token} if token else {})})
            start = time.perf_counter()
            row = {'id': case['id'], 'manifest_sha256': manifest_hash, 'image_sha256': case['sha256'], 'run_metadata': metadata,
                   'prompt_version': prompt_version, 'prompt_sha256': sha(prompt(case, prompt_version).encode()), 'max_tokens': 512, 'temperature': 0}
            try:
                with opener.open(request, timeout=timeout) as response:
                    raw = response.read(256 * 1024 + 1)
                if len(raw) > 256 * 1024:
                    raise ValueError('response too large')
                response_body = json.loads(raw)
                choice = response_body['choices'][0]
                message = choice['message']
                if choice.get('finish_reason') in ('stop', 'length', 'content_filter', 'tool_calls'):
                    row['finish_reason'] = choice['finish_reason']
                usage = response_body.get('usage')
                if isinstance(usage, dict):
                    row['server_reported_usage'] = {
                        key: value for key in ('prompt_tokens', 'completion_tokens', 'total_tokens')
                        if type(value := usage.get(key)) is int and value >= 0
                    }
                evidence = response_body.get('evidence', {})
                if isinstance(evidence, dict):
                    # Server-reported resource measurements, not an independent sampler.
                    import math
                    row['server_reported_resources'] = {
                        key: value for key in ('inference_seconds', 'process_rss_bytes', 'mlx_peak_bytes')
                        if type(value := evidence.get(key)) in (int, float) and math.isfinite(value) and value >= 0
                    }
                if message.get('tool_calls') or not isinstance(message.get('content'), str):
                    raise ValueError('text-only response required')
                row.update(text=message['content'], real_inference=True)
            except Exception as error:
                # Do not echo server errors, credentials, or request body.
                row.update(text='', request_error=type(error).__name__, real_inference=False)
            row['seconds'] = round(time.perf_counter() - start, 4)
            f.write(json.dumps(row, ensure_ascii=False) + '\n'); f.flush()


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    commands = parser.add_subparsers(dest='command', required=True)
    p = commands.add_parser('prepare'); p.add_argument('--directory', required=True); p.add_argument('--font', default=FONT_DEFAULT)
    p = commands.add_parser('score'); p.add_argument('--manifest', required=True); p.add_argument('--responses', required=True); p.add_argument('--output', required=True)
    p = commands.add_parser('infer'); p.add_argument('--manifest', required=True); p.add_argument('--endpoint', required=True); p.add_argument('--metadata', required=True); p.add_argument('--token-env'); p.add_argument('--output', required=True); p.add_argument('--timeout', type=int, default=60)
    p = commands.add_parser('diagnose-legacy'); p.add_argument('--result', required=True); p.add_argument('--image', required=True); p.add_argument('--output', required=True)
    p = commands.choices['infer']
    p.add_argument('--prompt-version', choices=[PROMPT_VERSION, 'strict-fields-locators-v2'], default=PROMPT_VERSION)
    args = parser.parse_args()
    if args.command == 'prepare': prepare(args.directory, args.font)
    elif args.command == 'score': write_new(args.output, score(args.manifest, args.responses))
    elif args.command == 'diagnose-legacy': write_new(args.output, diagnose_legacy(args.result, args.image))
    else: infer(args.manifest, args.output, args.endpoint, args.token_env, args.metadata, args.timeout, args.prompt_version)


if __name__ == '__main__':
    main()
