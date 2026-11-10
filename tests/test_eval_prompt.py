import unittest
from tools.eval_project import prompt, PROMPT_VERSION

class PromptVersionTests(unittest.TestCase):
    def test_default_preserves_v1(self):
        case = {'requested_fields': ['科目'], 'reference': {'科目': {'value': '秘密答案'}}}
        self.assertEqual(prompt(case), prompt(case, PROMPT_VERSION))
        self.assertNotIn('秘密答案', prompt(case, 'strict-fields-locators-v2'))

    def test_v2_has_required_shape_without_reference_access(self):
        text = prompt({'requested_fields': ['温度', '日期']}, 'strict-fields-locators-v2')
        self.assertIn('"fields":{"温度":{"value":null,"locator":null}', text)
        self.assertIn('Unicode', text)
        self.assertIn('L1', text)
        with self.assertRaises(ValueError):
            prompt({'requested_fields': []}, 'unknown')

if __name__ == '__main__':
    unittest.main()
