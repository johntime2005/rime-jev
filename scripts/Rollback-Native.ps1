$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Installer.Common.ps1')
$path = Join-Path $env:LOCALAPPDATA 'RimeJev\native-installation.json'
if (-not (Test-Path -LiteralPath $path)) { throw 'No managed native installation. For an older manual trial, use its original replacement receipt.' }
$state = Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json
if (-not $state.active) { Write-Host 'Native components are already rolled back.'; return }
& (Join-Path $PSScriptRoot 'Stop-Bridge.ps1')
try {
    & (Join-Path $PSScriptRoot 'Invoke-NativeSwitch.ps1') -Receipt $state.receipt -Rollback
    $state.active = $false
    Write-JevJson $path $state
} finally { & (Join-Path $PSScriptRoot 'Start-Bridge.ps1') }
