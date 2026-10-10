param(
    [string]$Bundle = (Join-Path (Split-Path -Parent $PSScriptRoot) 'native-bundle'),
    [switch]$Check,
    [switch]$ConsentGiven,
    [string]$RimeUserDir,
    [string]$WeaselRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Installer.Common.ps1')
Assert-JevNativeInactive
$project = Split-Path -Parent $PSScriptRoot
if ((Get-JevArchitecture) -ne 'x64' -or -not [Environment]::Is64BitProcess) { throw 'The experimental native bundle requires x64 Windows and 64-bit PowerShell.' }
if (-not (Test-Path -LiteralPath (Join-Path $Bundle 'manifest.json'))) { throw 'Download the native Windows release ZIP; this package has no verified native bundle.' }
$manifest = Test-JevManifest $Bundle 'manifest.json'
foreach ($name in @('WeaselServer.exe','weaselx64.dll','lua/jev_windows.lua','rime_ice_jev.schema.yaml')) {
    if (-not $manifest.files.$name) { throw "Native bundle is missing $name" }
}
foreach ($name in @('lua/jev_windows.lua','rime_ice_jev.schema.yaml')) {
    if ((Get-FileHash -LiteralPath (Join-JevPath $project $name) -Algorithm SHA256).Hash -ne $manifest.files.$name) {
        throw 'The native bundle and adapter are not a matched release.'
    }
}
$paths = Get-JevPaths $RimeUserDir $WeaselRoot
$lock = Get-Content -LiteralPath (Join-Path $project 'dependencies.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
if ((Get-FileHash -LiteralPath (Join-Path $paths.Weasel 'rime.dll') -Algorithm SHA256).Hash -ne $lock.native.rimeDllSha256) {
    throw 'Native preflight requires the tested x64 Weasel 0.17.4 / librime 1.13.1 build. Use Install.cmd without DLL replacement on other builds.'
}
$key = 'Registry::HKEY_CLASSES_ROOT\CLSID\{A3F4CDED-B1E9-41EE-9CA6-7B4D0DE6CB0A}\InprocServer32'
if (-not (Test-Path -LiteralPath $key)) { throw 'The x64 Weasel TSF component is not registered.' }
Write-Host 'Native bundle hashes and pinned runtime compatibility passed; this is not a GUI acceptance test.'
if ($Check) { return }
if (-not $ConsentGiven) {
    if ((Read-Host 'Experimental DLL replacement requires UAC. Type INSTALL NATIVE to continue') -cne 'INSTALL NATIVE') { return }
}
$receipt = & (Join-Path $PSScriptRoot 'Prepare-NativeReplacement.ps1') -Bundle $Bundle -PassThru -RimeUserDir $paths.Rime -WeaselRoot $paths.Weasel
$statePath = Join-Path $paths.Data 'native-installation.json'
# Keep rollback discoverable even if UAC is cancelled or deployment fails after replacement.
$state = @{ format=1; receipt=$receipt; bundle=$Bundle; active=$true; phase='prepared' }
Write-JevJson $statePath $state
& (Join-Path $PSScriptRoot 'Stop-Bridge.ps1')
try {
    & (Join-Path $PSScriptRoot 'Invoke-NativeSwitch.ps1') -Receipt $receipt
    $state.phase = 'installed'
    Write-JevJson $statePath $state
} catch {
    Write-Warning "Native installation was not confirmed. Standard adapter remains installed. Replacement/rollback receipt: $receipt"
    throw
} finally { & (Join-Path $PSScriptRoot 'Start-Bridge.ps1') }
Write-Host 'Use Rollback-Native.cmd to restore the backed-up native components. Reopen applications before checking automatic refresh.'
