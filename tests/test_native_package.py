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


if __name__ == '__main__':
    unittest.main()
