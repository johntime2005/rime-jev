param([switch]$NoDeploy, [switch]$NoShortcuts)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Installer.Common.ps1')
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$manifestPath = Join-Path $data 'installation.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'No installation manifest.' }
$nativePath = Join-Path $data 'native-installation.json'
if ((Test-Path -LiteralPath $nativePath) -and (Get-Content -LiteralPath $nativePath -Raw -Encoding UTF8 | ConvertFrom-Json).active) {
    throw 'Roll back the experimental native components with Rollback-Native.cmd before uninstalling the adapter.'
}
$manifest = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
$rime = [IO.Path]::GetFullPath($manifest.rime).TrimEnd('\')
$backupRoot = [IO.Path]::GetFullPath($manifest.backup).TrimEnd('\')
$dataRoot = [IO.Path]::GetFullPath($data).TrimEnd('\')
if (-not $backupRoot.StartsWith($dataRoot + '\backups\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid backup directory.' }
Assert-JevPlainPath $rime
Assert-JevPlainPath $backupRoot
$allowed = @('default.custom.yaml', 'rime_ice_jev.schema.yaml', 'lua\jev_windows.lua')
if (@($manifest.files).Count -ne 3 -or @($manifest.files.relative | Select-Object -Unique).Count -ne 3) {
    throw 'Unexpected installation file list.'
}
# Validate all paths and hashes BEFORE stopping or changing anything.
foreach ($file in $manifest.files) {
    if ($file.relative -notin $allowed) { throw 'Unexpected uninstall target.' }
    $dest = Join-JevPath $rime $file.relative
    Assert-JevPlainPath $dest
    if ((Test-Path -LiteralPath $dest) -and (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $file.installedHash) {
        throw "File changed after install; refusing to overwrite: $dest. Merge backup manually."
    }
    if ($file.existed) {
        $source = [IO.Path]::GetFullPath($file.backup)
        if (-not $source.StartsWith($backupRoot + '\', [StringComparison]::OrdinalIgnoreCase) -or
            -not (Test-Path -LiteralPath $source -PathType Leaf)) { throw 'Missing or invalid uninstall backup.' }
        Assert-JevPlainPath $source
        if ($file.originalHash -and (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash -ne $file.originalHash) {
            throw "Uninstall backup changed: $source"
        }
    }
}
& (Join-Path $PSScriptRoot 'Stop-Bridge.ps1')
foreach ($file in $manifest.files) {
    $dest = Join-JevPath $rime $file.relative
    if ($file.existed) { Copy-Item -LiteralPath $file.backup -Destination $dest }
    else { Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue }
}
if (-not $NoShortcuts) { Remove-JevShortcuts $manifest.project }
Remove-Item -LiteralPath $manifestPath -Force
if (-not $NoDeploy) { & (Join-Path $PSScriptRoot 'Deploy.ps1') -RimeUserDir $rime -WeaselRoot $manifest.weasel }
Write-Output "Original configuration restored. Backups, downloaded Rime Ice dictionaries, managed application and encrypted key retained at $data."
