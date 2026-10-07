param([switch]$NoDeploy, [switch]$Autostart)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$rime = (Get-ItemProperty 'HKCU:\Software\Rime\Weasel' -ErrorAction Stop).RimeUserDir
if (-not $rime) { $rime = Join-Path $env:APPDATA 'Rime' }
$weasel = (Get-ItemProperty 'HKLM:\Software\WOW6432Node\Rime\Weasel' -ErrorAction Stop).WeaselRoot
if (-not (Test-Path -LiteralPath (Join-Path $weasel 'data\rime_ice.schema.yaml'))) { throw 'Existing rime_ice schema required.' }
Get-Command node.exe -ErrorAction Stop | Out-Null
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
New-Item -ItemType Directory -Path $data -Force | Out-Null
# Restrict IPC, encrypted credentials and backups to this account and SYSTEM.
$sid = [System.Security.Principal.WindowsIdentity]::GetCurrent().User.Value
& icacls.exe $data /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
if ($LASTEXITCODE -ne 0) { throw 'Could not secure data directory.' }
New-Item -ItemType Directory -Path (Join-Path $data 'runtime\inbox'),(Join-Path $data 'runtime\outbox'),(Join-Path $rime 'lua') -Force | Out-Null
$manifestPath = Join-Path $data 'installation.json'
if (Test-Path -LiteralPath $manifestPath) { throw 'Already installed. Use Uninstall.ps1 before reinstalling; existing backups were not overwritten.' }
$backup = Join-Path $data ('backups\' + (Get-Date -Format 'yyyyMMdd-HHmmss'))
New-Item -ItemType Directory -Path $backup -Force | Out-Null
$targets = @(
    @{ relative = 'default.custom.yaml'; source = $null },
    @{ relative = 'rime_ice_jev.schema.yaml'; source = 'rime_ice_jev.schema.yaml' },
    @{ relative = 'lua\jev_windows.lua'; source = 'lua\jev_windows.lua' }
)
$manifest = @{ project = $project; rime = $rime; backup = $backup; files = @() }
foreach ($target in $targets) {
    $dest = Join-Path $rime $target.relative
    $exists = Test-Path -LiteralPath $dest
    $backupFile = Join-Path $backup ($target.relative.Replace('\', '__'))
    if ($exists) { Copy-Item -LiteralPath $dest -Destination $backupFile }
    $manifest.files += @{ relative = $target.relative; existed = $exists; backup = $backupFile }
}
$default = Join-Path $rime 'default.custom.yaml'
$content = if (Test-Path -LiteralPath $default) { [IO.File]::ReadAllText($default) } else { "patch:`n" }
if ($content -match 'rime_ice_jev|(?m)^\s*["'']?schema_list/\+') { throw 'Existing schema list extension needs manual merge; no Rime files changed.' }
if ($content -notmatch '(?m)^patch:\s*$') { throw 'Cannot find patch:; no Rime files changed.' }
# Keep every original byte except the appended additive schema-list patch.
$content = $content.TrimEnd("`r", "`n") + "`n  # rime-jev: additive, original schema and UI remain unchanged.`n  `"schema_list/+`":`n    - {schema: rime_ice_jev}`n"
[IO.File]::WriteAllText($default, $content, (New-Object Text.UTF8Encoding($false)))
foreach ($target in $targets) {
    if ($target.source) { Copy-Item -LiteralPath (Join-Path $project $target.source) -Destination (Join-Path $rime $target.relative) }
}
foreach ($file in $manifest.files) { $file.installedHash = (Get-FileHash -LiteralPath (Join-Path $rime $file.relative) -Algorithm SHA256).Hash }
$manifest | ConvertTo-Json -Depth 5 | Set-Content -LiteralPath $manifestPath -Encoding UTF8
if (-not (Test-Path -LiteralPath (Join-Path $data 'config.json'))) { '{"callLimit":200}' | Set-Content -LiteralPath (Join-Path $data 'config.json') -Encoding Ascii }
if ($Autostart) {
    $startup = [Environment]::GetFolderPath('Startup')
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startup 'Rime Jev Bridge.lnk'))
    $link.TargetPath = (Get-Command powershell.exe).Source
    $link.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $PSScriptRoot 'Start-Bridge.ps1') + '" -Foreground'
    $link.WorkingDirectory = $project
    $link.WindowStyle = 7
    $link.Save()
}
& (Join-Path $PSScriptRoot 'Start-Bridge.ps1')
if (-not $NoDeploy) {
    & (Join-Path $PSScriptRoot 'Deploy.ps1')
}
Write-Output "Installed. Backup: $backup"
Write-Output 'F4 -> rime_ice_jev. F8 toggles automatic requests; Ctrl+Alt+F8 diagnostic refresh. Ctrl+F8 clears context.'
