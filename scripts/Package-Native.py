"""Stage a matched experimental bundle without touching installed input methods."""
import argparse
import hashlib
import json
from pathlib import Path
import shutil
import struct
import subprocess

ROOT = Path(__file__).resolve().parents[1]
UPSTREAM_REVISION = '9cc96e20dc71b80876b12f689bb5863c76c2a7ed'


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def check_x64(path):
    data = path.read_bytes()
    if len(data) < 64 or data[:2] != b'MZ':
        raise ValueError(f'Not a PE binary: {path.name}')
    offset = struct.unpack_from('<I', data, 60)[0]
    if offset + 6 > len(data) or data[offset:offset + 4] != b'PE\0\0':
        raise ValueError(f'Invalid PE header: {path.name}')
    if struct.unpack_from('<H', data, offset + 4)[0] != 0x8664:
        raise ValueError(f'Not an x64 binary: {path.name}')


def package(artifact, output, source_label):
    artifact, output = artifact.resolve(), output.resolve()
    # Text checkout line endings differ between GitHub and local Windows Git.
    patch = ROOT / 'native/weasel-jev.patch'
    if (artifact / 'native/weasel-jev.patch').read_bytes().replace(b'\r\n', b'\n') != patch.read_bytes().replace(b'\r\n', b'\n'):
        raise ValueError('Artifact patch does not match the current native source.')
    files = {
        'WeaselServer.exe': artifact / 'upstream/weasel/output/WeaselServer.exe',
        'weaselx64.dll': artifact / 'upstream/weasel/output/weaselx64.dll',
        'lua/jev_windows.lua': ROOT / 'lua/jev_windows.lua',
        'rime_ice_jev.schema.yaml': ROOT / 'rime_ice_jev.schema.yaml',
        'native/weasel-jev.patch': patch,
        'native/LICENSE-GPL-3.0.txt': ROOT / 'native/LICENSE-GPL-3.0.txt',
        'native/README.md': ROOT / 'native/README.md',
        'native/VALIDATION.md': ROOT / 'native/VALIDATION.md',
    }
    for name, path in files.items():
        if not path.is_file():
            raise ValueError(f'Missing bundle input: {name}')
    for name in ('WeaselServer.exe', 'weaselx64.dll'):
        check_x64(files[name])
    if output.exists():
        raise ValueError('Output already exists; choose a fresh directory.')
    revision = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    manifest = {
        'format': 1,
        'experimental': True,
        'gui_validated': False,
        'upstream_revision': UPSTREAM_REVISION,
        'adapter_revision': revision,
        'artifact_source': source_label,
        'note': 'Source label is caller supplied, not a signature. File hashes identify working-tree inputs.',
        'files': {name: digest(path) for name, path in files.items()},
    }
    output.mkdir(parents=True)
    for name, path in files.items():
        target = output / name
        target.parent.mkdir(parents=True, exist_ok=True)
        shutil.copy2(path, target)
    (output / 'manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
    verify(output)
    return manifest


def verify(bundle):
    bundle = bundle.resolve()
    manifest = json.loads((bundle / 'manifest.json').read_text(encoding='utf-8'))
    if manifest.get('format') != 1 or not manifest.get('files'):
        raise ValueError('Unsupported or empty manifest.')
    for name, expected in manifest['files'].items():
        path = (bundle / name).resolve()
        if not path.is_relative_to(bundle) or not path.is_file() or digest(path) != expected:
            raise ValueError(f'Bundle integrity check failed: {name}')
    return manifest


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--artifact', type=Path)
    parser.add_argument('--output', type=Path)
    parser.add_argument('--source-label')
    parser.add_argument('--verify', type=Path)
    args = parser.parse_args()
    if args.verify:
        verify(args.verify)
        print('Bundle hashes verified (not a GUI acceptance test).')
    elif args.artifact and args.output and args.source_label:
        package(args.artifact, args.output, args.source_label)
        print(f'Experimental bundle staged: {args.output}')
    else:
        parser.error('Use --verify BUNDLE or --artifact DIR --output DIR --source-label LABEL.')
