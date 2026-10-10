[CmdletBinding(SupportsShouldProcess=$true)]
param(
    [switch]$Apply,
    [string]$Workspace = (Split-Path -Parent $PSScriptRoot),
    [int]$MinimumAgeMinutes = 30,
    [switch]$IncludeDisposableCaches,
    [switch]$IncludeDownloads
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Installer.Common.ps1')
$root = (Resolve-Path -LiteralPath $Workspace).Path.TrimEnd('\')
Assert-JevPlainPath $root
if (-not (Test-Path -LiteralPath (Join-Path $root 'tests\native_rime.py') -PathType Leaf)) {
    throw 'Not a rime-jev source workspace.'
}
if ($MinimumAgeMinutes -lt 0) { throw 'MinimumAgeMinutes cannot be negative.' }
$bases = @((Join-JevPath $root 'runtime'))
$worktrees = & git -C $root worktree list --porcelain
if ($LASTEXITCODE -ne 0) { throw 'Cannot inspect worktrees safely.' }
foreach ($line in $worktrees) {
    if ($line -match '^worktree (.+)$') {
        $tree = [IO.Path]::GetFullPath($Matches[1]).TrimEnd('\')
        if ($tree -ne $root -and $tree.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase)) {
            Assert-JevPlainPath $tree
            $bases += (Join-JevPath $tree 'runtime')
        }
    }
}
$processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.CommandLine -and $_.ProcessId -ne $PID })

function Get-CleanupTarget([string]$Base, [string]$Relative, [string]$Scope, [string]$Kind) {
    $path = Join-JevPath $Base $Relative
    if (-not (Test-Path -LiteralPath $path)) { return }
    Assert-JevPlainPath $path
    $resolved = (Resolve-Path -LiteralPath $path).Path
    if (-not $resolved.StartsWith($root + '\', [StringComparison]::OrdinalIgnoreCase) -or $resolved -ne $path) {
        throw 'Cleanup target is outside the workspace.'
    }
    $item = Get-Item -LiteralPath $path -Force
    $children = if ($item.PSIsContainer) { @(Get-ChildItem -LiteralPath $path -Recurse -Force) } else { @() }
    if (@($children | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
        throw "Linked entry in disposable cache: $path"
    }
    $all = @($item) + @($children)
    if (@($all | Where-Object { $_.LastWriteTimeUtc -gt [DateTime]::UtcNow.AddMinutes(-$MinimumAgeMinutes) }).Count) {
        Write-Warning "Skipping recently modified cache: $path"; return
    }
    $normal = $Scope.Replace('\','/')
    if (@($processes | Where-Object { $_.CommandLine.Replace('\','/').IndexOf($normal, [StringComparison]::OrdinalIgnoreCase) -ge 0 }).Count) {
        Write-Warning "Skipping cache referenced by a live process: $path"; return
    }
    $bytes = [long]($all | Where-Object { -not $_.PSIsContainer } | Measure-Object -Property Length -Sum).Sum
    return [pscustomobject]@{path=$resolved; bytes=$bytes; kind=$Kind; base=$Base; relative=$Relative; scope=$Scope; removed=$false}
}

$targets = @()
foreach ($base in ($bases | Select-Object -Unique)) {
    if (-not (Test-Path -LiteralPath $base)) { continue }
    Assert-JevPlainPath $base
    foreach ($trial in (Get-ChildItem -LiteralPath $base -Directory -Force)) {
        if ($trial.Name -match '^native-[0-9a-f]{8}$') {
            $targets += @(Get-CleanupTarget $trial.FullName 'rime\build' $trial.FullName 'compiled-test')
        }
        if ($IncludeDisposableCaches -and $trial.Name -match '^migration-smoke-[0-9a-f]{8}$') {
            $receipt = Join-JevPath $trial.FullName 'compile-result.json'
            $install = Join-JevPath $trial.FullName 'Local\RimeJev\installation.json'
            if ((Test-Path -LiteralPath $receipt) -and (Test-Path -LiteralPath $install)) {
                Assert-JevPlainPath $receipt
                Assert-JevPlainPath $install
                $result = Get-Content -LiteralPath $receipt -Raw -Encoding UTF8 | ConvertFrom-Json
                $installed = Get-Content -LiteralPath $install -Raw -Encoding UTF8 | ConvertFrom-Json
                if ($result.pinned_ice_compiled -eq $true -and $result.real_user_database_opened -eq $false -and
                    $installed.rime -eq (Join-JevPath $trial.FullName 'Rime') -and
                    $installed.weasel -eq (Join-JevPath $trial.FullName 'Weasel')) {
                    foreach ($relative in @('Rime\build','Rime\cn_dicts','Rime\en_dicts','Rime\opencc')) {
                        $targets += @(Get-CleanupTarget $trial.FullName $relative $trial.FullName 'migration-test')
                    }
                }
            }
        }
        if ($IncludeDisposableCaches -and $trial.Name -match '^zen-context-check-[0-9]{8}$') {
            $probe = Join-JevPath $trial.FullName 'browser_probe.py'
            if (Test-Path -LiteralPath $probe -PathType Leaf) {
                Assert-JevPlainPath $probe
                $text = [IO.File]::ReadAllText($probe)
                if ($text.Contains('Disposable Zen URL-bar probe.') -and $text.Contains("PROFILE = ROOT / 'profile'")) {
                    $targets += @(Get-CleanupTarget $trial.FullName 'profile' $trial.FullName 'disposable-browser-profile')
                }
            }
        }
    }
}
if ($IncludeDownloads) {
    $lock = Get-Content -LiteralPath (Join-JevPath $root 'dependencies.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($lock.rimeIce.revision -notmatch '^[0-9a-f]{40}$') { throw 'Unexpected dependency revision.' }
    $base = Join-JevPath $root 'runtime\distribution-deps'
    $relative = 'rime-ice-' + $lock.rimeIce.revision + '.zip'
    $archive = Join-JevPath $base $relative
    if (Test-Path -LiteralPath $archive) {
        Assert-JevPlainPath $archive
        if ((Get-FileHash -LiteralPath $archive -Algorithm SHA256).Hash -ne $lock.rimeIce.sha256) {
            throw 'Download cache differs from the pinned dependency; it was retained.'
        }
        $targets += @(Get-CleanupTarget $base $relative $archive 'verified-download')
    }
}
$total = [long]($targets | Measure-Object -Property bytes -Sum).Sum
Write-Host ("Generated caches: {0}; reclaimable: {1:N2} MiB" -f $targets.Count, ($total / 1MB))
if (-not $Apply) {
    $targets | Select-Object @{N='MiB';E={[math]::Round($_.bytes/1MB,2)}},kind,path | Format-Table -AutoSize
    Write-Host 'Preview only. Run with -Apply to remove these caches; logs, worktrees, bundles, rollback backups and installed data are retained.'
    return
}
foreach ($target in $targets) {
    $processes = @(Get-CimInstance Win32_Process -ErrorAction Stop | Where-Object { $_.CommandLine -and $_.ProcessId -ne $PID })
    $checked = Get-CleanupTarget $target.base $target.relative $target.scope $target.kind
    if (-not $checked) { continue }
    if ($checked.path -ne $target.path -or $checked.bytes -ne $target.bytes) { throw 'Cleanup target changed.' }
    if ($PSCmdlet.ShouldProcess($checked.path, 'Remove verified disposable cache only')) {
        Remove-Item -LiteralPath $target.path -Recurse -Force
        $target.removed = $true
    }
}
$report = Join-JevPath $root ('runtime\cleanup-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')
if ($PSCmdlet.ShouldProcess($report, 'Write cleanup audit')) {
    New-Item -ItemType Directory -Path (Split-Path -Parent $report) -Force | Out-Null
    Write-JevJson $report @{format=1; createdUtc=[DateTime]::UtcNow.ToString('o'); targets=$targets}
}
$removed = [long]($targets | Where-Object removed | Measure-Object -Property bytes -Sum).Sum
Write-Host ("Removed {0:N2} MiB. Audit: {1}" -f ($removed / 1MB), $report)
