"""Build small, credential-free Windows ZIPs from an explicit file allowlist."""
import argparse
import hashlib
import importlib.util
import json
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import tempfile
import zipfile

ROOT = Path(__file__).resolve().parents[1]
spec = importlib.util.spec_from_file_location('native_package', ROOT / 'scripts/Package-Native.py')
native = importlib.util.module_from_spec(spec)
spec.loader.exec_module(native)


def digest(path):
    return hashlib.sha256(path.read_bytes()).hexdigest()


def checked_path(root, name):
    if not isinstance(name, str) or not name or re.search(r'[\\:<>"|?*\x00-\x1f]', name):
        raise ValueError(f'Unsafe package path: {name}')
    parts = name.split('/')
    if PurePosixPath(name).is_absolute() or any(
            part in ('', '.', '..') or part.endswith(('.', ' ')) or
            re.match(r'(?i)^(CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)', part) for part in parts):
        raise ValueError(f'Unsafe package path: {name}')
    root = root.resolve()
    path = root.joinpath(*parts)
    for parent in (path, *path.parents):
        if parent == root:
            break
        if parent.is_symlink() or getattr(parent, 'is_junction', lambda: False)():
            raise ValueError(f'Linked package input: {name}')
    if not path.resolve().is_relative_to(root):
        raise ValueError(f'Package path escapes root: {name}')
    return path


def source_files(root):
    names = json.loads((root / 'distribution-files.json').read_text(encoding='utf-8'))
    if not isinstance(names, list) or not names:
        raise ValueError('Empty distribution allowlist.')
    seen = set()
    for name in names:
        path = checked_path(root, name)
        if name.lower() in seen or not path.is_file():
            raise ValueError(f'Missing or duplicate distribution input: {name}')
        seen.add(name.lower())
        lower = name.lower()
        if (lower.split('/')[0] in ('runtime', 'upstream', 'tests', '.git', 'dist', 'exports') or
                path.suffix.lower() in ('.dpapi', '.log', '.pem', '.bin', '.dll', '.exe', '.pdb', '.zip') or
                path.name.lower() in ('config.json', 'installation.json', 'preferences', 'usage.json', 'status.json') or
                '.userdb' in lower or lower.startswith('.env') or lower.endswith('.custom.yaml')):
            raise ValueError(f'Private or generated file in distribution allowlist: {name}')
        if path.stat().st_size > 5 * 1024 * 1024:
            raise ValueError(f'Unexpected large source input: {name}')
    return sorted(names)


def package(output, version, native_bundle=None, root=ROOT):
    if not re.fullmatch(r'[A-Za-z0-9][A-Za-z0-9._-]{0,63}', version):
        raise ValueError('Version must be a simple release label.')
    names = source_files(root)
    variant = 'native-x64' if native_bundle else 'standard'
    stem = f'rime-jev-{version}-windows-{variant}'
    output = output.resolve()
    archive = output / f'{stem}.zip'
    checksums = output / f'{stem}.zip.sha256'
    if archive.exists() or checksums.exists():
        raise ValueError('Release output exists; choose a new directory or version.')
    revision = subprocess.check_output(['git', '-C', str(ROOT), 'rev-parse', 'HEAD'], text=True).strip()
    dirty = bool(subprocess.check_output(['git', '-C', str(ROOT), 'status', '--porcelain'], text=True).strip())
    bundle_manifest = None
    if native_bundle:
        native_bundle = native_bundle.resolve()
        bundle_manifest = native.verify(native_bundle)
        expected = set((*native.NATIVE_SOURCES, *native.BRIDGE_SOURCES, 'WeaselServer.exe', 'weaselx64.dll',
                        'lua/jev_windows.lua', 'rime_ice_jev.schema.yaml', 'native/LICENSE-GPL-3.0.txt',
                        'native/README.md', 'native/VALIDATION.md', 'native/CONTEXT.md'))
        if set(bundle_manifest['files']) != expected:
            raise ValueError('Native bundle file list differs from the distribution allowlist.')
        for name in (*native.NATIVE_SOURCES, *native.BRIDGE_SOURCES, 'lua/jev_windows.lua', 'rime_ice_jev.schema.yaml'):
            built = checked_path(native_bundle, name)
            current = checked_path(root, name)
            if built.read_bytes() != current.read_bytes():
                raise ValueError(f'Native bundle does not match release source: {name}')
        for name in ('WeaselServer.exe', 'weaselx64.dll'):
            native.check_x64(checked_path(native_bundle, name))
    with tempfile.TemporaryDirectory(prefix='rime-jev-release-') as temporary:
        stage = Path(temporary) / stem
        stage.mkdir()
        for name in names:
            target = checked_path(stage, name)
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(checked_path(root, name), target)
        if bundle_manifest:
            for name in (*bundle_manifest['files'], 'manifest.json'):
                target = checked_path(stage, f'native-bundle/{name}')
                target.parent.mkdir(parents=True, exist_ok=True)
                shutil.copy2(checked_path(native_bundle, name), target)
        files = sorted(path for path in stage.rglob('*') if path.is_file())
        manifest = {
            'format': 1, 'kind': 'windows-release', 'version': version, 'variant': variant,
            'source_revision': revision, 'source_dirty': dirty, 'native_experimental': bool(bundle_manifest),
            'gui_validated': False,
            'note': 'Hashes verify integrity, not publisher identity. Download from the trusted repository.',
            'files': {path.relative_to(stage).as_posix(): digest(path) for path in files},
        }
        if bundle_manifest:
            manifest['native_artifact_source'] = bundle_manifest.get('artifact_source')
            manifest['native_upstream_revision'] = bundle_manifest.get('upstream_revision')
        (stage / 'package-manifest.json').write_text(json.dumps(manifest, indent=2) + '\n', encoding='utf-8')
        output.mkdir(parents=True, exist_ok=True)
        with zipfile.ZipFile(archive, 'x', zipfile.ZIP_DEFLATED, compresslevel=9) as zip_file:
            for path in sorted(path for path in stage.rglob('*') if path.is_file()):
                entry = zipfile.ZipInfo(f'{stem}/{path.relative_to(stage).as_posix()}', (2026, 1, 1, 0, 0, 0))
                entry.compress_type = zipfile.ZIP_DEFLATED
                entry.external_attr = 0o100644 << 16
                zip_file.writestr(entry, path.read_bytes())
    checksums.write_text(f'{digest(archive)}  {archive.name}\n', encoding='ascii')
    return {'archive': str(archive), 'bytes': archive.stat().st_size, 'files': len(manifest['files']),
            'sha256': digest(archive), 'native_experimental': bool(native_bundle)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--version', required=True)
    parser.add_argument('--output', type=Path, default=ROOT / 'dist')
    parser.add_argument('--native-bundle', type=Path)
    args = parser.parse_args()
    print(json.dumps(package(args.output, args.version, args.native_bundle), indent=2))
