param([switch]$NoDeploy)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$manifestPath = Join-Path $data 'installation.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$updates = @($manifest.files | Where-Object { $_.relative -in @('lua\jev_windows.lua', 'rime_ice_jev.schema.yaml') })
if ($updates.Count -ne 2) { throw 'Unexpected installation manifest.' }
foreach ($file in $manifest.files) {
    $dest = Join-Path $manifest.rime $file.relative
    if ((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $file.installedHash) {
        throw "User changes detected: $dest. Merge manually; no files updated."
    }
}
$backup = Join-Path $data ('backups\update-' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $backup 'installation.json')
foreach ($file in $updates) {
    $dest = Join-Path $manifest.rime $file.relative
    Copy-Item -LiteralPath $dest -Destination (Join-Path $backup ($file.relative.Replace('\', '__')))
    Copy-Item -LiteralPath (Join-Path $project $file.relative) -Destination $dest
    $file.installedHash = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
}
$manifest | ConvertTo-Json -Depth 6 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
if (-not $NoDeploy) { & (Join-Path $PSScriptRoot 'Deploy.ps1') }
Write-Output "Updated; previous version backed up at $backup. Original uninstall backups retained."
