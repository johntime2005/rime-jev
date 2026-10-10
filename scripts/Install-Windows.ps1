param(
    [switch]$Native,
    [switch]$NoConfigure,
    [switch]$NoAutostart,
    [switch]$NoDeploy,
    [switch]$NoStart,
    [switch]$NoShortcuts,
    [switch]$Check,
    [string]$RimeUserDir,
    [string]$WeaselRoot
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Installer.Common.ps1')
Assert-JevNativeInactive
$source = Split-Path -Parent $PSScriptRoot
$paths = Get-JevPaths $RimeUserDir $WeaselRoot
$null = Get-JevArchitecture
$incoming = Join-Path $source 'package-manifest.json'
if (Test-Path -LiteralPath $incoming) { $null = Test-JevManifest $source }
$names = @(Get-Content -LiteralPath (Join-Path $source 'distribution-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
$bundle = Join-Path $source 'native-bundle'
if (Test-Path -LiteralPath (Join-Path $bundle 'manifest.json')) {
    $nativeManifest = Test-JevManifest $bundle 'manifest.json'
    $names += @($nativeManifest.files.PSObject.Properties.Name | ForEach-Object { 'native-bundle/' + $_ })
    $names += 'native-bundle/manifest.json'
}
$hashes = [ordered]@{}
foreach ($name in ($names | Sort-Object)) {
    $path = Join-JevPath $source $name
    Assert-JevPlainPath $path
    if ($hashes.Contains($name) -or -not (Test-Path -LiteralPath $path -PathType Leaf)) { throw "Missing or duplicate package file: $name" }
    $hashes[$name] = (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash.ToLowerInvariant()
}
if ($Native) {
    if (-not $Check -and ($NoDeploy -or $NoStart)) { throw 'Native replacement cannot be combined with NoDeploy or NoStart.' }
    # Compatibility checks and explicit consent happen before even installing the adapter.
    & (Join-Path $PSScriptRoot 'Install-Native.ps1') -Bundle $bundle -Check -RimeUserDir $paths.Rime -WeaselRoot $paths.Weasel
}
$manifestPath = Join-Path $paths.Data 'installation.json'
$existing = $null
if (Test-Path -LiteralPath $manifestPath) {
    $existing = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ((Get-JevFullPath $existing.rime).TrimEnd('\') -ne $paths.Rime) { throw 'This account already has Jev in a different Rime directory.' }
    if ($existing.weasel -and (Get-JevFullPath $existing.weasel).TrimEnd('\') -ne $paths.Weasel) {
        throw 'Weasel moved since installation. Restore/uninstall the previous adapter before changing its runtime directory.'
    }
    foreach ($file in $existing.files) {
        $path = Join-JevPath $paths.Rime $file.relative
        Assert-JevPlainPath $path
        if (-not (Test-Path -LiteralPath $path -PathType Leaf) -or
            (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.installedHash) {
            throw "Installed file has local changes; nothing was overwritten: $path. Merge it before updating."
        }
    }
    if ($existing.managedApp) { $null = Test-JevManifest $existing.project }
} else {
    $default = Join-Path $paths.Rime 'default.custom.yaml'
    $text = if (Test-Path -LiteralPath $default) { [IO.File]::ReadAllText($default) } else { '' }
    $null = Add-JevSchemaPatch $text
}
Write-Host "Rime user directory: $($paths.Rime)"
Write-Host "Weasel: $($paths.Weasel)"
Write-Host "Private application/data directory: $($paths.Data)"
Write-Host 'Keys, provider endpoints, personal dictionaries, skin and context permissions are NOT imported from this package.'
if ($Check) {
    Write-Host 'Read-only preflight passed. Dependencies, deployment and visible IME behavior have not been tested.'
    return
}
if ($Native) {
    Write-Warning 'EXPERIMENTAL: replaces matched x64 Weasel components after backup and requests UAC authorization.'
    Write-Warning 'Only x64 TSF gains automatic refresh; x86/IMM do not. Save your work; reopen applications after installation.'
    if ((Read-Host 'Type INSTALL NATIVE to continue (anything else cancels without changes)') -cne 'INSTALL NATIVE') {
        Write-Host 'Cancelled. No installation changes.'
        return
    }
}
& (Join-Path $PSScriptRoot 'Install-Dependencies.ps1') -RimeUserDir $paths.Rime -WeaselRoot $paths.Weasel

$identity = ($hashes.GetEnumerator() | ForEach-Object { $_.Key + ':' + $_.Value }) -join "`n"
$sha = [Security.Cryptography.SHA256]::Create()
try { $id = ([BitConverter]::ToString($sha.ComputeHash([Text.Encoding]::UTF8.GetBytes($identity)))).Replace('-', '').ToLowerInvariant().Substring(0,24) }
finally { $sha.Dispose() }
$apps = Join-Path $paths.Data 'app'
$app = Join-JevPath $apps $id
Assert-JevPlainPath $app
if (Test-Path -LiteralPath $app) {
    $installedPackage = Test-JevManifest $app
    if (@($installedPackage.files.PSObject.Properties).Count -ne $hashes.Count) { throw 'Managed application file list differs; no files overwritten.' }
    foreach ($name in $hashes.Keys) {
        if ($installedPackage.files.$name -ne $hashes[$name]) { throw 'Managed application content differs; no files overwritten.' }
    }
} else {
    $stage = Join-JevPath $apps ('staging-' + [guid]::NewGuid().ToString('N'))
    try {
        New-Item -ItemType Directory -Path $stage -Force | Out-Null
        foreach ($name in $hashes.Keys) {
            $dest = Join-JevPath $stage $name
            New-Item -ItemType Directory -Path (Split-Path -Parent $dest) -Force | Out-Null
            Copy-Item -LiteralPath (Join-JevPath $source $name) -Destination $dest
        }
        Write-JevJson (Join-Path $stage 'package-manifest.json') @{ format=1; kind='installed-application'; files=$hashes }
        $null = Test-JevManifest $stage
        # Both absolute directory paths were validated under the per-user app root.
        Assert-JevPlainPath $stage
        Move-Item -LiteralPath $stage -Destination $app
    } finally {
        Remove-JevStagingDirectory $apps $stage
    }
}

$installedScripts = Join-Path $app 'scripts'
if ($existing) {
    & (Join-Path $installedScripts 'Update.ps1') -NoDeploy:$NoDeploy -NoStart:$NoStart -Autostart:(-not $NoAutostart -and -not $NoShortcuts) -NoShortcuts:$NoShortcuts -ManagedApp
} else {
    & (Join-Path $installedScripts 'Install.ps1') -RimeUserDir $paths.Rime -WeaselRoot $paths.Weasel -NoDeploy:$NoDeploy -NoStart:$NoStart -Autostart:(-not $NoAutostart -and -not $NoShortcuts)
    $installed = Get-Content -LiteralPath $manifestPath -Raw -Encoding UTF8 | ConvertFrom-Json
    $installed | Add-Member -NotePropertyName managedApp -NotePropertyValue $true -Force
    Write-JevJson $manifestPath $installed
}
if (-not $NoShortcuts) {
    $programs = Join-Path ([Environment]::GetFolderPath('Programs')) 'Rime Jev'
    New-Item -ItemType Directory -Path $programs -Force | Out-Null
    foreach ($item in @('Configure', 'Status', 'Uninstall', 'Rollback-Native')) {
        $shortcut = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $programs ($item + '.lnk')))
        $shortcut.TargetPath = Join-Path $app ($item + '.cmd')
        $shortcut.WorkingDirectory = $app
        $shortcut.Save()
    }
}
if ($Native) { & (Join-Path $installedScripts 'Install-Native.ps1') -Bundle (Join-Path $app 'native-bundle') -ConsentGiven -RimeUserDir $paths.Rime -WeaselRoot $paths.Weasel }
Write-Host "Installed application: $app"
Write-Host 'You may now delete the downloaded ZIP and its extracted folder. Shortcuts use the managed application, not Downloads.'
if (-not $Native) { Write-Warning 'Standard Weasel: requests are asynchronous, but stop-typing candidate refresh requires the optional experimental native bundle.' }
if (-not $NoConfigure) { & (Join-Path $installedScripts 'Configure.ps1') }
