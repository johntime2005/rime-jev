param(
    [switch]$NoDeploy,
    [switch]$Autostart,
    [switch]$NoStart,
    [string]$RimeUserDir,
    [string]$WeaselRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Installer.Common.ps1')
$project = Split-Path -Parent $PSScriptRoot
$paths = Get-JevPaths $RimeUserDir $WeaselRoot
$rime = $paths.Rime
$data = $paths.Data
$manifestPath = Join-Path $data 'installation.json'
if (Test-Path -LiteralPath $manifestPath) { throw 'Already installed. Use Install.cmd to verify or update it; uninstall backups were not overwritten.' }
$hasIce = (Test-Path -LiteralPath (Join-Path $rime 'rime_ice.schema.yaml') -PathType Leaf) -or
    (Test-Path -LiteralPath (Join-Path $paths.Weasel 'data\rime_ice.schema.yaml') -PathType Leaf)
if (-not $hasIce) { throw 'Rime Ice is required. Use Install.cmd to install its pinned dependencies automatically.' }
if (-not (Get-JevNode)) { throw 'Node 22.17+ is required. Use Install.cmd for per-user dependency installation.' }

$default = Join-Path $rime 'default.custom.yaml'
$content = if (Test-Path -LiteralPath $default) { [IO.File]::ReadAllText($default) } else { "patch:`n" }
$patched = Add-JevSchemaPatch $content
$targets = @(
    @{ relative='default.custom.yaml'; source=$null },
    @{ relative='rime_ice_jev.schema.yaml'; source='rime_ice_jev.schema.yaml' },
    @{ relative='lua\jev_windows.lua'; source='lua\jev_windows.lua' }
)
foreach ($target in $targets) {
    $dest = Join-JevPath $rime $target.relative
    Assert-JevPlainPath $dest
    if ($target.source -and -not (Test-Path -LiteralPath (Join-JevPath $project $target.source) -PathType Leaf)) {
        throw "Missing adapter source: $($target.source)"
    }
}
Initialize-JevData $data
$backup = Join-Path $data ('backups\install-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '-' + [guid]::NewGuid().ToString('N').Substring(0,8))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$manifest = @{ format=2; project=$project; rime=$rime; weasel=$paths.Weasel; backup=$backup; files=@() }
foreach ($target in $targets) {
    $dest = Join-JevPath $rime $target.relative
    $exists = Test-Path -LiteralPath $dest -PathType Leaf
    $backupFile = Join-Path $backup ($target.relative.Replace('\', '__'))
    if ($exists) { Copy-Item -LiteralPath $dest -Destination $backupFile }
    $originalHash = if ($exists) { (Get-FileHash -LiteralPath $backupFile -Algorithm SHA256).Hash } else { $null }
    $manifest.files += @{ relative=$target.relative; existed=$exists; backup=$backupFile; originalHash=$originalHash }
}
$startupLink = Join-Path ([Environment]::GetFolderPath('Startup')) 'Rime Jev Bridge.lnk'
$hadStartup = Test-Path -LiteralPath $startupLink
if ($Autostart -and $hadStartup) { Copy-Item -LiteralPath $startupLink -Destination (Join-Path $backup 'startup.lnk') }
$startAttempted = $false
try {
    New-Item -ItemType Directory -Path (Join-Path $rime 'lua'),(Join-Path $data 'runtime\inbox'),(Join-Path $data 'runtime\outbox') -Force | Out-Null
    [IO.File]::WriteAllText($default, $patched, (New-Object Text.UTF8Encoding($false)))
    foreach ($target in $targets) {
        if ($target.source) { Copy-Item -LiteralPath (Join-JevPath $project $target.source) -Destination (Join-JevPath $rime $target.relative) }
    }
    foreach ($file in $manifest.files) {
        $file.installedHash = (Get-FileHash -LiteralPath (Join-JevPath $rime $file.relative) -Algorithm SHA256).Hash
    }
    Write-JevJson $manifestPath $manifest
    if (-not (Test-Path -LiteralPath (Join-Path $data 'config.json'))) { Write-JevJson (Join-Path $data 'config.json') @{ callLimit=200 } }
    $preferences = Join-Path $data 'runtime\preferences'
    if (-not (Test-Path -LiteralPath $preferences)) { [IO.File]::WriteAllText($preferences, "JEVPREF1`n0`n0`n", [Text.Encoding]::ASCII) }
    if (-not $NoDeploy) { & (Join-Path $PSScriptRoot 'Deploy.ps1') -RimeUserDir $rime -WeaselRoot $paths.Weasel }
    if ($Autostart) { Set-JevAutostart $project }
    if (-not $NoStart) {
        $startAttempted = $true
        & (Join-Path $PSScriptRoot 'Start-Bridge.ps1')
    }
} catch {
    $failure = $_
    if ($startAttempted) { try { & (Join-Path $PSScriptRoot 'Stop-Bridge.ps1') } catch { Write-Warning $_.Exception.Message } }
    foreach ($file in $manifest.files) {
        $dest = Join-JevPath $rime $file.relative
        if ($file.existed) { Copy-Item -LiteralPath $file.backup -Destination $dest -Force }
        elseif (Test-Path -LiteralPath $dest) { Remove-Item -LiteralPath $dest -Force }
    }
    if ($Autostart) {
        if ($hadStartup) { Copy-Item -LiteralPath (Join-Path $backup 'startup.lnk') -Destination $startupLink -Force }
        elseif (Test-Path -LiteralPath $startupLink) { Remove-Item -LiteralPath $startupLink -Force }
    }
    if (Test-Path -LiteralPath $manifestPath) { Remove-Item -LiteralPath $manifestPath -Force }
    if (-not $NoDeploy) {
        try { & (Join-Path $PSScriptRoot 'Deploy.ps1') -RimeUserDir $rime -WeaselRoot $paths.Weasel }
        catch { Write-Warning "Source files restored; redeploy manually. Backup: $backup" }
    }
    throw $failure
}
Write-Output "Installed. Backup: $backup"
Write-Output 'F4 -> rime_ice_jev. Cloud requests are off until enabled; F8 toggles them.'
