param([string]$RimeUserDir, [string]$WeaselRoot, [switch]$SkipIce)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Installer.Common.ps1')
$project = Split-Path -Parent $PSScriptRoot
$paths = Get-JevPaths $RimeUserDir $WeaselRoot
$lock = Get-Content -LiteralPath (Join-Path $project 'dependencies.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
Initialize-JevData $paths.Data
$cache = Join-Path $paths.Data 'downloads'
$tools = Join-Path $paths.Data 'tools'
$node = Get-JevNode
if (-not $node) {
    $arch = Get-JevArchitecture
    $dependency = $lock.node.$arch
    $zip = Get-JevDownload $dependency.url $dependency.sha256 (Join-Path $cache "node-$($lock.node.version)-$arch.zip")
    $stage = Join-JevPath $tools ('extract-' + [guid]::NewGuid().ToString('N'))
    try {
        Expand-JevZip $zip $stage { param($name) $name -match '/(node\.exe|LICENSE)$' }
        $source = Join-JevPath $stage "node-v$($lock.node.version)-win-$arch"
        $destination = Join-JevPath $tools "node-v$($lock.node.version)-$arch"
        Assert-JevPlainPath $source
        Assert-JevPlainPath $destination
        if (Test-Path -LiteralPath $destination) { throw "Incomplete portable Node directory: $destination" }
        # Both absolute paths are verified descendants of the per-user tools directory.
        Move-Item -LiteralPath $source -Destination $destination
    } finally {
        Remove-JevStagingDirectory $tools $stage
    }
    $node = Get-JevNode
    if (-not $node) { throw 'Portable Node did not start. Check antivirus or application-control policy.' }
    Remove-Item -LiteralPath $zip -Force
    Write-Host "Installed per-user Node $($lock.node.version); system PATH was not changed."
}

$hasIce = (Test-Path -LiteralPath (Join-Path $paths.Rime 'rime_ice.schema.yaml') -PathType Leaf) -or
    (Test-Path -LiteralPath (Join-Path $paths.Weasel 'data\rime_ice.schema.yaml') -PathType Leaf)
if ($hasIce -or $SkipIce) { return }

$ice = $lock.rimeIce
$zip = Get-JevDownload $ice.url $ice.sha256 (Join-Path $cache "rime-ice-$($ice.revision).zip")
$stage = Join-JevPath $cache ('ice-' + [guid]::NewGuid().ToString('N'))
$select = {
    param($name)
    $relative = ($name -split '/', 2)[1]
    return ($relative -match '^(cn_dicts|en_dicts|lua|opencc)/.+\.(yaml|txt|json|lua)$' -or $relative -eq 'lua/lunar.db' -or
        $relative -in @('rime_ice.schema.yaml','rime_ice.dict.yaml','melt_eng.schema.yaml','melt_eng.dict.yaml',
            'radical_pinyin.schema.yaml','radical_pinyin.dict.yaml','symbols_v.yaml','symbols_caps_v.yaml','default.yaml','LICENSE'))
}
$created = New-Object 'System.Collections.Generic.List[object]'
try {
    Expand-JevZip $zip $stage $select
    $source = Join-JevPath $stage ('rime-ice-' + $ice.revision)
    if (-not (Test-Path -LiteralPath (Join-Path $source 'rime_ice.schema.yaml'))) { throw 'Pinned Rime Ice archive has an unexpected layout.' }

    # The dependency's global default/skin must not replace this computer's settings.
    $schemaPath = Join-Path $source 'rime_ice.schema.yaml'
    $schema = [IO.File]::ReadAllText($schemaPath).Replace('default:/', 'jev_ice_defaults:/')
    $schema = $schema -replace '(?m)(import_preset:[ \t]*)default\b', '${1}jev_ice_defaults'
    [IO.File]::WriteAllText($schemaPath, $schema, (New-Object Text.UTF8Encoding($false)))
    $operations = @()
    foreach ($file in (Get-ChildItem -LiteralPath $source -File -Recurse)) {
        $relative = $file.FullName.Substring($source.Length + 1)
        if ($relative -eq 'default.yaml') { $relative = 'jev_ice_defaults.yaml' }
        if ($relative -eq 'LICENSE') { $relative = 'jev-rime-ice.LICENSE.txt' }
        $dest = Join-JevPath $paths.Rime $relative
        Assert-JevPlainPath $dest
        $hash = (Get-FileHash -LiteralPath $file.FullName -Algorithm SHA256).Hash
        if (Test-Path -LiteralPath $dest) {
            if (-not (Test-Path -LiteralPath $dest -PathType Leaf) -or (Get-FileHash -LiteralPath $dest -Algorithm SHA256).Hash -ne $hash) {
                throw "Rime Ice dependency conflicts with an existing file: $dest. Nothing was overwritten; install/merge Rime Ice first and retry."
            }
            continue
        }
        $operations += [pscustomobject]@{ source=$file.FullName; path=$dest; relative=$relative; sha256=$hash }
    }
    foreach ($op in $operations) {
        New-Item -ItemType Directory -Path (Split-Path -Parent $op.path) -Force | Out-Null
        [IO.File]::Copy($op.source, $op.path, $false)
        $created.Add($op)
    }
    Write-JevJson (Join-Path $paths.Data 'ice-dependency.json') @{
        format=1; revision=$ice.revision; rime=$paths.Rime
        note='Added files only. Kept on Jev uninstall: other schemes may now depend on them.'
        files=@($created | Select-Object relative,sha256)
    }
} catch {
    foreach ($op in $created) {
        if ((Test-Path -LiteralPath $op.path -PathType Leaf) -and
            (Get-FileHash -LiteralPath $op.path -Algorithm SHA256).Hash -eq $op.sha256) {
            Remove-Item -LiteralPath $op.path -Force
        }
    }
    throw
} finally {
    Remove-JevStagingDirectory $cache $stage
}
Remove-Item -LiteralPath $zip -Force
Write-Host 'Installed pinned Rime Ice dependencies without replacing the global configuration, skin or user dictionaries.'
