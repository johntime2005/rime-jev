param([Parameter(Mandatory=$true)][string]$Receipt, [switch]$Rollback)
$ErrorActionPreference = 'Stop'
$Receipt = (Resolve-Path -LiteralPath $Receipt).Path
$r = Get-Content -LiteralPath $Receipt -Raw | ConvertFrom-Json
$result = Join-Path (Split-Path -Parent $Receipt) 'switch-result.json'
$manifestPath = Join-Path $env:LOCALAPPDATA 'RimeJev\installation.json'
$installation = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
foreach ($file in $installation.files) {
    $path = Join-Path $installation.rime $file.relative
    if ((Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.installedHash) {
        throw "Installed adapter differs from installation manifest: $path"
    }
}
$script = Join-Path $PSScriptRoot 'Switch-Native.ps1'
$arguments = '-NoProfile -ExecutionPolicy Bypass -File "' + $script + '" -Receipt "' + $Receipt + '"'
if ($Rollback) { $arguments += ' -Rollback' }
$process = Start-Process -FilePath "$env:windir\System32\WindowsPowerShell\v1.0\powershell.exe" -ArgumentList $arguments -Verb RunAs -WindowStyle Hidden -PassThru
$process.WaitForExit()
if (-not (Test-Path -LiteralPath $result)) { throw 'No switch result. Administrator authorization may have been declined.' }
$status = Get-Content -LiteralPath $result -Raw | ConvertFrom-Json
# Always restart the currently installed server under this ordinary user token.
$server = Join-Path $r.installRoot 'WeaselServer.exe'
if (-not (Get-Process WeaselServer -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $server })) {
    Start-Process -FilePath $server -WorkingDirectory $r.installRoot -WindowStyle Hidden
}
if ($status.phase -ne 'files-switched') { throw $status.message }
foreach ($file in $installation.files) {
    if ($file.relative -in @('lua\jev_windows.lua', 'rime_ice_jev.schema.yaml')) {
        $file.installedHash = (Get-FileHash -LiteralPath (Join-Path $installation.rime $file.relative) -Algorithm SHA256).Hash
    }
}
$installation | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
& (Join-Path $PSScriptRoot 'Deploy.ps1')
Start-Sleep -Seconds 2
$running = @(Get-Process WeaselServer -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $server })
if (-not $running.Count) { throw 'Files switched but server not running. Use rollback.' }
Write-Output ('Native switch completed; server PID: ' + ($running.Id -join ','))
Write-Output 'Reopen applications to load the new TSF DLL; GUI behavior still needs verification.'
