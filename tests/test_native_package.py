import importlib.util
import json
from pathlib import Path
import struct
import tempfile
import unittest

spec = importlib.util.spec_from_file_location('native_package', Path(__file__).resolve().parents[1] / 'scripts/Package-Native.py')
module = importlib.util.module_from_spec(spec)
spec.loader.exec_module(module)


class PackageTests(unittest.TestCase):
    def artifact(self, root):
        for name in module.NATIVE_SOURCES:
            target = root / name
            target.parent.mkdir(parents=True, exist_ok=True)
            target.write_bytes((module.ROOT / name).read_bytes())
        data = bytearray(128)
        data[:2] = b'MZ'
        struct.pack_into('<I', data, 60, 64)
        data[64:68] = b'PE\0\0'
        struct.pack_into('<H', data, 68, 0x8664)
        for name in ('WeaselServer.exe', 'weaselx64.dll'):
            binary = root / 'upstream/weasel/output' / name
            binary.parent.mkdir(parents=True, exist_ok=True)
            binary.write_bytes(data)

    def test_pe_architecture(self):
        with tempfile.TemporaryDirectory() as directory:
            binary = Path(directory) / 'sample.dll'
            data = bytearray(128)
            data[:2] = b'MZ'
            struct.pack_into('<I', data, 60, 64)
            data[64:68] = b'PE\0\0'
            struct.pack_into('<H', data, 68, 0x8664)
            binary.write_bytes(data)
            module.check_x64(binary)
            struct.pack_into('<H', data, 68, 0x14c)
            binary.write_bytes(data)
            with self.assertRaises(ValueError):
                module.check_x64(binary)
            binary.write_bytes(b'MZ')
            with self.assertRaises(ValueError):
                module.check_x64(binary)

    def test_integrity_and_traversal(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            target = root / 'adapter.lua'
            target.write_text('original')
            manifest = {'format': 1, 'files': {'adapter.lua': module.digest(target)}}
            (root / 'manifest.json').write_text(json.dumps(manifest))
            module.verify(root)
            target.write_text('changed')
            with self.assertRaises(ValueError):
                module.verify(root)
            manifest['files'] = {'../outside': 'unused'}
            (root / 'manifest.json').write_text(json.dumps(manifest))
            with self.assertRaises(ValueError):
                module.verify(root)

    def test_mismatched_patch_does_not_create_output(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            (root / 'native').mkdir()
            (root / 'native/weasel-jev.patch').write_text('wrong patch')
            with self.assertRaises(ValueError):
                module.package(root, root / 'output', 'test')
            self.assertFalse((root / 'output').exists())

    def test_missing_or_mismatched_native_headers_do_not_create_output(self):
        for name in module.NATIVE_SOURCES[1:]:
            for missing in (False, True):
                with self.subTest(name=name, missing=missing), tempfile.TemporaryDirectory() as directory:
                    root = Path(directory)
                    self.artifact(root)
                    if missing:
                        (root / name).unlink()
                    else:
                        (root / name).write_text('outdated header', encoding='ascii')
                    with self.assertRaisesRegex(ValueError, name):
                        module.package(root, root / 'output', 'synthetic-test')
                    self.assertFalse((root / 'output').exists())

    def test_matched_bundle_includes_native_headers_and_bridge_dependencies(self):
        with tempfile.TemporaryDirectory() as directory:
            root = Path(directory)
            self.artifact(root)
            for name in module.NATIVE_SOURCES:
                target = root / name
                target.write_bytes(target.read_bytes().replace(b'\r\n', b'\n').replace(b'\n', b'\r\n'))
            output = root / 'output'
            manifest = module.package(root, output, 'synthetic-test-not-a-native-build')
            for name in (*module.NATIVE_SOURCES, *module.BRIDGE_SOURCES, 'native/CONTEXT.md'):
                self.assertEqual(manifest['files'][name], module.digest(module.ROOT / name))
                self.assertEqual((output / name).read_bytes(), (module.ROOT / name).read_bytes())
            self.assertFalse(manifest['gui_validated'])
            module.verify(output)
            with self.assertRaisesRegex(ValueError, 'Output already exists'):
                module.package(root, output, 'synthetic-test')
            (output / 'native/include/JevEditSession.h').write_text('changed', encoding='ascii')
            with self.assertRaises(ValueError):
                module.verify(output)


if __name__ == '__main__':
    unittest.main()
