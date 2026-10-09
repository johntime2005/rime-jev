"""Exercise failed switch preflight in Windows PowerShell without UAC or file replacement."""
import json
import os
from pathlib import Path
import subprocess
import tempfile
import unittest


ROOT = Path(__file__).resolve().parents[1]
POWERSHELL = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
WINDOWS_ENV = {key: value for key, value in os.environ.items() if key.upper() != 'PSMODULEPATH'}


@unittest.skipUnless(os.name == 'nt' and POWERSHELL.is_file(), 'Windows PowerShell is required')
class NativeSwitchTests(unittest.TestCase):
    def failed_preflight(self, text):
        with tempfile.TemporaryDirectory(prefix='rime-jev-switch-') as directory:
            root = Path(directory) / '\u6d4b\u8bd5'
            root.mkdir()
            receipt = root / 'replacement.json'
            receipt.write_text(text, encoding='utf-8')
            self.assertFalse(receipt.read_bytes().startswith(b'\xef\xbb\xbf'))
            completed = subprocess.run(
                [str(POWERSHELL), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                 '-File', str(ROOT / 'scripts/Switch-Native.ps1'), '-Receipt', str(receipt)],
                cwd=ROOT, capture_output=True, timeout=20,
                creationflags=subprocess.CREATE_NO_WINDOW,
                env=WINDOWS_ENV,
            )
            self.assertNotEqual(completed.returncode, 0)
            result = root / 'switch-result.json'
            self.assertTrue(result.is_file(), 'Preflight failure must leave a result before any system operation')
            state = json.loads(result.read_text(encoding='utf-8-sig'))
            self.assertEqual(state['phase'], 'failed')
            self.assertFalse(state['rollback'])
            self.assertEqual(receipt.read_text(encoding='utf-8'), text)
            self.assertEqual({p.name for p in root.iterdir()}, {'replacement.json', 'switch-result.json'})
            return state

    def test_bomless_utf8_receipt_reaches_format_check(self):
        # Reject the fixture's format before the authorization/registry/file paths,
        # including on CI hosts that already have an administrator token.
        text = json.dumps({'format': 0, 'writeError': '\u8c03\u7528\u201cOpen\u201d\u65f6\u53d1\u751f\u5f02\u5e38\uff1a\u201cdenied.\u201d'}, ensure_ascii=False)
        state = self.failed_preflight(text)
        self.assertIn('Unsupported replacement receipt.', state['message'])

    def test_malformed_receipt_leaves_failure_result(self):
        state = self.failed_preflight('{"format":')
        self.assertNotIn('Administrator authorization required.', state['message'])


if __name__ == '__main__':
    unittest.main()
