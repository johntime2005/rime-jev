"""Integration test against installed rime.dll, with isolated dictionaries and mock IPC.

Never opens the real user database and never calls a network provider.
"""
import ctypes as C
import argparse
import json
import os
from pathlib import Path
import shutil
import subprocess
import time
import uuid
import winreg


class Traits(C.Structure):
    _fields_ = [('data_size', C.c_int)] + [(n, C.c_char_p) for n in (
        'shared_data_dir', 'user_data_dir', 'distribution_name',
        'distribution_code_name', 'distribution_version', 'app_name')]
    _fields_ += [('modules', C.POINTER(C.c_char_p)), ('min_log_level', C.c_int)]
    _fields_ += [(n, C.c_char_p) for n in ('log_dir', 'prebuilt_data_dir', 'staging_dir')]


class Composition(C.Structure):
    _fields_ = [(n, C.c_int) for n in ('length', 'cursor_pos', 'sel_start', 'sel_end')] + [('preedit', C.c_char_p)]


class Candidate(C.Structure):
    _fields_ = [('text', C.c_char_p), ('comment', C.c_char_p), ('reserved', C.c_void_p)]


class Menu(C.Structure):
    _fields_ = [(n, C.c_int) for n in ('page_size', 'page_no', 'is_last_page', 'highlighted_candidate_index', 'num_candidates')]
    _fields_ += [('candidates', C.POINTER(Candidate)), ('select_keys', C.c_char_p)]


class Context(C.Structure):
    _fields_ = [('data_size', C.c_int), ('composition', Composition), ('menu', Menu),
                ('commit_text_preview', C.c_char_p), ('select_labels', C.POINTER(C.c_char_p))]


class Commit(C.Structure):
    _fields_ = [('data_size', C.c_int), ('text', C.c_char_p)]


def run(context_test=False):
    project = Path(__file__).resolve().parents[1]
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\WOW6432Node\Rime\Weasel') as k:
        install = Path(winreg.QueryValueEx(k, 'WeaselRoot')[0])
    user = Path(os.environ['APPDATA']) / 'Rime'
    root = project / 'runtime' / ('native-' + uuid.uuid4().hex[:8])
    data, bridge_root = root / 'rime', root / 'bridge'
    data.mkdir(parents=True)
    (data / 'lua').mkdir()
    shutil.copytree(user / 'build', data / 'build')
    shutil.copy2(project / 'lua/jev_windows.lua', data / 'lua/jev_windows.lua')
    schema = (project / 'rime_ice_jev.schema.yaml').read_text()
    schema += '\n  jev_windows/runtime_dir: ' + json.dumps((bridge_root / 'runtime').as_posix()) + '\n'
    if context_test:
        schema = schema.replace('jev_windows/context_apps: []', 'jev_windows/context_apps: [jev-context-test.exe]')
    (data / 'rime_ice_jev.schema.yaml').write_text(schema)
    existing_default = (user / 'default.custom.yaml').read_text(encoding='utf-8-sig')
    if 'rime_ice_jev' not in existing_default:
        existing_default = existing_default.rstrip() + '\n  "schema_list/+":\n    - {schema: rime_ice_jev}\n'
    (data / 'default.custom.yaml').write_text(existing_default, encoding='utf-8')
    node_script = f"import {{startBridge}} from {json.dumps((project / 'bridge.mjs').as_uri())}; const b=await startBridge({{root:{json.dumps(str(bridge_root))},mock:true}}); await b.done;"
    child = subprocess.Popen(['node', '--input-type=module', '-e', node_script],
                             creationflags=subprocess.CREATE_NO_WINDOW,
                             stdout=subprocess.DEVNULL, stderr=subprocess.PIPE)
    dll = C.CDLL(str(install / 'rime.dll'))
    def fn(name, result, *args):
        f = getattr(dll, name)
        f.restype, f.argtypes = result, list(args)
        return f
    setup = fn('RimeSetup', None, C.POINTER(Traits))
    initialize = fn('RimeInitialize', None, C.POINTER(Traits))
    deployer = fn('RimeDeployerInitialize', None, C.POINTER(Traits))
    deploy_schema = fn('RimeDeploySchema', C.c_int, C.c_char_p)
    deploy_config = fn('RimeDeployConfigFile', C.c_int, C.c_char_p, C.c_char_p)
    create = fn('RimeCreateSession', C.c_size_t)
    select = fn('RimeSelectSchema', C.c_int, C.c_size_t, C.c_char_p)
    process = fn('RimeProcessKey', C.c_int, C.c_size_t, C.c_int, C.c_int)
    set_property = fn('RimeSetProperty', None, C.c_size_t, C.c_char_p, C.c_char_p)
    get_property = fn('RimeGetProperty', C.c_int, C.c_size_t, C.c_char_p, C.c_char_p, C.c_size_t)
    get_context = fn('RimeGetContext', C.c_int, C.c_size_t, C.POINTER(Context))
    free_context = fn('RimeFreeContext', C.c_int, C.POINTER(Context))
    get_commit = fn('RimeGetCommit', C.c_int, C.c_size_t, C.POINTER(Commit))
    free_commit = fn('RimeFreeCommit', C.c_int, C.POINTER(Commit))
    finalize = fn('RimeFinalize', None)
    traits = Traits()
    traits.data_size = C.sizeof(Traits) - C.sizeof(C.c_int)
    traits.shared_data_dir, traits.user_data_dir = str(install / 'data').encode(), str(data).encode()
    traits.app_name, traits.min_log_level, traits.log_dir = b'rime.jevtest', 1, str(root).encode()
    modules = (C.c_char_p * 5)(b'deployer', b'default', b'lua', b'grammar', None)
    traits.modules = modules
    initialized = False
    try:
        setup(C.byref(traits))
        deployer(C.byref(traits))
        assert deploy_config(b'default.yaml', b'config_version'), 'default config did not compile'
        compiled_default = (data / 'build/default.yaml').read_text(encoding='utf-8')
        assert 'schema: rime_ice\n' in compiled_default and 'schema: rime_ice_jev\n' in compiled_default
        assert deploy_schema(str(data / 'rime_ice_jev.schema.yaml').encode()), 'schema did not compile'
        initialize(C.byref(traits)); initialized = True
        sid = create()
        assert sid and select(sid, b'rime_ice_jev'), 'schema not selectable'
        def key(code, mask=0):
            return process(sid, ord(code) if isinstance(code, str) else code, mask)
        def menu():
            ctx = Context(); ctx.data_size = C.sizeof(Context) - C.sizeof(C.c_int)
            assert get_context(sid, C.byref(ctx))
            try:
                return {'page': ctx.menu.page_no, 'items': [
                    ((ctx.menu.candidates[i].text or b'').decode(), (ctx.menu.candidates[i].comment or b'').decode())
                    for i in range(ctx.menu.num_candidates)]}
            finally: free_context(C.byref(ctx))
        for _ in range(50):
            if (bridge_root / 'runtime/bridge.info').exists(): break
            time.sleep(.1)
        if context_test:
            preferences = bridge_root / 'runtime/preferences'
            preferences.write_text('JEVPREF1\n1\n1\n', encoding='ascii', newline='\n')
            set_property(sid, b'client_app', b'jev-context-test.exe')
            set_property(sid, b'client_type', b'tsf')
            inbox, outbox = bridge_root / 'runtime/inbox', bridge_root / 'runtime/outbox'
            def prop(name, value):
                set_property(sid, name.encode(), value.encode())
            def getprop(name):
                buf = C.create_string_buffer(2048)
                get_property(sid, name.encode(), buf, len(buf))
                return buf.value.decode()
            def wire(stamp, text='', quality='exact'):
                encoded = text.encode('utf-16-be').hex()
                return f'JCTX1|{stamp}|{quality}|{encoded}'
            def wait_result():
                for _ in range(100):
                    files = list(outbox.glob('*.res'))
                    if files: return files[0]
                    time.sleep(.04)
                raise AssertionError('no result')
            prop('jev_context', 'pending')
            for letter in 'jingli': key(letter)
            original = menu()
            assert '[Jev: pending]' in original['items'][0][1], 'context capture must start the native timer'
            assert not list(inbox.glob('*.json')), 'must wait for native context'
            prop('jev_context_query', '1')
            assert getprop('jev_context_consent') == '1', 'allowlist consent not granted'
            prefix = '\u4f60\u597d  \nemoji \U0001f600'
            prop('jev_context', wire('1-1-1', prefix))
            prop('jev_refresh', 'captured')
            submitted = json.loads(next(inbox.glob('*.json')).read_text(encoding='utf-8'))
            assert submitted['context'] == prefix and submitted['document']['stamp'] == '1-1-1'
            result = wait_result()
            assert result.read_text().splitlines()[-1] == '1-1-1'
            # A generic filter refresh may not consume a document-bound result.
            key(65477, 4 | 8)
            assert menu()['items'][0][0] == original['items'][0][0]
            # Same caret/pinyin but changed external text cancels the old result.
            prop('jev_context', wire('1-1-2', 'changed'))
            assert not result.exists()
            prop('jev_refresh', 'changed')
            assert menu()['items'][0][0] == original['items'][0][0]
            time.sleep(1.1)  # Baseline bridge rate limit.
            prop('jev_context', wire('1-1-3', prefix))
            prop('jev_refresh', 'retry')
            result = wait_result()
            prop('jev_refresh', 'verified')
            ranked = menu()
            assert ranked['items'][0][0] == original['items'][1][0], ranked
            key(' ')
            commit = Commit(); commit.data_size = C.sizeof(Commit) - C.sizeof(C.c_int)
            assert get_commit(sid, C.byref(commit))
            assert commit.text.decode() == ranked['items'][0][0]
            free_commit(C.byref(commit))
            prop('jev_context', 'pending')
            for letter in 'jingli': key(letter)
            key(65477, 4)
            prop('jev_context_query', 'clear')
            assert getprop('jev_context_consent') == '0'
            prop('jev_context', wire('1-1-4', '', 'sensitive'))
            prop('jev_refresh', 'sensitive')
            assert not list(inbox.glob('*.json')), 'sensitive context must not submit'
            prop('client_app', 'unlisted.exe')
            prop('jev_context_query', 'unlisted')
            assert getprop('jev_context_consent') == '0'
            preferences.write_text('JEVPREF1\n0\n0\n', encoding='ascii', newline='\n')
            prop('jev_context_query', 'disabled')
            assert getprop('jev_context_consent') == '0'
            print(json.dumps({'native_context_lua': 'PASS', 'exact_whitespace_unicode': True,
                'stale_document_rejected': True, 'native_only_consumption': True,
                'displayed_winner_committed': True, 'consent_and_sensitive_gates': True,
                'live_tsf_gui_tested': False, 'provider_calls': 0, 'root': str(root)}, indent=2))
            return
        for letter in 'jingli': key(letter)
        original = menu()
        assert len(original['items']) == 7, original
        assert '[Jev: off]' in original['items'][0][1], original
        assert not list((bridge_root / 'runtime/inbox').glob('*.json')), 'disabled must not send'
        before = time.perf_counter(); key(65477); elapsed = time.perf_counter() - before
        assert elapsed < .25, ('toggle blocked', elapsed)
        assert 'pending' in menu()['items'][0][1], menu()
        for _ in range(70):
            if list((bridge_root / 'runtime/outbox').glob('*.res')): break
            time.sleep(.05)
        # A result must not replace the displayed candidate during Space commit.
        assert menu()['items'][0][0] == original['items'][0][0]
        key(' ')
        commit = Commit(); commit.data_size = C.sizeof(Commit) - C.sizeof(C.c_int)
        assert get_commit(sid, C.byref(commit))
        assert commit.text.decode() == original['items'][0][0]
        free_commit(C.byref(commit))
        time.sleep(1.05)
        for letter in 'jingli': key(letter)
        for _ in range(70):
            if list((bridge_root / 'runtime/outbox').glob('*.res')): break
            time.sleep(.05)
        # Native frontends use a property notifier, never a simulated key.
        set_property(sid, b'jev_refresh', b'test-1')
        ack = C.create_string_buffer(100)
        assert get_property(sid, b'jev_refresh_ack', ack, len(ack)) and ack.value == b'test-1'
        ranked = menu()
        assert ranked['items'][0][0] == original['items'][1][0], (original, ranked)
        assert 'ranked' in ranked['items'][0][1], ranked
        expected_commit = ranked['items'][0][0]
        key(' ')
        commit = Commit(); commit.data_size = C.sizeof(Commit) - C.sizeof(C.c_int)
        assert get_commit(sid, C.byref(commit))
        assert commit.text.decode() == expected_commit
        free_commit(C.byref(commit))
        time.sleep(1.05)
        for letter in 'jingli': key(letter)
        set_property(sid, b'jev_focus_epoch', b'focus-left')
        assert not list((bridge_root / 'runtime/inbox').glob('*.json')), 'focus must cancel pending input'
        set_property(sid, b'jev_refresh', b'focus-stale')
        assert get_property(sid, b'jev_refresh_ack', ack, len(ack)) and ack.value != b'focus-stale'
        key(65307)
        key(65477)  # Persistent disable.
        assert (bridge_root / 'runtime/preferences').read_text().splitlines()[1] == '0'
        for letter in 'jingli': key(letter)
        assert 'off' in menu()['items'][0][1]
        assert not list((bridge_root / 'runtime/inbox').glob('*.json'))
        key(65366)  # Page Down
        second_page = menu()
        assert second_page['page'] == 1 and len(second_page['items']) == 7, second_page
        key(65366)
        third_page = menu()
        assert third_page['page'] == 2 and len(third_page['items']) == 7, third_page
        assert third_page['items'] != second_page['items']
        # Pending requests are invalidated before a different composition can use them.
        key(65307)
        for letter in 'jingli': key(letter)
        key(65477)
        key('a')
        key(65477)  # Disable cancels both changed and previous requests.
        time.sleep(.6)
        assert not list((bridge_root / 'runtime/inbox').glob('*.json'))
        assert 'ranked' not in menu()['items'][0][1]
        key(65477, 4)  # Ctrl+F8 clears context without affecting the input.
        # A stopped service must not prevent native candidate generation.
        child.terminate(); child.wait(timeout=5)
        (bridge_root / 'runtime/bridge.info').unlink(missing_ok=True)
        key(65307)
        for letter in 'jingli': key(letter)
        key(65477)
        fallback = menu()
        assert len(fallback['items']) == 7 and 'start service' in fallback['items'][0][1]
        print(json.dumps({'native_rime': 'PASS', 'schema': 'rime_ice_jev',
            'disabled_network_requests': 0, 'enabled_auto_request': True, 'mock_winner_promoted': True,
            'persistent_toggle': True, 'no_unseen_swap_on_space': True, 'property_refresh': True,
            'focus_invalidates_pending': True, 'gui_timer_tested': False,
            'three_pages_preserved': True, 'stale_request_cancelled': True,
            'displayed_winner_committed': True,
            'service_stopped_fallback': True, 'original_schema_preserved': True,
            'f8_toggle_ms': round(elapsed * 1000, 2), 'root': str(root)}, indent=2))
    finally:
        if initialized: finalize()
        child.terminate()
        child.wait(timeout=5)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    parser.add_argument('--context', action='store_true')
    run(parser.parse_args().context)
