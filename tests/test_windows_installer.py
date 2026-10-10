"""Run Windows PowerShell 5.1 in disposable paths, never deploy the real IME."""
import hashlib
import ctypes
import importlib.util
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest
import zipfile

ROOT = Path(__file__).resolve().parents[1]
POWERSHELL = Path(os.environ.get('WINDIR', 'C:/Windows')) / 'System32/WindowsPowerShell/v1.0/powershell.exe'


@unittest.skipUnless(os.name == 'nt' and POWERSHELL.is_file() and shutil.which('node'), 'Windows PowerShell and Node are required')
class WindowsInstallerTests(unittest.TestCase):
    def setUp(self):
        self.temporary = tempfile.TemporaryDirectory(prefix='rime-jev-installer-')
        self.addCleanup(self.temporary.cleanup)
        self.root = Path(self.temporary.name) / 'space \u6d4b\u8bd5'
        self.rime = self.root / 'Rime'
        self.weasel = self.root / 'Weasel'
        self.data = self.root / 'Local Data/RimeJev'
        for path in (self.rime, self.weasel, self.data):
            path.mkdir(parents=True)
        # These placeholders may only be used with NoDeploy or Check.
        for name in ('WeaselDeployer.exe', 'rime.dll'):
            (self.weasel / name).write_bytes(b'NOT AN EXECUTABLE')
        (self.rime / 'rime_ice.schema.yaml').write_text('schema: {schema_id: rime_ice}\n', encoding='ascii')
        self.original = b'patch:\r\n  menu/page_size: 7\r\n  schema_list:\r\n    - {schema: luna_pinyin}\r\n'
        (self.rime / 'default.custom.yaml').write_bytes(self.original)
        self.env = {k: v for k, v in os.environ.items() if k.upper() not in ('PSMODULEPATH', 'TYPESAFE_API_KEY')}
        self.env.update(LOCALAPPDATA=str(self.data.parent), APPDATA=str(self.root / 'Roaming'),
                        JEV_TEST_ROOT=str(self.root), JEV_SOURCE=str(ROOT))

    def command(self, code, success=True):
        script = self.root / 'case.ps1'
        script.write_text("$ErrorActionPreference = 'Stop'\n" + code, encoding='utf-8-sig')
        result = subprocess.run([str(POWERSHELL), '-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass',
                                 '-File', str(script)], env=self.env, cwd=self.root, capture_output=True,
                                creationflags=subprocess.CREATE_NO_WINDOW, timeout=120)
        output = (result.stdout + result.stderr).decode('utf-8', errors='replace')
        if success:
            self.assertEqual(result.returncode, 0, output)
        else:
            self.assertNotEqual(result.returncode, 0, output)
        return output

    def install(self, check=False, success=True):
        flags = '-Check' if check else '-NoConfigure -NoDeploy -NoStart -NoAutostart -NoShortcuts'
        return self.command("& (Join-Path $env:JEV_SOURCE 'scripts/Install-Windows.ps1') " + flags +
                            " -RimeUserDir (Join-Path $env:JEV_TEST_ROOT 'Rime') -WeaselRoot (Join-Path $env:JEV_TEST_ROOT 'Weasel')", success)

    def manifest(self):
        return json.loads((self.data / 'installation.json').read_text(encoding='utf-8-sig'))

    def test_all_scripts_parse_in_windows_powershell(self):
        self.command("""
foreach ($file in (Get-ChildItem -LiteralPath (Join-Path $env:JEV_SOURCE 'scripts') -Filter '*.ps1')) {
    $tokens=$null; $errors=$null
    $null=[Management.Automation.Language.Parser]::ParseFile($file.FullName,[ref]$tokens,[ref]$errors)
    if ($errors.Count) { throw ($file.Name + ': ' + ($errors.Message -join '; ')) }
}
""")

    def test_read_only_preflight_then_repeat_install_update_and_uninstall(self):
        (self.data / 'config.json').write_text('{"callLimit":123}', encoding='ascii')
        (self.data / 'key.dpapi').write_text('opaque-private-placeholder', encoding='ascii')
        (self.rime / 'weasel.custom.yaml').write_text('skin unchanged', encoding='ascii')
        (self.rime / 'rime_ice_jev.custom.yaml').write_text('personal permissions unchanged', encoding='ascii')
        protected = {p: p.read_bytes() for p in (self.data / 'config.json', self.data / 'key.dpapi',
                                                self.rime / 'weasel.custom.yaml', self.rime / 'rime_ice_jev.custom.yaml')}
        self.install(check=True)
        self.assertFalse((self.data / 'installation.json').exists())
        self.assertFalse((self.data / 'app').exists())
        self.assertEqual((self.rime / 'default.custom.yaml').read_bytes(), self.original)
        self.install()
        first = self.manifest()
        app = Path(first['project'])
        self.assertTrue(app.resolve().is_relative_to((self.data / 'app').resolve()))
        self.assertTrue(first['managedApp'])
        patched = (self.rime / 'default.custom.yaml').read_text(encoding='utf-8')
        self.assertIn('luna_pinyin', patched)
        self.assertEqual(patched.count('schema: rime_ice_jev'), 1)
        self.assertEqual((self.data / 'runtime/preferences').read_text(encoding='ascii'), 'JEVPREF1\n0\n0\n')
        self.install()
        self.assertEqual(self.manifest()['backup'], first['backup'])
        self.assertEqual(self.manifest()['project'], first['project'])
        self.assertEqual(len(list((self.data / 'app').iterdir())), 1)
        self.env['JEV_APP'] = str(app)
        self.command("& (Join-Path $env:JEV_APP 'scripts/Uninstall.ps1') -NoDeploy -NoShortcuts")
        self.assertEqual((self.rime / 'default.custom.yaml').read_bytes(), self.original)
        self.assertFalse((self.rime / 'lua/jev_windows.lua').exists())
        self.assertFalse((self.data / 'installation.json').exists())
        for path, content in protected.items():
            self.assertEqual(path.read_bytes(), content)

    def test_modified_files_refuse_update_or_uninstall_without_overwrite(self):
        self.install()
        modified = self.rime / 'lua/jev_windows.lua'
        content = modified.read_bytes() + b'\n-- local edit\n'
        modified.write_bytes(content)
        self.install(success=False)
        self.env['JEV_APP'] = self.manifest()['project']
        self.command("& (Join-Path $env:JEV_APP 'scripts/Uninstall.ps1') -NoDeploy -NoShortcuts", success=False)
        self.assertEqual(modified.read_bytes(), content)
        self.assertTrue((self.data / 'installation.json').exists())

    def test_modified_backup_and_active_native_prevent_uninstall(self):
        self.install()
        manifest = self.manifest()
        self.env['JEV_APP'] = manifest['project']
        uninstall = "& (Join-Path $env:JEV_APP 'scripts/Uninstall.ps1') -NoDeploy -NoShortcuts"
        backup = Path(next(f['backup'] for f in manifest['files'] if f['relative'] == 'default.custom.yaml'))
        backup.write_bytes(b'damaged backup')
        output = self.command(uninstall, success=False)
        self.assertIn('backup changed', output)
        backup.write_bytes(self.original)
        (self.data / 'native-installation.json').write_text('{"active":true}', encoding='ascii')
        self.assertIn('Rollback-Native.cmd', self.command(uninstall, success=False))
        self.assertTrue((self.rime / 'lua/jev_windows.lua').exists())

    def test_active_native_receipt_is_not_replaced_by_repeat_install_or_update(self):
        self.install()
        before = (self.data / 'installation.json').read_bytes()
        state = b'{"active":true,"receipt":"original-receipt-must-be-kept"}'
        (self.data / 'native-installation.json').write_bytes(state)
        self.assertIn('Rollback-Native.cmd', self.install(success=False))
        for name in ('Update.ps1', 'Install-Native.ps1'):
            output = self.command("& (Join-Path $env:JEV_SOURCE 'scripts/" + name + "')", success=False)
            self.assertIn('Rollback-Native.cmd', output)
        self.assertEqual((self.data / 'native-installation.json').read_bytes(), state)
        self.assertEqual((self.data / 'installation.json').read_bytes(), before)

    def test_dependency_conflict_cleans_staging_and_keeps_existing_dictionaries(self):
        source = self.root / 'dependency-source'
        (source / 'scripts').mkdir(parents=True)
        for name in ('Install-Dependencies.ps1', 'Installer.Common.ps1'):
            shutil.copy2(ROOT / 'scripts' / name, source / 'scripts' / name)
        lock = json.loads((ROOT / 'dependencies.lock.json').read_text(encoding='utf-8'))
        (self.rime / 'rime_ice.schema.yaml').unlink()
        original = b'user dictionary must survive\n'
        (self.rime / 'cn_dicts').mkdir()
        (self.rime / 'cn_dicts/base.dict.yaml').write_bytes(original)
        cache = self.data / 'downloads'
        cache.mkdir()
        archive = cache / ('rime-ice-' + lock['rimeIce']['revision'] + '.zip')
        prefix = 'rime-ice-' + lock['rimeIce']['revision'] + '/'
        with zipfile.ZipFile(archive, 'w') as zipped:
            zipped.writestr(prefix + 'rime_ice.schema.yaml', 'schema: {schema_id: rime_ice}\n')
            zipped.writestr(prefix + 'cn_dicts/base.dict.yaml', 'different upstream dictionary\n')
        lock['rimeIce']['sha256'] = hashlib.sha256(archive.read_bytes()).hexdigest()
        (source / 'dependencies.lock.json').write_text(json.dumps(lock), encoding='utf-8')
        self.env['JEV_DEPENDENCY_SOURCE'] = str(source)
        output = self.command("""
& (Join-Path $env:JEV_DEPENDENCY_SOURCE 'scripts/Install-Dependencies.ps1') `
    -RimeUserDir (Join-Path $env:JEV_TEST_ROOT 'Rime') -WeaselRoot (Join-Path $env:JEV_TEST_ROOT 'Weasel')
""", success=False)
        self.assertIn('conflicts with an existing file', output)
        self.assertEqual((self.rime / 'cn_dicts/base.dict.yaml').read_bytes(), original)
        self.assertFalse((self.rime / 'rime_ice.schema.yaml').exists())
        self.assertEqual(list(cache.iterdir()), [archive])

    def test_staging_cleanup_is_limited_to_generated_immediate_children(self):
        self.command("""
. (Join-Path $env:JEV_SOURCE 'scripts/Installer.Common.ps1')
$base=Join-Path $env:JEV_TEST_ROOT 'staging-parent'
$stage=Join-JevPath $base ('ice-' + 'a' * 32)
New-Item -ItemType Directory -Path $stage -Force | Out-Null
[IO.File]::WriteAllText((Join-Path $stage 'large-cache'), 'cache')
foreach ($path in @($base, (Join-Path $base 'important'), (Join-Path $env:JEV_TEST_ROOT ('ice-' + 'b' * 32)))) {
    $rejected=$false
    try { Remove-JevStagingDirectory $base $path } catch { $rejected=$true }
    if (-not $rejected) { throw 'Unsafe cleanup target was accepted' }
}
Remove-JevStagingDirectory $base $stage
if (Test-Path -LiteralPath $stage) { throw 'Stage was retained' }
if (-not (Test-Path -LiteralPath $base)) { throw 'Parent was deleted' }
""")

    def test_short_path_aliases_match_installation_and_bridge_identity(self):
        buffer = ctypes.create_unicode_buffer(32768)
        length = ctypes.windll.kernel32.GetShortPathNameW(str(self.root), buffer, len(buffer))
        if not length or '~' not in buffer.value:
            self.skipTest('8.3 aliases are disabled on this filesystem')
        self.env['JEV_TEST_SHORT_ROOT'] = buffer.value
        self.env['LOCALAPPDATA'] = str(Path(buffer.value) / 'Local Data')
        self.install()
        self.env['JEV_APP'] = self.manifest()['project']
        self.command(r"""
. (Join-Path $env:JEV_SOURCE 'scripts/Installer.Common.ps1')
$short=Join-Path $env:JEV_TEST_SHORT_ROOT 'new\child'
$long=Join-Path $env:JEV_TEST_ROOT 'new\child'
if ((Get-JevFullPath $short) -ne (Get-JevFullPath $long)) { throw 'Non-existing child was not normalized' }
$data=Join-Path $env:LOCALAPPDATA 'RimeJev'
$proc=[pscustomobject]@{Name='node.exe'; CommandLine=('node.exe "' + (Join-Path $env:JEV_APP 'bridge.mjs') + '" "' + $data + '"')}
if (-not (Test-JevBridgeProcess $proc $env:JEV_APP (Get-JevFullPath $data))) { throw 'Short data argument was not matched' }
try { & (Join-Path $env:JEV_APP 'scripts/Start-Bridge.ps1') }
finally {
    & (Join-Path $env:JEV_APP 'scripts/Stop-Bridge.ps1')
    Start-Sleep -Seconds 1
}
""")
        self.assertFalse((self.data / 'runtime/bridge.lock').exists())
        self.install()
        self.command("& (Join-Path $env:JEV_APP 'scripts/Uninstall.ps1') -NoDeploy -NoShortcuts")
        self.assertEqual((self.rime / 'default.custom.yaml').read_bytes(), self.original)

    def test_bad_yaml_fails_before_copying_any_application_files(self):
        bad = b'patch: {schema_list: []}\n'
        (self.rime / 'default.custom.yaml').write_bytes(bad)
        self.install(success=False)
        self.assertFalse((self.data / 'app').exists())
        self.assertEqual((self.rime / 'default.custom.yaml').read_bytes(), bad)

    def test_merge_paths_zip_and_manifest_guards(self):
        self.command("""
. (Join-Path $env:JEV_SOURCE 'scripts/Installer.Common.ps1')
$inputText="patch:`n  'schema_list/+':`n    - {schema: luna_pinyin}`n  menu/page_size: 9`n"
$once=Add-JevSchemaPatch $inputText
if ((Add-JevSchemaPatch $once) -cne $once -or $once -notmatch 'luna_pinyin' -or $once -notmatch 'menu/page_size: 9') { throw 'Non-idempotent YAML merge' }
$empty=Add-JevSchemaPatch "patch: {}`n"
if ($empty -notmatch 'schema: rime_ice_jev') { throw 'Empty patch was not handled' }
foreach ($name in @('..\\outside', 'C:\\outside', 'x:stream', 'a//b', 'NUL.txt', 'a?b', 'x. /bad')) {
    $rejected=$false
    try { $null=Join-JevPath $env:JEV_TEST_ROOT $name } catch { $rejected=$true }
    if (-not $rejected) { throw ('Unsafe path accepted: ' + $name) }
}
$proc=[pscustomobject]@{Name='node.exe'; CommandLine='node.exe "C:\\app\\bridge.mjs" "C:\\data"'}
if (-not (Test-JevBridgeProcess $proc 'C:\\app' 'C:\\data') -or (Test-JevBridgeProcess $proc 'C:\\app' 'C:\\dat')) { throw 'Process identity was not exact' }
""")
        bad_zip = self.root / 'bad.zip'
        with zipfile.ZipFile(bad_zip, 'w') as archive:
            archive.writestr('../escape.txt', 'unsafe')
        self.command("""
. (Join-Path $env:JEV_SOURCE 'scripts/Installer.Common.ps1')
Expand-JevZip (Join-Path $env:JEV_TEST_ROOT 'bad.zip') (Join-Path $env:JEV_TEST_ROOT 'extracted')
""", success=False)
        self.assertFalse((self.root / 'extracted').exists())
        self.assertFalse((self.root / 'escape.txt').exists())
        self.install()
        app = Path(self.manifest()['project'])
        (app / 'provider.mjs').write_text('tampered package', encoding='ascii')
        self.assertIn('integrity check failed', self.install(success=False))

    def test_extracted_release_runs_after_download_folder_is_removed(self):
        spec = importlib.util.spec_from_file_location('release_installer_fixture', ROOT / 'scripts/Package-Release.py')
        release = importlib.util.module_from_spec(spec)
        spec.loader.exec_module(release)
        packaged = release.package(self.root / 'archives', 'installer-test')
        extracted = self.root / 'downloaded'
        with zipfile.ZipFile(packaged['archive']) as archive:
            archive.extractall(extracted)
        source = next(extracted.iterdir())
        self.env['JEV_SOURCE'] = str(source)
        self.install()
        app = Path(self.manifest()['project'])
        # Both paths are verified disposable descendants, never a live installation.
        self.assertTrue(extracted.resolve().is_relative_to(self.root.resolve()))
        shutil.rmtree(extracted)
        self.env['JEV_APP'] = str(app)
        try:
            self.command("& (Join-Path $env:JEV_APP 'scripts/Start-Bridge.ps1')")
            status = json.loads((self.data / 'status.json').read_text(encoding='utf-8'))
            self.assertEqual(status['mode'], 'offline')
            self.assertGreater(status['pid'], 0)
        finally:
            self.command("& (Join-Path $env:JEV_APP 'scripts/Stop-Bridge.ps1')")
        self.assertFalse((self.data / 'runtime/bridge.lock').exists())
        self.command(r"""
$app=[IO.Path]::GetFullPath($env:JEV_APP)
$commandPath=Join-Path $app 'scripts\Start-Bridge.ps1'
for ($i=0; $i -lt 100; $i++) {
    $helpers=@(Get-CimInstance Win32_Process -Filter "Name='powershell.exe'" | Where-Object {
        $_.ProcessId -ne $PID -and $_.CommandLine -and $_.CommandLine.Contains($commandPath) -and $_.CommandLine.Contains('-Foreground')
    })
    if (-not $helpers.Count) { break }
    Start-Sleep -Milliseconds 100
}
if ($helpers.Count) { throw 'The hidden bridge launcher did not exit after stopping Node.' }
""")


if __name__ == '__main__':
    unittest.main()
