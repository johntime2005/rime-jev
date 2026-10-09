import importlib.util
from pathlib import Path
import re
import unittest

spec = importlib.util.spec_from_file_location('typing_profile', Path(__file__).resolve().parents[1] / 'scripts/Typing-Profile.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class TypingProfileTests(unittest.TestCase):
    def test_defaults_do_not_enable_fuzzy(self):
        text = module.profile([])
        self.assertNotIn('derive/', text)
        self.assertIn('translator/user_dict: rime_ice', text)
        self.assertIn('translator/prism: rime_ice_jev', text)
        self.assertNotIn('speller/algebra:', text)

    def test_only_selected_pairs_and_unique_patch_paths(self):
        text = module.profile(['z-zh', 'in-ing', 'z-zh'])
        self.assertEqual(text.count('speller/algebra/@before'), 4)
        self.assertIn('derive/^zh/z/', text)
        self.assertNotIn('derive/^n/l/', text)
        for index in range(4):
            self.assertEqual(text.count(f'@before {index}'), 1)

    def test_rejects_unknown_pairs(self):
        with self.assertRaises(ValueError):
            module.profile(['all'])

    def test_nasal_preset_covers_both_directions_without_other_fuzzy_pairs(self):
        self.assertEqual(module.NASAL_PAIRS, ['an-ang', 'en-eng', 'in-ing'])
        text = module.profile(module.NASAL_PAIRS)
        self.assertEqual(text.count('speller/algebra/@before'), 6)
        rules = [rule for pair in module.NASAL_PAIRS for rule in module.FUZZY[pair]]

        def derive(spelling):
            variants = {spelling}
            for rule in rules:
                _, pattern, replacement, _ = rule.split('/')
                variants |= {re.sub(pattern, replacement, value) for value in variants}
            return variants

        for front, back in [('ban', 'bang'), ('ren', 'reng'), ('jin', 'jing'),
                            ('xian', 'xiang'), ('guan', 'guang')]:
            self.assertEqual(derive(front), {front, back})
            self.assertEqual(derive(back), {front, back})
        for unchanged in ['zhi', 'zi', 'chi', 'ci', 'shi', 'si', 'li', 'ni', 'fu', 'hu']:
            self.assertEqual(derive(unchanged), {unchanged})


if __name__ == '__main__':
    unittest.main()
