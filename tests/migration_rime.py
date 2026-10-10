"""Opt-in clean-install smoke with real librime, pinned downloads and disposable data.

Does not deploy, register, start or replace the installed Windows input method.
All installer paths, environment variables and librime user data are isolated.
"""
import argparse
import ctypes as C
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import winreg

ROOT = Path(__file__).resolve().parents[1]
POWERSHELL = Path(os.environ['WINDIR']) / 'System32/WindowsPowerShell/v1.0/powershell.exe'
spec = importlib.util.spec_from_file_location('rime_test_types', ROOT / 'tests/native_rime.py')
rime = importlib.util.module_from_spec(spec)
spec.loader.exec_module(rime)


def compile_schemas(install, root):
    data = root / 'Rime'
    # Defense in depth: do not let Lua discover the daily-use bridge via its default.
    schema = data / 'rime_ice_jev.schema.yaml'
    with schema.open('a', encoding='utf-8') as file:
        file.write('\n  - jev_windows/runtime_dir: ' + json.dumps((root / 'Local/RimeJev/runtime').as_posix()) + '\n')
    dll = C.CDLL(str(install / 'rime.dll'))

    def fn(name, result, *args):
        func = getattr(dll, name)
        func.restype, func.argtypes = result, list(args)
        return func

    setup = fn('RimeSetup', None, C.POINTER(rime.Traits))
    deployer = fn('RimeDeployerInitialize', None, C.POINTER(rime.Traits))
    deploy_config = fn('RimeDeployConfigFile', C.c_int, C.c_char_p, C.c_char_p)
    deploy_schema = fn('RimeDeploySchema', C.c_int, C.c_char_p)
    initialize = fn('RimeInitialize', None, C.POINTER(rime.Traits))
    finalize = fn('RimeFinalize', None)
    create = fn('RimeCreateSession', C.c_size_t)
    select = fn('RimeSelectSchema', C.c_int, C.c_size_t, C.c_char_p)
    process = fn('RimeProcessKey', C.c_int, C.c_size_t, C.c_int, C.c_int)
    get_context = fn('RimeGetContext', C.c_int, C.c_size_t, C.POINTER(rime.Context))
    free_context = fn('RimeFreeContext', C.c_int, C.POINTER(rime.Context))
    traits = rime.Traits()
    traits.data_size = C.sizeof(traits) - C.sizeof(C.c_int)
    traits.shared_data_dir, traits.user_data_dir = str(install / 'data').encode(), str(data).encode()
    traits.app_name, traits.min_log_level, traits.log_dir = b'rime.migrationtest', 1, str(root).encode()
    modules = (C.c_char_p * 5)(b'deployer', b'default', b'lua', b'grammar', None)
    traits.modules = modules
    setup(C.byref(traits))
    deployer(C.byref(traits))
    assert deploy_config(b'default.yaml', b'config_version'), 'default configuration failed'
    for name in ('melt_eng', 'radical_pinyin', 'rime_ice', 'rime_ice_jev'):
        assert deploy_schema(str(data / (name + '.schema.yaml')).encode()), name + ' did not compile'
        print('Compiled pinned dependency:', name, flush=True)
    initialize(C.byref(traits))
    try:
        sid = create()
        assert sid and select(sid, b'rime_ice_jev')
        for char in 'zhongguo':
            process(sid, ord(char), 0)
        ctx = rime.Context()
        ctx.data_size = C.sizeof(ctx) - C.sizeof(C.c_int)
        assert get_context(sid, C.byref(ctx))
        try:
            candidates = [(ctx.menu.candidates[i].text or b'').decode() for i in range(ctx.menu.num_candidates)]
            assert '\u4e2d\u56fd' in candidates
        finally:
            free_context(C.byref(ctx))
        assert not list((root / 'Local/RimeJev/runtime/inbox').glob('*.json')), 'offline smoke published a request'
    finally:
        finalize()


def main(ice_archive=None, portable_node=False):
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\WOW6432Node\Rime\Weasel') as key:
        install = Path(winreg.QueryValueEx(key, 'WeaselRoot')[0])
    with tempfile.TemporaryDirectory(prefix='rime-jev-migration-') as temporary:
        root = Path(temporary)
        for name in ('Rime', 'Weasel', 'Local/RimeJev/downloads'):
            (root / name).mkdir(parents=True)
        for name in ('rime.dll', 'WeaselDeployer.exe'):
            (root / 'Weasel' / name).write_bytes(b'NOT EXECUTABLE; SMOKE USES NODEPLOY')
        original = b'patch:\n  schema_list:\n    - {schema: luna_pinyin}\n  menu/page_size: 7\n'
        (root / 'Rime/default.custom.yaml').write_bytes(original)
        (root / 'Rime/weasel.custom.yaml').write_text('patch: {style/color_scheme: native}\n', encoding='ascii')
        if ice_archive:
            lock = json.loads((ROOT / 'dependencies.lock.json').read_text(encoding='utf-8'))
            shutil.copy2(ice_archive, root / 'Local/RimeJev/downloads' / ('rime-ice-' + lock['rimeIce']['revision'] + '.zip'))
        env = {k: v for k, v in os.environ.items() if k.upper() not in ('PSMODULEPATH', 'TYPESAFE_API_KEY')}
        env.update(LOCALAPPDATA=str(root / 'Local'), APPDATA=str(root / 'Roaming'))
        if portable_node:
            env['PATH'] = os.pathsep.join((str(Path(os.environ['WINDIR']) / 'System32'), os.environ['WINDIR']))
        subprocess.run([str(POWERSHELL), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                        '-File', str(ROOT / 'scripts/Install-Windows.ps1'), '-RimeUserDir', str(root / 'Rime'),
                        '-WeaselRoot', str(root / 'Weasel'), '-NoConfigure', '-NoDeploy', '-NoStart',
                        '-NoAutostart', '-NoShortcuts'], env=env, check=True, timeout=600,
                       creationflags=subprocess.CREATE_NO_WINDOW)
        assert (root / 'Rime/lua/lunar.db').is_file(), 'pinned lunar calendar data was not installed'
        assert not (root / 'Rime/default.yaml').exists(), 'global defaults were overwritten'
        assert not (root / 'Local/RimeJev/key.dpapi').exists()
        assert 'luna_pinyin' in (root / 'Rime/default.custom.yaml').read_text(encoding='utf-8')
        # A child owns librime mappings, so all generated indices can be removed on exit.
        subprocess.run([os.sys.executable, '-X', 'utf8', str(Path(__file__).resolve()), '--compile-root', str(root),
                        '--weasel', str(install)], env=env, check=True, timeout=300,
                       creationflags=subprocess.CREATE_NO_WINDOW)
        print(json.dumps({'pinned_ice_compiled': True, 'portable_node_downloaded': portable_node,
                          'jev_schema_selectable': True, 'local_candidate_present': True,
                          'real_user_database_opened': False, 'cloud_calls': 0, 'gui_tested': False}), flush=True)
    print('Disposable install, downloaded dependencies and compiled dictionaries removed.', flush=True)


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('--ice-archive', type=Path, help='Reuse the pinned upstream archive; its hash is still verified.')
    parser.add_argument('--portable-node', action='store_true', help='Hide system Node and exercise its HTTPS download.')
    parser.add_argument('--compile-root', type=Path, help=argparse.SUPPRESS)
    parser.add_argument('--weasel', type=Path, help=argparse.SUPPRESS)
    args = parser.parse_args()
    if args.compile_root:
        if not args.weasel:
            parser.error('--compile-root requires --weasel')
        compile_schemas(args.weasel, args.compile_root)
    else:
        main(args.ice_archive, args.portable_node)
