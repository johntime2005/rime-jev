param(
    [string]$Repository = 'johntime2005/rime-jev',
    [string]$Tag,
    [string]$AssetsDirectory = (Join-Path (Split-Path -Parent $PSScriptRoot) 'dist'),
    [string]$NotesFile = (Join-Path (Split-Path -Parent $PSScriptRoot) 'RELEASE-NOTES.md'),
    [switch]$Prerelease
)
$ErrorActionPreference = 'Stop'
. (Join-Path $PSScriptRoot 'Installer.Common.ps1')
if ($Repository -notmatch '^[A-Za-z0-9_.-]+/[A-Za-z0-9_.-]+$') { throw 'Repository must be OWNER/NAME.' }
if ($Tag -and $Tag -notmatch '^v[0-9][A-Za-z0-9._-]{0,63}$') { throw 'Invalid release tag.' }
$project = Split-Path -Parent $PSScriptRoot
Push-Location $project
try {
    & gh auth status --hostname github.com
    if ($LASTEXITCODE -ne 0) { throw 'Log in with gh auth login first. Never put a token in this script or repository.' }
    $dirty = & git status --porcelain
    if ($LASTEXITCODE -ne 0 -or $dirty) { throw 'Commit/review source changes before publishing. This script never stages or commits files.' }
    $branch = & git branch --show-current
    if ($LASTEXITCODE -ne 0 -or -not $branch) { throw 'A checked-out branch is required.' }
    $revision = & git rev-parse HEAD
    if ($LASTEXITCODE -ne 0) { throw 'Could not resolve source revision.' }
    $assets = @()
    if ($Tag) {
        $target = & git rev-parse "$Tag^{commit}"
        if ($LASTEXITCODE -ne 0 -or $target -ne $revision) { throw 'Create a local release tag at HEAD before publishing.' }
        if (-not (Test-Path -LiteralPath $NotesFile -PathType Leaf)) { throw 'Release notes are missing.' }
        $archives = @(Get-ChildItem -LiteralPath $AssetsDirectory -Filter "rime-jev-$Tag-windows-*.zip" -File)
        if (-not $archives.Count) { throw 'No matching release archives. Run scripts/Package-Release.py first.' }
        Add-Type -AssemblyName System.IO.Compression.FileSystem
        foreach ($archive in $archives) {
            $checksum = $archive.FullName + '.sha256'
            $expected = (Get-Content -LiteralPath $checksum -Raw).Trim() -split '\s+',2
            if ($expected.Count -ne 2 -or $expected[1] -ne $archive.Name -or
                (Get-FileHash -LiteralPath $archive.FullName -Algorithm SHA256).Hash -ne $expected[0]) {
                throw "Archive checksum mismatch: $($archive.Name)"
            }
            $zip = [IO.Compression.ZipFile]::OpenRead($archive.FullName)
            try {
                $entries = @($zip.Entries | Where-Object { $_.FullName -match '^[^/]+/package-manifest\.json$' })
                if ($entries.Count -ne 1) { throw 'Release manifest is missing or ambiguous.' }
                $reader = New-Object IO.StreamReader($entries[0].Open())
                try { $manifest = $reader.ReadToEnd() | ConvertFrom-Json } finally { $reader.Dispose() }
                if ($manifest.format -ne 1 -or $manifest.kind -ne 'windows-release' -or $manifest.version -ne $Tag -or
                    $manifest.source_revision -ne $revision -or $manifest.source_dirty -ne $false) {
                    throw 'Package does not describe clean, tagged source. Rebuild it after committing.'
                }
                if ($manifest.native_experimental -and -not $Prerelease) { throw 'Experimental native binaries must be published as a prerelease.' }
                $prefix = $entries[0].FullName.Substring(0, $entries[0].FullName.Length - 'package-manifest.json'.Length)
                $sourceNames = @(Get-Content -LiteralPath (Join-Path $project 'distribution-files.json') -Raw -Encoding UTF8 | ConvertFrom-Json)
                foreach ($name in $sourceNames) {
                    $source = Join-JevPath $project $name
                    Assert-JevPlainPath $source
                    if ($manifest.files.$name -ne (Get-FileHash -LiteralPath $source -Algorithm SHA256).Hash) {
                        throw "Package source differs from HEAD: $name"
                    }
                }
                $allowed = @{}
                $allowed[$entries[0].FullName] = $true
                foreach ($file in $manifest.files.PSObject.Properties) {
                    $null = Join-JevPath $project $file.Name
                    if ($file.Value -notmatch '^[a-fA-F0-9]{64}$') { throw 'Invalid package content hash.' }
                    $entry = $zip.GetEntry($prefix + $file.Name)
                    if (-not $entry -or $entry.Length -gt 20MB -or $allowed.ContainsKey($entry.FullName)) {
                        throw 'Missing, duplicate or oversized package content.'
                    }
                    $stream = $entry.Open()
                    $sha = [Security.Cryptography.SHA256]::Create()
                    try { $hash = ([BitConverter]::ToString($sha.ComputeHash($stream))).Replace('-', '') }
                    finally { $stream.Dispose(); $sha.Dispose() }
                    if ($hash -ne $file.Value) { throw "Package content hash mismatch: $($file.Name)" }
                    $allowed[$entry.FullName] = $true
                }
                if ($allowed.Count -ne $zip.Entries.Count -or @($zip.Entries | Where-Object { -not $allowed.ContainsKey($_.FullName) }).Count) {
                    throw 'Unexpected extra files in release archive.'
                }
            } finally { $zip.Dispose() }
            $assets += $archive.FullName, $checksum
        }
    }
    $remote = & git remote get-url origin 2>$null
    if ($LASTEXITCODE -eq 0 -and $remote) {
        if ($remote -notin @("https://github.com/$Repository.git", "https://github.com/$Repository", "git@github.com:$Repository.git")) {
            throw 'origin differs from the requested repository; not changed.'
        }
    } else {
        & gh repo create $Repository --private --source . --remote origin
        if ($LASTEXITCODE -ne 0) { throw 'Repository creation failed. No existing visibility or remote was changed.' }
    }
    & git push origin $branch
    if ($LASTEXITCODE -ne 0) { throw 'Push failed. No force push was attempted.' }
    if ($Tag) {
        & git push origin "refs/tags/$Tag"
        if ($LASTEXITCODE -ne 0) { throw 'Tag push failed; release not created.' }
        $arguments = @('release','create',$Tag,'--repo',$Repository,'--verify-tag','--title',"Rime Jev $Tag",'--notes-file',$NotesFile)
        if ($Prerelease) { $arguments += '--prerelease' }
        $arguments += $assets
        & gh @arguments
        if ($LASTEXITCODE -ne 0) { throw 'Release creation failed. Existing releases/assets were not overwritten.' }
    }
} finally { Pop-Location }
