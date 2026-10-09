"""Integration test against installed rime.dll, with isolated dictionaries and mock IPC.

Never opens the real user database and never calls a network provider.
"""
import ctypes as C
import argparse
import hashlib
import importlib.util
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


def run(typing_profile=False, nasal_profile=False, pebrel_context=False, context_test=False):
    project = Path(__file__).resolve().parents[1]
    with winreg.OpenKey(winreg.HKEY_LOCAL_MACHINE, r'SOFTWARE\WOW6432Node\Rime\Weasel') as k:
        install = Path(winreg.QueryValueEx(k, 'WeaselRoot')[0])
    user = Path(os.environ['APPDATA']) / 'Rime'
    root = project / 'runtime' / ('native-' + uuid.uuid4().hex[:8])
    data, bridge_root = root / 'rime', root / 'bridge'
    data.mkdir(parents=True)
    (data / 'lua').mkdir()
    shutil.copytree(user / 'build', data / 'build')
    stock_prism_hash = hashlib.sha256((data / 'build/rime_ice.prism.bin').read_bytes()).hexdigest()
    shutil.copy2(project / 'lua/jev_windows.lua', data / 'lua/jev_windows.lua')
    schema = (project / 'rime_ice_jev.schema.yaml').read_text()
    schema += '\n  - jev_windows/runtime_dir: ' + json.dumps((bridge_root / 'runtime').as_posix()) + '\n'
    if context_test:
        schema = schema.replace('jev_windows/context_apps: []', 'jev_windows/context_apps: [jev-context-test.exe]')
    (data / 'rime_ice_jev.schema.yaml').write_text(schema)
    if typing_profile or nasal_profile:
        spec = importlib.util.spec_from_file_location('typing_profile', project / 'scripts/Typing-Profile.py')
        module = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(module)
        pairs = module.NASAL_PAIRS if nasal_profile else ['z-zh', 'in-ing']
        (data / 'rime_ice_jev.custom.yaml').write_text(module.profile(pairs), encoding='ascii')
        (data / 'custom_phrase.txt').write_text('\u5feb\u6377\u77ed\u8bed\u6d4b\u8bd5\tjvcs\t100\n', encoding='utf-8')
    existing_default = (user / 'default.custom.yaml').read_text(encoding='utf-8-sig')
    if 'rime_ice_jev' not in existing_default:
        existing_default = existing_default.rstrip() + '\n  "schema_list/+":\n    - {schema: rime_ice_jev}\n'
    (data / 'default.custom.yaml').write_text(existing_default, encoding='utf-8')
    context_options = ',contextProvider:' + json.dumps({'type': 'pebrel-codex', 'cli': os.environ['PEBREL_CLI']}) if pebrel_context else ''
    node_script = f"import {{startBridge}} from {json.dumps((project / 'bridge.mjs').as_uri())}; const b=await startBridge({{root:{json.dumps(str(bridge_root))},mock:true{context_options}}}); await b.done;"
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
        assert hashlib.sha256((data / 'build/rime_ice.prism.bin').read_bytes()).hexdigest() == stock_prism_hash
        assert (data / 'build/rime_ice_jev.prism.bin').exists(), 'Jev must use its own spelling index'
        initialize(C.byref(traits)); initialized = True
        sid = create()
        assert sid and select(sid, b'rime_ice_jev'), 'schema not selectable'
        def key(code, mask=0):
            return process(sid, ord(code) if isinstance(code, str) else code, mask)
        def menu():
            ctx = Context(); ctx.data_size = C.sizeof(Context) - C.sizeof(C.c_int)
            assert get_context(sid, C.byref(ctx))
            try:
                return {'page': ctx.menu.page_no, 'selected': ctx.menu.highlighted_candidate_index, 'items': [
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
            # A document recheck after hovering the displayed first candidate
            # must not regenerate the original menu underneath that selection.
            time.sleep(1.1)
            prop('jev_context', 'pending')
            for letter in 'jingli': key(letter)
            manual_original = menu()
            prop('jev_context', wire('1-2-1', prefix))
            prop('jev_refresh', 'before-manual')
            wait_result()
            prop('jev_refresh', 'rank-before-manual')
            before_manual = menu()
            assert before_manual['items'][0][0] == manual_original['items'][1][0], before_manual
            prop('jev_manual_selection', 'hover-first')
            prop('jev_context', wire('1-2-2', 'edited externally'))
            prop('jev_refresh', 'after-manual-context-change')
            after_manual = menu()
            assert [item[0] for item in after_manual['items']] == [item[0] for item in before_manual['items']], (
                'context recheck replaced a manually frozen menu', before_manual, after_manual)
            assert after_manual['selected'] == before_manual['selected']
            assert getprop('jev_refresh_ack') != 'after-manual-context-change', 'frozen menu must not request UI replacement'
            assert not list(inbox.glob('*.json')), 'manual selection must not resubmit'
            key(' ')
            commit = Commit(); commit.data_size = C.sizeof(Commit) - C.sizeof(C.c_int)
            assert get_commit(sid, C.byref(commit))
            assert commit.text.decode() == before_manual['items'][0][0], 'commit changed after manual freeze'
            free_commit(C.byref(commit))
            prop('jev_context', 'pending')
            for letter in 'jingli': key(letter)
            key(65477, 4)
            prop('jev_context_query', 'clear')
            assert getprop('jev_context_consent') == '0'
            # Real shortcuts deliver modifier key events too. These do not end
            # the composition and must not undo Ctrl+F8's context suppression.
            prop('jev_context', 'pending')  # Native key path invalidates first.
            key(65507, 4)  # Control_L
            key(65507, 4 | (1 << 30))
            prop('jev_context_query', 'after-modifier')
            assert getprop('jev_context_consent') == '0', 'modifier restored revoked context consent'
            key('a')
            prop('jev_context_query', 'after-more-pinyin')
            assert getprop('jev_context_consent') == '0', 'suppression must last until composition ends'
            prop('jev_focus_epoch', 'same-composition-focus-change')
            prop('jev_context_query', 'after-focus-clear')
            assert getprop('jev_context_consent') == '0', 'focus cleanup restored revoked context consent'
            for enabled in ('0', '1'):
                preferences.write_text(f'JEVPREF1\n{enabled}\n1\n', encoding='ascii', newline='\n')
                prop('jev_context_query', f'after-preference-{enabled}')
                assert getprop('jev_context_consent') == '0', 'preference cleanup restored revoked context consent'
            prop('jev_context', wire('1-2-3', prefix))
            prop('jev_refresh', 'suppressed-document')
            submitted = json.loads(next(inbox.glob('*.json')).read_text(encoding='utf-8'))
            assert submitted['context'] == '' and submitted['document']['quality'] == 'unavailable', (
                'suppressed composition forwarded document text')
            key(65307)
            prop('jev_context', 'pending')
            for letter in 'jingli': key(letter)
            prop('jev_context_query', 'new-composition')
            assert getprop('jev_context_consent') == '1', 'new composition must release manual suppression'
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
                'manual_selection_survives_context_change': True,
                'manual_clear_survives_modifiers': True,
                'live_tsf_gui_tested': False, 'provider_calls': 0, 'root': str(root)}, indent=2))
            return
        if pebrel_context:
            # The caller puts a known, unsubmitted draft in the focused Codex
            # composer. This test never types, submits, or calls a real provider.
            (bridge_root / 'runtime/preferences').write_text('JEVPREF1\n1\n1\n', encoding='ascii', newline='\n')
            set_property(sid, b'client_app', b'pebrel.exe')
            set_property(sid, b'client_type', b'tsf')
            time.sleep(.3)
            for letter in 'jingli': key(letter)
            original = menu()
            for _ in range(350):
                try:
                    status = json.loads((bridge_root / 'status.json').read_text(encoding='utf-8'))
                except (PermissionError, FileNotFoundError):
                    time.sleep(.02)
                    continue
                if status.get('lastResult'): break
                time.sleep(.02)
            result = status['lastResult']
            assert result['contextState'] == {'enabled': True, 'reason': 'available', 'source': 'pebrel_codex'}, result
            assert result['contextChars'] == 13, ('unexpected synthetic draft length', result)
            assert result['decision'] == 'promoted' and result['source'] == 'mock', result
            assert status['callsToday'] == 0
            set_property(sid, b'jev_refresh', b'pebrel-context-test')
            updated = menu()
            assert updated['items'][0][0] == original['items'][1][0], 'mock ranking did not reach Lua'
            print(json.dumps({'pebrel_context': 'PASS', 'contextChars': result['contextChars'],
                'readyMs': result['readyMs'], 'source': result['contextState']['source'],
                'lua_request_and_mock_rank_applied': True, 'provider_calls': 0,
                'gui_timer_tested': False, 'root': str(root)}, indent=2))
            return
        if typing_profile or nasal_profile:
            compiled = (data / 'build/rime_ice_jev.schema.yaml').read_text(encoding='utf-8')
            assert 'abbrev/^([a-z]).+$/$1/' in compiled
            checks = [
                ('zg', '\u4e2d\u56fd'), ('zhongg', '\u4e2d\u56fd'),
                ('beijin', '\u5317\u4eac'),
                ('jvcs', '\u5feb\u6377\u77ed\u8bed\u6d4b\u8bd5'),
            ]
            if nasal_profile:
                for rule in [rule for pair in pairs for rule in module.FUZZY[pair]]:
                    assert rule in compiled, ('missing nasal rule', rule)
                for rule in ['derive/^zh/z/', 'derive/^n/l/', 'derive/^f/h/', 'derive/^r/l/']:
                    assert rule not in compiled, ('unexpected fuzzy initial', rule)
                checks += [
                    ('banzhu', '\u5e2e\u52a9'), ('bangfa', '\u529e\u6cd5'),
                    ('shenming', '\u751f\u547d'), ('rengmin', '\u4eba\u6c11'),
                    ('xingwen', '\u65b0\u95fb'), ('xianfa', '\u60f3\u6cd5'),
                    ('dianghua', '\u7535\u8bdd'), ('guanbo', '\u5e7f\u64ad'),
                    ('guangbi', '\u5173\u95ed'), ('beijing', '\u5317\u4eac'),
                ]
            else:
                assert 'derive/^zh/z/' in compiled
                checks.append(('zongguo', '\u4e2d\u56fd'))
            local_ms = []
            for spelling, expected in checks:
                started = time.perf_counter()
                for letter in spelling: key(letter)
                visible = menu()
                local_ms.append(round((time.perf_counter() - started) * 1000, 2))
                assert expected in [item[0] for item in visible['items']], (spelling, expected, visible)
                key(65307)
            assert not list((bridge_root / 'runtime/inbox').glob('*.json')), 'local adaptation must work offline'
            print(json.dumps({'typing_profile': 'PASS', 'fuzzy_pairs': pairs,
                'nasal_only': nasal_profile, 'local_candidate_cases': [spelling for spelling, _ in checks],
                'abbreviation_and_mixed_spelling': True, 'custom_phrase': True,
                'original_prism_unchanged': True, 'local_candidate_ms': local_ms, 'gui_tested': False}))
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
        # Real commits must not masquerade as the current application's buffer.
        (bridge_root / 'runtime/preferences').write_text('JEVPREF1\n1\n1\n', encoding='ascii', newline='\n')
        key(65477, 4)
        committed_prefix = ''
        for letters in ['tabei', 'renming', 'wei', 'bumen']:
            for letter in letters: key(letter)
            key(' ')
            commit = Commit(); commit.data_size = C.sizeof(Commit) - C.sizeof(C.c_int)
            assert get_commit(sid, C.byref(commit)), ('missing prefix commit', letters)
            committed_prefix += commit.text.decode()
            free_commit(C.byref(commit))
        for letter in 'jingli': key(letter)
        requests = list((bridge_root / 'runtime/inbox').glob('*.json'))
        assert len(requests) == 1, ('missing context request', len(requests), menu())
        submitted = json.loads(requests[0].read_text(encoding='utf-8'))
        assert committed_prefix and submitted['context'] == '', 'commit history leaked into document context'
        assert submitted['pinyin'] == 'jingli'
        assert submitted['document'] == {'source': 'tsf', 'quality': 'unavailable', 'stamp': ''}
        assert submitted['contextState']['source'] == 'none'
        prior_epoch = submitted['cacheEpoch']
        set_property(sid, b'jev_focus_epoch', b'context-focus-left')
        for _ in range(100):
            try:
                status = json.loads((bridge_root / 'status.json').read_text(encoding='utf-8'))
            except PermissionError:
                time.sleep(.02)
                continue
            if status.get('lastAdapterCancellation', {}).get('requestId') == submitted['id']: break
            time.sleep(.02)
        assert status['lastAdapterCancellation']['reason'] == 'focus_changed', status
        # Resume typing after focus invalidation, without restoring old history.
        key('a')
        requests = list((bridge_root / 'runtime/inbox').glob('*.json'))
        assert len(requests) == 1
        resumed = json.loads(requests[0].read_text(encoding='utf-8'))
        assert resumed['context'] == ''
        assert resumed['contextState'] == {'enabled': True, 'reason': 'focus_changed', 'source': 'none'}
        assert resumed['cacheEpoch'] > prior_epoch
        key(65307)
        # Pebrel is a terminal, not an editable document. Its Codex draft is
        # acquired by the bridge; IME commit history must not masquerade as it.
        set_property(sid, b'client_app', b'pebrel.exe')
        set_property(sid, b'client_type', b'tsf')
        for letter in 'jingli': key(letter)
        requests = list((bridge_root / 'runtime/inbox').glob('*.json'))
        assert len(requests) == 1
        terminal = json.loads(requests[0].read_text(encoding='utf-8'))
        assert terminal['context'] == '' and terminal['contextTarget'] == 'pebrel'
        assert terminal['contextState'] == {'enabled': True, 'reason': 'context_pending', 'source': 'pebrel_codex'}
        key(65477, 4)  # Manual clear suppresses external rereading for this composition.
        requests = list((bridge_root / 'runtime/inbox').glob('*.json'))
        assert len(requests) == 1
        suppressed = json.loads(requests[0].read_text(encoding='utf-8'))
        assert suppressed['context'] == '' and suppressed['contextTarget'] is None
        assert suppressed['contextState'] == {'enabled': True, 'reason': 'manual_clear', 'source': 'none'}
        key(65307)
        set_property(sid, b'client_app', b'jev-test.exe')
        (bridge_root / 'runtime/preferences').write_text('JEVPREF1\n1\n0\n', encoding='ascii', newline='\n')
        time.sleep(1.05)
        for letter in 'jingli': key(letter)
        for _ in range(70):
            if list((bridge_root / 'runtime/outbox').glob('*.res')): break
            time.sleep(.05)
        # Real shortcuts deliver modifier key-down events before F8.
        key(65507, 4)  # Control_L
        key(65513, 12)  # Alt_L with Control
        key(65477, 12)
        diagnostic = menu()
        assert 'ranked' in diagnostic['items'][0][1], ('modifier shortcut lost result', diagnostic)
        key(65307)
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
        assert 'ranked #2->1' in ranked['items'][0][1], ranked
        for _ in range(100):
            try:
                status = json.loads((bridge_root / 'status.json').read_text(encoding='utf-8'))
            except PermissionError:
                time.sleep(.02)
                continue
            if status.get('lastResult', {}).get('applyChannel') == 'native': break
            time.sleep(.02)
        assert status['lastResult']['applyChannel'] == 'native', status
        assert status['outcomes']['nativeApplied'] >= 1, status
        assert status['lastResult']['applyMs'] >= 0, status
        expected_commit = ranked['items'][0][0]
        key(' ')
        commit = Commit(); commit.data_size = C.sizeof(Commit) - C.sizeof(C.c_int)
        assert get_commit(sid, C.byref(commit))
        assert commit.text.decode() == expected_commit
        free_commit(C.byref(commit))
        # A confident identity order is not a candidate replacement.
        for letter in 'jingli': key(letter)
        for _ in range(70):
            results = list((bridge_root / 'runtime/outbox').glob('*.res'))
            if results: break
            time.sleep(.05)
        assert results, 'mock result missing for identity-order regression'
        rows = results[0].read_text().splitlines()
        rows[6] = ','.join(str(i + 1) for i in range(int(rows[5])))
        results[0].write_text('\n'.join(rows) + '\n', encoding='ascii', newline='\n')
        before_identity = menu()['items'][0][0]
        set_property(sid, b'jev_refresh', b'identity-order')
        identity = menu()
        assert identity['items'][0][0] == before_identity
        assert 'same first' in identity['items'][0][1] and 'ranked' not in identity['items'][0][1], identity
        key(65307)
        time.sleep(1.05)
        for letter in 'jingli': key(letter)
        before_focus = menu()
        set_property(sid, b'jev_focus_epoch', b'focus-left')
        assert not list((bridge_root / 'runtime/inbox').glob('*.json')), 'focus must cancel pending input'
        after_focus = menu()
        assert [item[0] for item in after_focus['items']] == [item[0] for item in before_focus['items']]
        assert 'pending' not in after_focus['items'][0][1], ('cancelled focus left a pending annotation', after_focus)
        set_property(sid, b'jev_refresh', b'focus-stale')
        assert get_property(sid, b'jev_refresh_ack', ack, len(ack)) and ack.value == b'focus-stale'
        assert not list((bridge_root / 'runtime/inbox').glob('*.json')), 'retiring pending UI must not resubmit after focus loss'
        key(65307)
        # External configuration changes must update pending UI without a key.
        for letter in 'jingli': key(letter)
        assert 'pending' in menu()['items'][0][1], menu()
        (bridge_root / 'runtime/preferences').write_text('JEVPREF1\n0\n0\n', encoding='ascii')
        set_property(sid, b'jev_refresh', b'external-disable')
        assert get_property(sid, b'jev_refresh_ack', ack, len(ack)) and ack.value == b'external-disable'
        assert '[Jev: off]' in menu()['items'][0][1], menu()
        assert not list((bridge_root / 'runtime/inbox').glob('*.json'))
        key(65307)
        key(65477)  # Re-enable for the manual-selection regression.
        for letter in 'jingli': key(letter)
        before_manual = menu()
        set_property(sid, b'jev_manual_selection', b'mouse-hover')
        assert not list((bridge_root / 'runtime/inbox').glob('*.json'))
        set_property(sid, b'jev_refresh', b'manual-stale')
        assert get_property(sid, b'jev_refresh_ack', ack, len(ack)) and ack.value == b'manual-stale'
        after_manual = menu()
        assert [item[0] for item in after_manual['items']] == [item[0] for item in before_manual['items']], 'manual selection must freeze displayed order'
        assert after_manual['selected'] == before_manual['selected']
        assert 'paused' in after_manual['items'][0][1] and 'pending' not in after_manual['items'][0][1], after_manual
        assert not list((bridge_root / 'runtime/inbox').glob('*.json')), 'manual selection must not resubmit'
        # Keyboard navigation must retire pending without resetting the highlight.
        key(65307)
        for letter in 'jingli': key(letter)
        before_navigation = menu()
        key(65364)  # Down
        after_navigation = menu()
        assert after_navigation['selected'] == 1, after_navigation
        assert [item[0] for item in after_navigation['items']] == [item[0] for item in before_navigation['items']]
        assert 'paused' in after_navigation['items'][0][1], after_navigation
        assert not list((bridge_root / 'runtime/inbox').glob('*.json'))
        # A terminal provider error must replace pending, without changing any words.
        key(65307)
        for letter in 'jingli': key(letter)
        for _ in range(70):
            results = list((bridge_root / 'runtime/outbox').glob('*.res'))
            if results: break
            time.sleep(.05)
        assert results, 'mock result missing for timeout UI regression'
        rows = results[0].read_text().splitlines()
        rows[3], rows[6] = 'error', 'TIMEOUT'
        results[0].write_text('\n'.join(rows) + '\n', encoding='ascii', newline='\n')
        before_timeout = menu()
        set_property(sid, b'jev_refresh', b'timeout-result')
        after_timeout = menu()
        assert 'TIMEOUT' in after_timeout['items'][0][1] and 'pending' not in after_timeout['items'][0][1], after_timeout
        assert [item[0] for item in after_timeout['items']] == [item[0] for item in before_timeout['items']]
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
        # A bridge disappearing during a request must also retire pending.
        key(65307)
        for letter in 'jingli': key(letter)
        key(65477)
        before_stop = menu()
        assert 'pending' in before_stop['items'][0][1], before_stop
        # A stopped service must not prevent native candidate generation.
        child.terminate(); child.wait(timeout=5)
        (bridge_root / 'runtime/bridge.info').unlink(missing_ok=True)
        set_property(sid, b'jev_refresh', b'service-stopped')
        assert get_property(sid, b'jev_refresh_ack', ack, len(ack)) and ack.value == b'service-stopped'
        after_stop = menu()
        assert 'expired' in after_stop['items'][0][1] and 'pending' not in after_stop['items'][0][1], after_stop
        assert [item[0] for item in after_stop['items']] == [item[0] for item in before_stop['items']]
        assert not list((bridge_root / 'runtime/inbox').glob('*.json'))
        key(65307)
        for letter in 'jingli': key(letter)
        fallback = menu()
        assert len(fallback['items']) == 7 and 'start service' in fallback['items'][0][1]
        print(json.dumps({'native_rime': 'PASS', 'schema': 'rime_ice_jev',
            'disabled_network_requests': 0, 'enabled_auto_request': True, 'mock_winner_promoted': True,
            'persistent_toggle': True, 'no_unseen_swap_on_space': True, 'property_refresh': True,
            'focus_invalidates_pending': True, 'gui_timer_tested': False,
            'native_receipt_observed': True, 'identity_order_not_reported_as_ranked': True,
            'commit_history_not_used_as_document': True,
            'pebrel_context_request_without_history': True,
            'manual_clear_suppresses_document_context': True,
            'context_clear_reason_and_cancel_receipt': True,
            'cancelled_pending_annotation_retired': True,
            'navigation_selection_preserved': True, 'timeout_annotation_retired': True,
            'external_disable_refresh': True, 'manual_selection_invalidates_pending': True,
            'three_pages_preserved': True, 'stale_request_cancelled': True,
            'displayed_winner_committed': True,
            'service_stopped_pending_retired': True,
            'service_stopped_fallback': True, 'original_schema_preserved': True,
            'f8_toggle_ms': round(elapsed * 1000, 2), 'root': str(root)}, indent=2))
    finally:
        if initialized: finalize()
        if child.poll() not in (None, 0):
            print(child.stderr.read().decode('utf-8', errors='replace'))
        child.terminate()
        child.wait(timeout=5)


if __name__ == '__main__':
    parser = argparse.ArgumentParser()
    profiles = parser.add_mutually_exclusive_group()
    profiles.add_argument('--typing-profile', action='store_true')
    profiles.add_argument('--nasal-profile', action='store_true')
    profiles.add_argument('--pebrel-context', action='store_true')
    profiles.add_argument('--context', action='store_true')
    args = parser.parse_args()
    run(args.typing_profile, args.nasal_profile, args.pebrel_context, args.context)
