$ErrorActionPreference = 'Stop'
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$manifestPath = Join-Path $data 'installation.json'
if (-not (Test-Path -LiteralPath $manifestPath)) { throw 'No installation manifest.' }
$manifest = Get-Content -LiteralPath $manifestPath -Raw | ConvertFrom-Json
$rime = [IO.Path]::GetFullPath($manifest.rime).TrimEnd('\')
# Validate all paths and hashes BEFORE stopping or changing anything.
foreach ($file in $manifest.files) {
    $dest = [IO.Path]::GetFullPath((Join-Path $rime $file.relative))
    if (-not $dest.StartsWith($rime + '\', [StringComparison]::OrdinalIgnoreCase)) { throw 'Invalid target path.' }
    if ((Test-Path -LiteralPath $dest) -and (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $file.installedHash) {
        throw "File changed after install; refusing to overwrite: $dest. Merge backup manually."
    }
}
& (Join-Path $PSScriptRoot 'Stop-Bridge.ps1')
foreach ($file in $manifest.files) {
    $dest = Join-Path $rime $file.relative
    if ($file.existed) { Copy-Item -LiteralPath $file.backup -Destination $dest }
    else { Remove-Item -LiteralPath $dest -Force -ErrorAction SilentlyContinue }
}
$link = Join-Path ([Environment]::GetFolderPath('Startup')) 'Rime Jev Bridge.lnk'
Remove-Item -LiteralPath $link -Force -ErrorAction SilentlyContinue
Remove-Item -LiteralPath $manifestPath -Force
& (Join-Path $PSScriptRoot 'Deploy.ps1')
Write-Output "Original configuration restored. Backups and encrypted key retained at $data."
