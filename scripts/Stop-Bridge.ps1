$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Installer.Common.ps1')
$project = Split-Path -Parent $PSScriptRoot
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$installationPath = Join-Path $data 'installation.json'
if (Test-Path -LiteralPath $installationPath) {
    $installation = Get-Content -LiteralPath $installationPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($installation.project) { $project = [IO.Path]::GetFullPath($installation.project) }
}
$lock = Join-Path $data 'runtime\bridge.lock'
if (Test-Path -LiteralPath $lock) {
    $bridgePid = [int](Get-Content -LiteralPath $lock -Raw)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$bridgePid" -ErrorAction SilentlyContinue
    if (Test-JevBridgeProcess $process $project $data) {
        Stop-Process -Id $bridgePid -ErrorAction Stop
        Wait-Process -Id $bridgePid -Timeout 10 -ErrorAction SilentlyContinue
        if (Get-Process -Id $bridgePid -ErrorAction SilentlyContinue) { throw 'Bridge did not stop; the lock was retained.' }
    } elseif ($process) {
        throw 'PID belongs to another process; nothing was stopped.'
    }
    Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath (Join-Path $data 'runtime\bridge.info') -Force -ErrorAction SilentlyContinue
Write-Output 'Jev bridge stopped. Normal Rime typing still works.'
