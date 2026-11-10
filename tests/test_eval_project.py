"""Offline evaluation infrastructure tests. No model load or network calls."""
import importlib.util
import json
from pathlib import Path
import tempfile
import unittest
from unittest.mock import patch

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('eval_project', ROOT / 'tools/eval_project.py')
e = importlib.util.module_from_spec(spec)
spec.loader.exec_module(e)
MANIFEST = ROOT / 'eval/fixtures/zh-reading-dev-v1/manifest.json'


class ProjectEvalTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory()
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        self.manifest, self.digest = e.load_manifest(MANIFEST)

    def response(self, index=0, fields=None, **extra):
        case = self.manifest['cases'][index]
        return {'id': case['id'], 'manifest_sha256': self.digest, 'image_sha256': case['sha256'],
                'text': json.dumps({'fields': fields if fields is not None else case['reference']}, ensure_ascii=False), **extra}

    def score(self, rows):
        path = self.root / 'answers.jsonl'
        path.write_text(''.join(json.dumps(row, ensure_ascii=False) + '\n' for row in rows))
        return e.score(MANIFEST, path)

    def test_manifest_truthful_provenance(self):
        self.assertEqual(len(self.manifest['cases']), 24)
        self.assertEqual(self.manifest['split_counts']['frozen_acceptance'], 0)
        self.assertEqual(self.manifest['provenance_counts']['consented_human'], 0)
        self.assertEqual(self.manifest['planned_formal_suite']['accepted_formal_samples'], 0)
        self.assertTrue(all(c['reference_review'] == 'author_defined_not_independently_reviewed' for c in self.manifest['cases']))

    def test_empty_stays_unrun(self):
        result = self.score([])
        self.assertIsNone(result['passed'])
        self.assertEqual(result['cases_run'], 0)
        self.assertTrue(all(c['passed'] is None for c in result['cases']))

    def test_perfect_is_only_development_diagnostic(self):
        result = self.score([self.response(i) for i in range(24)])
        self.assertEqual(result['cases_correct'], 24)
        self.assertEqual(result['field_values_correct'], 96)
        self.assertIsNone(result['passed'])
        self.assertFalse(result['production_eligible'])

    def test_explicit_non_stop_never_passes_even_with_perfect_fields(self):
        for finish in ('length', 'content_filter', 'tool_calls', 'unknown', False, 512):
            result = self.score([self.response(finish_reason=finish)])
            case = result['cases'][0]
            self.assertFalse(case['passed'])
            self.assertEqual(case['termination'], 'non_stop')
            self.assertTrue(case['schema_correct'])
            self.assertEqual(result['field_values_correct'], 4)
            self.assertEqual(result['cases_run'], 1)

    def test_unknown_finish_is_not_inferred_from_correct_fields_or_token_count(self):
        for extra in ({}, {'finish_reason': None, 'server_reported_usage': {'completion_tokens': 512}}):
            result = self.score([self.response(**extra)])
            self.assertEqual(result['cases'][0]['termination'], 'unknown')
            self.assertTrue(result['cases'][0]['passed'])  # Exact-field diagnostic only.
            self.assertIsNone(result['passed'])
            self.assertFalse(result['production_eligible'])
        self.assertEqual(self.score([self.response(finish_reason='stop')])['cases'][0]['termination'], 'stop')

    def test_omitted_specificity_fails(self):
        fields = dict(self.manifest['cases'][0]['reference'])
        fields['科目'] = {'value': '英语', 'locator': 'L2'}
        result = self.score([self.response(fields=fields)])
        self.assertFalse(result['cases'][0]['passed'])
        self.assertEqual(result['field_values_correct'], 3)

    def test_locator_wrong_fails_even_with_correct_value(self):
        fields = dict(self.manifest['cases'][0]['reference'])
        fields['科目'] = {'value': '英语口语', 'locator': 'L3'}
        self.assertFalse(self.score([self.response(fields=fields)])['cases'][0]['passed'])

    def test_absent_requires_null_not_guess(self):
        row = self.response(12)
        self.assertTrue(self.score([row])['cases'][12]['passed'])
        row['text'] = row['text'].replace('null', '"未知"')
        self.assertFalse(self.score([row])['cases'][12]['passed'])

    def test_score_or_extra_fields_not_accepted(self):
        row = self.response()
        value = json.loads(row['text']); value['score'] = 1
        row['text'] = json.dumps(value)
        self.assertFalse(self.score([row])['cases'][0]['schema_correct'])
        with self.assertRaises(ValueError): e.decode_answer('```json\n{}\n```')

    def test_hash_duplicates_unknown_rejected(self):
        for rows in ([self.response(), self.response()], [dict(self.response(), id='unknown')], [dict(self.response(), image_sha256='wrong')]):
            with self.assertRaises(ValueError): self.score(rows)

    def test_request_failure_is_not_model_quality_score(self):
        result = self.score([self.response(request_error='TimeoutError', text='')])
        self.assertEqual(result['cases_run'], 0)
        self.assertEqual(result['cases'][0]['status'], 'request_error')
        self.assertIsNone(result['cases'][0]['passed'])

    def test_legacy_omission_readonly(self):
        path = ROOT / 'eval/results/local-vision.json'
        digest = e.sha(path.read_bytes())
        result = e.diagnose_legacy(path, ROOT / 'eval/fixtures/study-card.png')
        self.assertEqual(result['correct_fields'], 3)
        self.assertFalse(result['field_check_passed'])
        self.assertIsNone(result['behavioral_passed'])
        self.assertEqual(e.sha(path.read_bytes()), digest)

    def test_no_overwrite(self):
        path = self.root / 'artifact.json'
        e.write_new(path, {})
        with self.assertRaises(FileExistsError): e.write_new(path, {})

    def test_explicit_local_endpoint_only(self):
        for endpoint in ('https://example.com/v1/chat/completions', 'http://user:pass@localhost/a', 'http://localhost/a?token=x'):
            with self.assertRaises(ValueError):
                e.infer(MANIFEST, self.root / 'out', endpoint, None, self.root / 'missing', 1)

    def test_infer_records_only_safe_server_resource_fields(self):
        import io
        metadata = self.root / 'metadata.json'
        metadata.write_text(json.dumps({key: 'test-only' for key in ('model_id', 'revision', 'quantization', 'hardware', 'framework', 'license', 'input_policy')}))
        response = {'choices': [{'message': {'content': '{}'}, 'finish_reason': 'length'}],
                    'usage': {'prompt_tokens': 20, 'completion_tokens': 512, 'total_tokens': 532, 'secret': 'must-not-record'}, 'evidence': {
            'inference_seconds': 1.25, 'process_rss_bytes': 1234,
            'mlx_peak_bytes': -1, 'secret': 'must-not-record'}}
        output = self.root / 'mock-responses.jsonl'
        with patch('urllib.request.OpenerDirector.open', side_effect=lambda *a, **kw: io.BytesIO(json.dumps(response).encode())):
            e.infer(MANIFEST, output, 'http://127.0.0.1:8791/v1/chat/completions', None, metadata, 1)
        rows = [json.loads(line) for line in output.read_text().splitlines()]
        self.assertEqual(len(rows), 24)
        self.assertEqual(rows[0]['server_reported_resources'], {'inference_seconds': 1.25, 'process_rss_bytes': 1234})
        self.assertEqual(rows[0]['finish_reason'], 'length')
        self.assertEqual(rows[0]['server_reported_usage'], {'prompt_tokens': 20, 'completion_tokens': 512, 'total_tokens': 532})
        self.assertNotIn('must-not-record', output.read_text())

    def test_usage_counts_do_not_infer_termination_or_accept_invalid_types(self):
        import io
        metadata = self.root / 'metadata.json'
        metadata.write_text(json.dumps({key: 'test-only' for key in ('model_id', 'revision', 'quantization', 'hardware', 'framework', 'license', 'input_policy')}))
        response = {'choices': [{'message': {'content': '{}'}, 'finish_reason': None}],
                    'usage': {'prompt_tokens': True, 'completion_tokens': 512, 'total_tokens': -1, 'secret': 'private'}}
        output = self.root / 'usage.jsonl'
        with patch('urllib.request.OpenerDirector.open', side_effect=lambda *a, **kw: io.BytesIO(json.dumps(response).encode())):
            e.infer(MANIFEST, output, 'http://127.0.0.1:8791/v1/chat/completions', None, metadata, 1)
        row = json.loads(output.read_text().splitlines()[0])
        self.assertEqual(row['server_reported_usage'], {'completion_tokens': 512})
        self.assertNotIn('finish_reason', row)
        self.assertNotIn('private', output.read_text())

    def test_prepare_reproduces_pixels_and_rejects_overwrite(self):
        target = self.root / 'cards'
        with patch('urllib.request.OpenerDirector.open', side_effect=AssertionError('network forbidden')):
            manifest = e.prepare(target, e.FONT_DEFAULT)
        self.assertEqual([c['sha256'] for c in manifest['cases']], [c['sha256'] for c in self.manifest['cases']])
        with self.assertRaises(FileExistsError): e.prepare(target, e.FONT_DEFAULT)


if __name__ == '__main__':
    unittest.main()
