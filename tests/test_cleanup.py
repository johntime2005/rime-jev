"""Exercise cleanup only in disposable Git workspaces, never the live IME."""
import hashlib
import ctypes
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
POWERSHELL = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'


@unittest.skipUnless(os.name == 'nt' and POWERSHELL.is_file() and shutil.which('git'), 'Windows PowerShell and Git required')
class CleanupTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='rime-jev-cleanup-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name)
        (self.root / 'tests').mkdir()
        (self.root / 'tests/native_rime.py').write_text('# Disposable fixture\n', encoding='ascii')
        subprocess.run(['git', 'init', '-q', str(self.root)], check=True, capture_output=True)
        self.build = self.root / 'runtime/native-aabbccdd/rime/build'
        self.build.mkdir(parents=True)
        (self.build / 'compiled.bin').write_bytes(b'generated index')
        self.kept = {}
        for name in ('runtime/native-aabbccdd/result.json', 'runtime/native-bundle/WeaselServer.exe',
                     'runtime/native-not-a-trial/rime/build/keep.bin', 'backups/important.bin'):
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_bytes(b'keep exactly')
            self.kept[path] = path.read_bytes()
        self.env = {k: v for k, v in os.environ.items() if k.upper() != 'PSMODULEPATH'}

    def cleanup(self, *options, success=True):
        result = subprocess.run([str(POWERSHELL), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                                 '-File', str(ROOT / 'scripts/Clean-Runtime.ps1'), '-Workspace', str(self.root),
                                 '-MinimumAgeMinutes', '0', *options], env=self.env, capture_output=True,
                                creationflags=subprocess.CREATE_NO_WINDOW, timeout=60)
        output = (result.stdout + result.stderr).decode('utf-8', errors='replace')
        self.assertEqual(result.returncode == 0, success, output)
        for path, content in self.kept.items():
            self.assertEqual(path.read_bytes(), content)
        return output

    def test_preview_whatif_and_apply_keep_evidence_and_backups(self):
        self.cleanup()
        self.assertTrue(self.build.exists())
        self.cleanup('-Apply', '-WhatIf')
        self.assertTrue(self.build.exists())
        self.assertFalse(list((self.root / 'runtime').glob('cleanup-*.json')))
        self.cleanup('-Apply')
        self.assertFalse(self.build.exists())
        report = next((self.root / 'runtime').glob('cleanup-*.json'))
        targets = json.loads(report.read_text(encoding='utf-8'))['targets']
        self.assertEqual(len(targets), 1)
        self.assertTrue(targets[0]['removed'])

    def test_live_process_reference_prevents_removal(self):
        scope = self.build.parents[1]
        child = subprocess.Popen([str(POWERSHELL), '-NoProfile', '-Command',
                                  '# ' + str(scope) + '\nStart-Sleep -Seconds 60'], env=self.env,
                                 stdout=subprocess.DEVNULL, stderr=subprocess.DEVNULL,
                                 creationflags=subprocess.CREATE_NO_WINDOW)
        try:
            self.assertIn('live process', self.cleanup('-Apply'))
            self.assertTrue(self.build.exists())
        finally:
            child.terminate()
            child.wait(timeout=10)

    def test_linked_child_is_rejected_without_touching_its_target(self):
        protected = self.root / 'backups/important.bin'
        try:
            (self.build / 'linked.bin').symlink_to(protected)
        except OSError:
            self.skipTest('Creating symbolic links is not permitted on this host')
        self.cleanup('-Apply', success=False)
        self.assertTrue(self.build.exists())

    def test_workspace_short_alias_resolves_before_containment_checks(self):
        buffer = ctypes.create_unicode_buffer(32768)
        length = ctypes.windll.kernel32.GetShortPathNameW(str(self.root), buffer, len(buffer))
        if not length or '~' not in buffer.value:
            self.skipTest('8.3 aliases are disabled on this filesystem')
        self.root = Path(buffer.value)
        self.cleanup('-Apply')
        self.assertFalse(self.build.exists())

    def test_optional_caches_require_receipts_and_preserve_reports(self):
        trial = self.root / 'runtime/migration-smoke-11223344'
        for name in ('Rime/build', 'Rime/cn_dicts', 'Rime/en_dicts', 'Rime/opencc', 'Local/RimeJev'):
            (trial / name).mkdir(parents=True)
        for name in ('build', 'cn_dicts', 'en_dicts', 'opencc'):
            (trial / 'Rime' / name / 'generated').write_bytes(b'rebuildable')
        (trial / 'compile-result.json').write_text(json.dumps({
            'pinned_ice_compiled': True, 'real_user_database_opened': False}), encoding='ascii')
        (trial / 'Local/RimeJev/installation.json').write_text(json.dumps({
            'rime': str(trial / 'Rime'), 'weasel': str(trial / 'Weasel')}), encoding='ascii')
        browser = self.root / 'runtime/zen-context-check-20261010'
        (browser / 'profile').mkdir(parents=True)
        (browser / 'profile/cache').write_bytes(b'temporary browser cache')
        (browser / 'browser_probe.py').write_text(
            '# Disposable Zen URL-bar probe.\nPROFILE = ROOT / \'profile\'\n', encoding='ascii')
        revision = 'a' * 40
        cache = self.root / 'runtime/distribution-deps'
        cache.mkdir()
        archive = cache / ('rime-ice-' + revision + '.zip')
        archive.write_bytes(b'disposable pinned download')
        (self.root / 'dependencies.lock.json').write_text(json.dumps({'rimeIce': {
            'revision': revision, 'sha256': hashlib.sha256(archive.read_bytes()).hexdigest()}}), encoding='ascii')
        self.cleanup('-Apply')
        self.assertTrue(archive.exists())
        self.assertTrue((trial / 'Rime/build/generated').exists())
        self.assertTrue((browser / 'profile/cache').exists())
        self.cleanup('-Apply', '-IncludeDisposableCaches', '-IncludeDownloads')
        self.assertFalse(archive.exists())
        self.assertFalse((trial / 'Rime/build').exists())
        self.assertFalse((browser / 'profile').exists())
        self.assertTrue((trial / 'compile-result.json').exists())
        self.assertTrue((trial / 'Local/RimeJev/installation.json').exists())
        self.assertTrue((browser / 'browser_probe.py').exists())


if __name__ == '__main__':
    unittest.main()
