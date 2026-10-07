$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$lock = Join-Path $data 'runtime\bridge.lock'
if (Test-Path -LiteralPath $lock) {
    $bridgePid = [int](Get-Content -LiteralPath $lock -Raw)
    $process = Get-CimInstance Win32_Process -Filter "ProcessId=$bridgePid" -ErrorAction SilentlyContinue
    $expectedScript = Join-Path $project 'bridge.mjs'
    if ($process -and $process.Name -eq 'node.exe' -and $process.CommandLine.Contains($expectedScript) -and $process.CommandLine.Contains($data)) {
        Stop-Process -Id $bridgePid -ErrorAction Stop
        Start-Sleep -Milliseconds 300
    } elseif ($process) {
        throw 'PID belongs to another process; nothing was stopped.'
    }
    Remove-Item -LiteralPath $lock -Force -ErrorAction SilentlyContinue
}
Remove-Item -LiteralPath (Join-Path $data 'runtime\bridge.info') -Force -ErrorAction SilentlyContinue
Write-Output 'Jev bridge stopped. Normal Rime typing still works.'
