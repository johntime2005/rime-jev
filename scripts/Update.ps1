param([switch]$NoDeploy, [switch]$NoStart, [switch]$Autostart, [switch]$ManagedApp, [switch]$NoShortcuts)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Installer.Common.ps1')
Assert-JevNativeInactive
$project = Split-Path -Parent $PSScriptRoot
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$manifestPath = Join-Path $data 'installation.json'
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$oldProject = $manifest.project
$updates = @($manifest.files | Where-Object { $_.relative -in @('lua\jev_windows.lua', 'rime_ice_jev.schema.yaml') })
if ($updates.Count -ne 2) { throw 'Unexpected installation manifest.' }
foreach ($file in $manifest.files) {
    $dest = Join-JevPath $manifest.rime $file.relative
    Assert-JevPlainPath $dest
    if ((Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $file.installedHash) {
        throw "User changes detected: $dest. Merge manually; no files updated."
    }
}
$backup = Join-Path $data ('backups\update-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
Copy-Item -LiteralPath $manifestPath -Destination (Join-Path $backup 'installation.json')
foreach ($file in $updates) {
    Copy-Item -LiteralPath (Join-JevPath $manifest.rime $file.relative) -Destination (Join-Path $backup ($file.relative.Replace('\', '__')))
}
$startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Rime Jev Bridge.lnk'
$hadStartup = -not $NoShortcuts -and (Test-Path -LiteralPath $startup)
if ($hadStartup) { Copy-Item -LiteralPath $startup -Destination (Join-Path $backup 'startup.lnk') }
& (Join-Path $PSScriptRoot 'Stop-Bridge.ps1')
try {
    foreach ($file in $updates) {
        $dest = Join-JevPath $manifest.rime $file.relative
        Copy-Item -LiteralPath (Join-JevPath $project $file.relative) -Destination $dest
        $file.installedHash = (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash
    }
    $manifest.project = $project
    if ($ManagedApp) { $manifest | Add-Member -NotePropertyName managedApp -NotePropertyValue $true -Force }
    Write-JevJson $manifestPath $manifest
    if (-not $NoDeploy) { & (Join-Path $PSScriptRoot 'Deploy.ps1') -RimeUserDir $manifest.rime -WeaselRoot $manifest.weasel }
    if (-not $NoShortcuts -and ($Autostart -or $hadStartup)) { Set-JevAutostart $project }
    if (-not $NoStart) { & (Join-Path $PSScriptRoot 'Start-Bridge.ps1') }
} catch {
    $failure = $_
    try { & (Join-Path $PSScriptRoot 'Stop-Bridge.ps1') } catch { Write-Warning $_.Exception.Message }
    foreach ($file in $updates) {
        Copy-Item -LiteralPath (Join-Path $backup ($file.relative.Replace('\', '__'))) -Destination (Join-JevPath $manifest.rime $file.relative) -Force
    }
    Copy-Item -LiteralPath (Join-Path $backup 'installation.json') -Destination $manifestPath -Force
    if ($hadStartup) { Copy-Item -LiteralPath (Join-Path $backup 'startup.lnk') -Destination $startup -Force }
    elseif (-not $NoShortcuts -and (Test-Path -LiteralPath $startup)) { Remove-Item -LiteralPath $startup -Force }
    if (-not $NoDeploy) {
        try { & (Join-Path $PSScriptRoot 'Deploy.ps1') -RimeUserDir $manifest.rime -WeaselRoot $manifest.weasel }
        catch { Write-Warning "Adapter files restored. Redeploy manually; backup: $backup" }
    }
    if (-not $NoStart) { & (Join-Path $oldProject 'scripts\Start-Bridge.ps1') }
    throw $failure
}
Write-Output "Updated; previous version backed up at $backup. Original uninstall backups retained."
