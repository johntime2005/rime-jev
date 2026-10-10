param(
    [string]$Bundle = (Join-Path (Split-Path -Parent $PSScriptRoot) 'runtime\native-bundle'),
    [switch]$PassThru,
    [string]$RimeUserDir,
    [string]$WeaselRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Installer.Common.ps1')
$project = Split-Path -Parent $PSScriptRoot
$null = Test-JevManifest $Bundle 'manifest.json'
$paths = Get-JevPaths $RimeUserDir $WeaselRoot
$root = $paths.Weasel
$user = $paths.Rime
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$clsid = 'Registry::HKEY_CLASSES_ROOT\CLSID\{A3F4CDED-B1E9-41EE-9CA6-7B4D0DE6CB0A}\InprocServer32'
$registeredDll = [IO.Path]::GetFullPath((Get-Item -LiteralPath $clsid).GetValue(''))
$backup = Join-Path $data ('backups\native-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
$files = @(
    @{ path=(Join-Path $root 'WeaselServer.exe'); name='WeaselServer.exe' },
    @{ path=(Join-Path $root 'weaselx64.dll'); name='weaselx64.dll' },
    @{ path=(Join-Path $user 'lua\jev_windows.lua'); name='jev_windows.lua' },
    @{ path=(Join-Path $user 'rime_ice_jev.schema.yaml'); name='rime_ice_jev.schema.yaml' },
    @{ path=(Join-Path $data 'installation.json'); name='installation.json' }
)
if ($registeredDll -ne (Join-Path $root 'weaselx64.dll')) {
    $files += @{ path=$registeredDll; name='registered-tsf-x64.dll' }
}
foreach ($file in $files) {
    if (-not (Test-Path -LiteralPath $file.path -PathType Leaf)) { throw "Missing installed input: $($file.path)" }
}
New-Item -ItemType Directory -Path $backup | Out-Null
$records = foreach ($file in $files) {
    $dest = Join-Path $backup $file.name
    $before = (Get-FileHash -LiteralPath $file.path -Algorithm SHA256).Hash
    Copy-Item -LiteralPath $file.path -Destination $dest
    if ((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $before) { throw 'Backup verification failed.' }
    [pscustomobject]@{ path=$file.path; backup=$dest; sha256=$before }
}
$dll = $registeredDll
$holders = @(Get-Process | ForEach-Object {
    $process = $_
    try {
        $process.Modules | Where-Object { $_.FileName -eq $dll } | ForEach-Object {
            [pscustomobject]@{ pid=$process.Id; name=$process.ProcessName }
        }
    } catch { }
})
$writable = $false
try {
    # Request write access without modifying any bytes or renaming a loaded DLL.
    $handle = [IO.File]::Open($dll, [IO.FileMode]::Open, [IO.FileAccess]::ReadWrite, [IO.FileShare]::Read)
    $handle.Dispose()
    $writable = $true
} catch { $writeError = $_.Exception.Message }
$receipt = [ordered]@{
    format=1; phase='backup-only'; createdUtc=[DateTime]::UtcNow.ToString('o')
    installRoot=$root; rimeUserDir=$user; registeredTsfDll=$registeredDll
    bundle=[IO.Path]::GetFullPath($Bundle)
    bundleManifestHash=(Get-FileHash -LiteralPath (Join-Path $Bundle 'manifest.json') -Algorithm SHA256).Hash
    files=@($records); observedDllHolders=$holders; dllWritableNow=$writable
    writeError=$writeError; guiAccepted=$false
    note='No installed files changed. Process enumeration can miss protected processes. Recheck immediately before replacement.'
}
$receipt | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath (Join-Path $backup 'replacement.json') -Encoding UTF8
if ($PassThru) { return (Join-Path $backup 'replacement.json') }
$receipt | ConvertTo-Json -Depth 6
Write-Output "Verified replacement backup: $backup"
