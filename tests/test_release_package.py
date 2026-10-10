"""Release allowlisting, integrity and reproducibility; no private runtime inputs."""
import importlib.util
import json
from pathlib import Path
import shutil
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('release_package', ROOT / 'scripts/Package-Release.py')
release = importlib.util.module_from_spec(spec)
spec.loader.exec_module(release)


class ReleasePackageTests(unittest.TestCase):
    def test_standard_archive_is_small_complete_and_reproducible(self):
        with tempfile.TemporaryDirectory(prefix='rime-jev-package-') as directory:
            root = Path(directory)
            first = release.package(root / 'a', 'test')
            second = release.package(root / 'b', 'test')
            self.assertEqual(first['sha256'], second['sha256'])
            self.assertLess(first['bytes'], 1024 * 1024)
            with zipfile.ZipFile(first['archive']) as archive:
                prefix = 'rime-jev-test-windows-standard/'
                manifest = json.loads(archive.read(prefix + 'package-manifest.json'))
                self.assertEqual(set(manifest['files']), set(release.source_files(ROOT)))
                self.assertEqual(set(archive.namelist()), {prefix + n for n in (*manifest['files'], 'package-manifest.json')})
                for name, expected in manifest['files'].items():
                    self.assertEqual(release.hashlib.sha256(archive.read(prefix + name)).hexdigest(), expected)
                self.assertFalse(manifest['native_experimental'])
                self.assertFalse(manifest['gui_validated'])
                self.assertIsInstance(manifest['source_dirty'], bool)
            with self.assertRaisesRegex(ValueError, 'output exists'):
                release.package(root / 'a', 'test')

    def test_rejects_windows_path_tricks_and_unsafe_versions(self):
        with tempfile.TemporaryDirectory(prefix='rime-jev-package-') as directory:
            root = Path(directory)
            for name in ('../escape', '/absolute', 'C:/drive', 'a\\b', 'a/../b', 'a//b', 'a./b',
                         'a /b', 'NUL.txt', 'x/COM1', 'a:stream', 'a?b', 'x\x00y'):
                with self.subTest(name=name), self.assertRaises(ValueError):
                    release.checked_path(root, name)
            for version in ('../x', 'a/b', '', 'x' * 65):
                with self.subTest(version=version), self.assertRaises(ValueError):
                    release.package(root, version)

    def test_private_generated_and_duplicate_files_are_rejected(self):
        with tempfile.TemporaryDirectory(prefix='rime-jev-package-') as directory:
            root = Path(directory)
            for name in ('runtime/log.txt', 'Runtime/log.txt', 'key.dpapi', 'config.json', '.env',
                         'rime_ice.userdb/LOG', 'personal.custom.yaml', 'weaselx64.dll', 'crash.log'):
                with self.subTest(name=name):
                    path = root / name
                    path.parent.mkdir(parents=True, exist_ok=True)
                    path.write_text('must not ship', encoding='ascii')
                    (root / 'distribution-files.json').write_text(json.dumps([name]), encoding='utf-8')
                    with self.assertRaisesRegex(ValueError, 'Private or generated'):
                        release.source_files(root)
            (root / 'ok.txt').write_text('safe', encoding='ascii')
            for names in ([], ['missing'], ['ok.txt', 'ok.txt']):
                (root / 'distribution-files.json').write_text(json.dumps(names), encoding='utf-8')
                with self.assertRaises(ValueError):
                    release.source_files(root)

    def test_checked_path_rejects_symlink_input_when_supported(self):
        with tempfile.TemporaryDirectory(prefix='rime-jev-package-') as directory:
            root = Path(directory)
            (root / 'source').write_text('source', encoding='ascii')
            try:
                (root / 'linked').symlink_to(root / 'source')
            except OSError:
                self.skipTest('Creating symbolic links is not permitted on this host')
            with self.assertRaisesRegex(ValueError, 'Linked'):
                release.checked_path(root, 'linked')

    def test_native_bundle_requires_current_bridge_and_exact_file_list(self):
        # Synthetic PE files test packaging only, not the native ABI or UI.
        native_spec = importlib.util.spec_from_file_location('native_test_fixture', ROOT / 'tests/test_native_package.py')
        fixture = importlib.util.module_from_spec(native_spec)
        native_spec.loader.exec_module(fixture)
        with tempfile.TemporaryDirectory(prefix='rime-jev-package-') as directory:
            root = Path(directory)
            fixture.PackageTests().artifact(root / 'artifact')
            bundle = root / 'bundle'
            release.native.package(root / 'artifact', bundle, 'synthetic-test-not-a-real-build')
            result = release.package(root / 'good', 'test', bundle)
            self.assertTrue(result['native_experimental'])
            manifest_path = bundle / 'manifest.json'
            manifest = json.loads(manifest_path.read_text(encoding='utf-8'))
            (bundle / 'provider-transport.mjs').write_text('outdated but self-consistent', encoding='ascii')
            manifest['files']['provider-transport.mjs'] = release.digest(bundle / 'provider-transport.mjs')
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'does not match release source'):
                release.package(root / 'bad', 'test', bundle)
            shutil.copy2(ROOT / 'provider-transport.mjs', bundle / 'provider-transport.mjs')
            manifest['files']['provider-transport.mjs'] = release.digest(bundle / 'provider-transport.mjs')
            (bundle / 'key.dpapi').write_text('never include this', encoding='ascii')
            manifest['files']['key.dpapi'] = release.digest(bundle / 'key.dpapi')
            manifest_path.write_text(json.dumps(manifest), encoding='utf-8')
            with self.assertRaisesRegex(ValueError, 'file list differs'):
                release.package(root / 'bad', 'test', bundle)


if __name__ == '__main__':
    unittest.main()
