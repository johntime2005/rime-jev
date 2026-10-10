param([switch]$Foreground)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Installer.Common.ps1')
$project = Split-Path -Parent $PSScriptRoot
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$node = Get-JevNode
if (-not $node) { throw 'Node 22.17+ was not found. Run Install.cmd to repair dependencies.' }
if (-not $Foreground) {
    $lock = Join-Path $data 'runtime\bridge.lock'
    if (Test-Path -LiteralPath $lock) {
        $bridgePid = [int](Get-Content -LiteralPath $lock -Raw)
        $running = Get-CimInstance Win32_Process -Filter "ProcessId=$bridgePid" -ErrorAction SilentlyContinue
        if ($running) {
            if (-not (Test-JevBridgeProcess $running $project $data)) { throw 'Another process owns the bridge lock; nothing was started.' }
            Write-Output 'Bridge is already running. Use Status.cmd to check its health.'
            return
        }
    }
    # Preserve the PowerShell edition and its PSModulePath. Launching Windows
    # PowerShell from pwsh can break Security-module autoload and hide the key.
    $ps = Join-Path $PSHOME 'pwsh.exe'
    if (-not (Test-Path -LiteralPath $ps)) { $ps = Join-Path $PSHOME 'powershell.exe' }
    $args = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Foreground' -f $PSCommandPath
    $launcher = Start-Process -FilePath $ps -ArgumentList $args -WorkingDirectory $project -WindowStyle Hidden -PassThru
    $ready = $false
    for ($i=0; $i -lt 50; $i++) {
        Start-Sleep -Milliseconds 100
        $statusFile = Join-Path $data 'status.json'
        try {
            $status = Get-Content -LiteralPath $statusFile -Raw -Encoding UTF8 | ConvertFrom-Json
            $updated = if ($status.updatedAt -is [datetime]) { [DateTimeOffset]$status.updatedAt } else { [DateTimeOffset]::Parse([string]$status.updatedAt) }
            $age = [DateTimeOffset]::UtcNow - $updated
            if ($age -ge [TimeSpan]::Zero -and $age -lt [TimeSpan]::FromSeconds(3) -and (Test-Path -LiteralPath $lock)) {
                $bridgePid = [int](Get-Content -LiteralPath $lock -Raw)
                $running = Get-CimInstance Win32_Process -Filter "ProcessId=$bridgePid" -ErrorAction SilentlyContinue
                if ($status.pid -eq $bridgePid -and (Test-JevBridgeProcess $running $project $data)) { $ready = $true; break }
            }
        } catch { }
        if ($launcher.HasExited) { break }
    }
    if (-not $ready) { throw 'Bridge did not become ready. Check %LOCALAPPDATA%\RimeJev\bridge-errors.log.' }
    Write-Output 'Bridge is ready. Automatic requests remain controlled by your local preferences.'
    return
}
$secretFile = Join-Path $data 'key.dpapi'
Remove-Item Env:TYPESAFE_API_KEY -ErrorAction SilentlyContinue
try {
    if (Test-Path -LiteralPath $secretFile) {
        try {
            $secure = (Get-Content -LiteralPath $secretFile -Raw).Trim() | ConvertTo-SecureString
            $cred = New-Object System.Net.NetworkCredential('', $secure)
            $env:TYPESAFE_API_KEY = $cred.Password
        } catch {
            # Never print the stored value or attempt to interpret it as plaintext.
            Remove-Item Env:TYPESAFE_API_KEY -ErrorAction SilentlyContinue
            Write-Warning ('Key load failure category: ' + $_.Exception.GetType().Name + ' / ' + $_.FullyQualifiedErrorId)
            Write-Warning 'Stored key cannot be decrypted. Starting without it; use Configure.cmd to replace it.'
        }
    }
    & $node (Join-Path $project 'bridge.mjs') $data 2>> (Join-Path $data 'bridge-errors.log')
} finally {
    Remove-Item Env:TYPESAFE_API_KEY -ErrorAction SilentlyContinue
}
