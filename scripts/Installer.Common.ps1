# Shared by the source checkout and the allowlisted release package. PowerShell 5.1 compatible.
function Get-JevFullPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    if (-not $full.Contains('~')) { return $full }
    if (-not ('RimeJev.PathNames' -as [type])) {
        Add-Type -TypeDefinition @'
using System.Runtime.InteropServices;
using System.Text;
namespace RimeJev {
    public static class PathNames {
        [DllImport("kernel32.dll", CharSet=CharSet.Unicode, SetLastError=true)]
        public static extern uint GetLongPathName(string path, StringBuilder buffer, uint length);
    }
}
'@
    }
    # Expand existing 8.3 parents even when the final install directory is new.
    $existing = $full
    $tail = @()
    while (-not (Test-Path -LiteralPath $existing)) {
        $parent = Split-Path -Parent $existing
        if (-not $parent -or $parent -eq $existing) { return $full }
        $tail = @(Split-Path -Leaf $existing) + $tail
        $existing = $parent
    }
    $buffer = New-Object Text.StringBuilder 32768
    $length = [RimeJev.PathNames]::GetLongPathName($existing, $buffer, $buffer.Capacity)
    if (-not $length -or $length -ge $buffer.Capacity) { throw 'Could not normalize the Windows short path.' }
    $expanded = $buffer.ToString()
    foreach ($part in $tail) { $expanded = Join-Path $expanded $part }
    return $expanded
}

function Join-JevPath([string]$Root, [string]$Relative) {
    if (-not $Relative -or $Relative -match '[:<>"|?*\x00-\x1f]' -or [IO.Path]::IsPathRooted($Relative)) {
        throw "Invalid relative path: $Relative"
    }
    foreach ($part in ($Relative -split '[/\\]')) {
        if (-not $part -or $part -in @('.', '..') -or $part -match '[. ]$' -or
            $part -match '^(?i:CON|PRN|AUX|NUL|COM[1-9]|LPT[1-9])(?:\.|$)') {
            throw "Unsafe path component: $Relative"
        }
    }
    $base = (Get-JevFullPath $Root).TrimEnd('\', '/')
    $path = Get-JevFullPath (Join-Path $base $Relative)
    if (-not $path.StartsWith($base + [IO.Path]::DirectorySeparatorChar, [StringComparison]::OrdinalIgnoreCase)) {
        throw "Path escapes its root: $Relative"
    }
    return $path
}

function Assert-JevPlainPath([string]$Path) {
    $full = [IO.Path]::GetFullPath($Path)
    while ($full) {
        if (Test-Path -LiteralPath $full) {
            $item = Get-Item -LiteralPath $full -Force
            if ($item.Attributes -band [IO.FileAttributes]::ReparsePoint) {
                throw "Refusing a junction or symbolic link: $full"
            }
        }
        $parent = Split-Path -Parent $full
        if ($parent -eq $full) { break }
        $full = $parent
    }
}

function Get-JevPaths([string]$RimeUserDir, [string]$WeaselRoot) {
    if (-not $RimeUserDir) {
        $settings = Get-ItemProperty -LiteralPath 'HKCU:\Software\Rime\Weasel' -ErrorAction SilentlyContinue
        $RimeUserDir = $settings.RimeUserDir
    }
    if (-not $RimeUserDir) { $RimeUserDir = Join-Path $env:APPDATA 'Rime' }
    if (-not $WeaselRoot) {
        foreach ($key in @('HKLM:\Software\WOW6432Node\Rime\Weasel', 'HKLM:\Software\Rime\Weasel', 'HKCU:\Software\Rime\Weasel')) {
            $settings = Get-ItemProperty -LiteralPath $key -ErrorAction SilentlyContinue
            if ($settings.WeaselRoot) { $WeaselRoot = $settings.WeaselRoot; break }
        }
    }
    if (-not $WeaselRoot) { throw 'Weasel (Windows Rime) was not found. Install it from https://rime.im/ first.' }
    $rime = [Environment]::ExpandEnvironmentVariables($RimeUserDir)
    $weasel = [Environment]::ExpandEnvironmentVariables($WeaselRoot)
    if (-not [IO.Path]::IsPathRooted($rime) -or -not [IO.Path]::IsPathRooted($weasel)) {
        throw 'RimeUserDir and WeaselRoot must be absolute filesystem paths.'
    }
    $rime = (Get-JevFullPath $rime).TrimEnd('\')
    $weasel = (Get-JevFullPath $weasel).TrimEnd('\')
    foreach ($name in @('WeaselDeployer.exe', 'rime.dll')) {
        if (-not (Test-Path -LiteralPath (Join-Path $weasel $name) -PathType Leaf)) {
            throw "Incomplete Weasel installation: missing $name in $weasel"
        }
    }
    Assert-JevPlainPath $rime
    Assert-JevPlainPath $weasel
    return [pscustomobject]@{ Rime=$rime; Weasel=$weasel; Data=(Get-JevFullPath (Join-Path $env:LOCALAPPDATA 'RimeJev')) }
}

function Initialize-JevData([string]$Data) {
    Assert-JevPlainPath $Data
    New-Item -ItemType Directory -Path $Data -Force | Out-Null
    $sid = [Security.Principal.WindowsIdentity]::GetCurrent().User.Value
    & icacls.exe $Data /inheritance:r /grant:r "*${sid}:(OI)(CI)F" '*S-1-5-18:(OI)(CI)F' | Out-Null
    if ($LASTEXITCODE -ne 0) { throw 'Could not secure the per-user data directory.' }
}

function Write-JevJson([string]$Path, $Value) {
    Assert-JevPlainPath $Path
    $json = ConvertTo-Json -InputObject $Value -Depth 12
    [IO.File]::WriteAllText($Path, $json + "`n", (New-Object Text.UTF8Encoding($false)))
}

function Remove-JevStagingDirectory([string]$Root, [string]$Path) {
    $full = (Get-JevFullPath $Path).TrimEnd('\')
    $leaf = Split-Path -Leaf $full
    if ($leaf -notmatch '^(extract|ice|staging)-[0-9a-f]{32}$' -or (Join-JevPath $Root $leaf) -ne $full) {
        throw 'Refusing to clean a path outside the immediate staging directory.'
    }
    Assert-JevPlainPath $full
    if (-not (Test-Path -LiteralPath $full)) { return }
    if ((Get-JevFullPath (Resolve-Path -LiteralPath $full).Path) -ne $full -or
        @(Get-ChildItem -LiteralPath $full -Recurse -Force | Where-Object { $_.Attributes -band [IO.FileAttributes]::ReparsePoint }).Count) {
        throw 'Refusing to clean a linked staging directory.'
    }
    Remove-Item -LiteralPath $full -Recurse -Force
}

function Assert-JevNativeInactive {
    $path = Join-Path $env:LOCALAPPDATA 'RimeJev\native-installation.json'
    Assert-JevPlainPath $path
    if ((Test-Path -LiteralPath $path) -and (Get-Content -LiteralPath $path -Raw -Encoding UTF8 | ConvertFrom-Json).active) {
        throw 'Roll back the active or pending native installation with Rollback-Native.cmd before reinstalling or updating. Its original rollback receipt was retained.'
    }
}

function Get-JevNode {
    $lock = Get-Content -LiteralPath (Join-Path (Split-Path -Parent $PSScriptRoot) 'dependencies.lock.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $arch = Get-JevArchitecture
    $portable = Join-Path $env:LOCALAPPDATA ("RimeJev\tools\node-v{0}-{1}\node.exe" -f $lock.node.version, $arch)
    $system = Get-Command node.exe -ErrorAction SilentlyContinue
    foreach ($candidate in @($portable, $system.Source)) {
        if ($candidate -and (Test-Path -LiteralPath $candidate -PathType Leaf)) {
            $version = & $candidate --version 2>$null
            if ($LASTEXITCODE -eq 0 -and "$version" -match '^v(\d+\.\d+\.\d+)$' -and
                [version]$Matches[1] -ge [version]$lock.node.minimum) { return $candidate }
        }
    }
    return $null
}

function Get-JevArchitecture {
    $arch = if ($env:PROCESSOR_ARCHITEW6432) { $env:PROCESSOR_ARCHITEW6432 } else { $env:PROCESSOR_ARCHITECTURE }
    switch ($arch) {
        'AMD64' { return 'x64' }
        'ARM64' { return 'arm64' }
        default { throw 'The migration installer supports Windows 10/11 x64 or ARM64; 32-bit Windows is not supported.' }
    }
}

function Test-JevBridgeProcess($Process, [string]$Project, [string]$Data) {
    if (-not $Process -or $Process.Name -ne 'node.exe' -or -not $Process.CommandLine) { return $false }
    $arguments = @([regex]::Matches($Process.CommandLine, '"([^"\r\n]*)"|([^\s"]+)') | ForEach-Object {
        $value = if ($_.Groups[1].Success) { $_.Groups[1].Value } else { $_.Groups[2].Value }
        if ([IO.Path]::IsPathRooted($value)) {
            try { (Get-JevFullPath $value).TrimEnd('\') } catch { }
        }
    })
    foreach ($path in @((Join-Path $Project 'bridge.mjs'), $Data)) {
        if ((Get-JevFullPath $path).TrimEnd('\') -notin $arguments) { return $false }
    }
    return $true
}

function Get-JevDownload([string]$Url, [string]$Sha256, [string]$Destination) {
    if ($Sha256 -notmatch '^[a-fA-F0-9]{64}$') { throw 'A pinned SHA-256 is required.' }
    $uri = [Uri]$Url
    if ($uri.Scheme -ne 'https' -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        $uri.Host -notin @('nodejs.org', 'codeload.github.com')) { throw 'Unexpected dependency download URL.' }
    Assert-JevPlainPath $Destination
    if (Test-Path -LiteralPath $Destination -PathType Leaf) {
        if ((Get-FileHash -LiteralPath $Destination -Algorithm SHA256).Hash -eq $Sha256) { return $Destination }
        throw "Cached dependency checksum mismatch. Remove only this cache file and retry: $Destination"
    }
    New-Item -ItemType Directory -Path (Split-Path -Parent $Destination) -Force | Out-Null
    $partial = $Destination + '.' + [guid]::NewGuid().ToString('N') + '.partial'
    try {
        [Net.ServicePointManager]::SecurityProtocol = [Net.ServicePointManager]::SecurityProtocol -bor [Net.SecurityProtocolType]::Tls12
        Write-Host ("Downloading verified dependency from {0} ..." -f $uri.Host)
        $progress = $ProgressPreference
        try {
            $ProgressPreference = 'SilentlyContinue'
            Invoke-WebRequest -UseBasicParsing -Uri $Url -OutFile $partial -TimeoutSec 300
        } finally { $ProgressPreference = $progress }
        if ((Get-FileHash -LiteralPath $partial -Algorithm SHA256).Hash -ne $Sha256) { throw 'Dependency checksum mismatch; nothing was installed.' }
        Move-Item -LiteralPath $partial -Destination $Destination
        return $Destination
    } finally {
        if (Test-Path -LiteralPath $partial) { Remove-Item -LiteralPath $partial -Force }
    }
}

function Expand-JevZip([string]$Archive, [string]$Destination, [scriptblock]$SelectEntry) {
    Assert-JevPlainPath $Destination
    if (Test-Path -LiteralPath $Destination) { throw 'Archive destination must be a fresh directory.' }
    Add-Type -AssemblyName System.IO.Compression.FileSystem
    $zip = [IO.Compression.ZipFile]::OpenRead($Archive)
    try {
        $entries = @()
        $seen = @{}
        $total = 0L
        foreach ($entry in $zip.Entries) {
            if ($entry.FullName.EndsWith('/')) { continue }
            $target = Join-JevPath $Destination $entry.FullName
            if ((($entry.ExternalAttributes -shr 16) -band 0xf000) -eq 0xa000) { throw 'Symlink in dependency archive.' }
            if ($seen.ContainsKey($target)) { throw 'Duplicate archive path.' }
            $seen[$target] = $true
            $total += $entry.Length
            if ($total -gt 1GB -or $seen.Count -gt 20000) { throw 'Dependency archive exceeds extraction limits.' }
            if (-not $SelectEntry -or (& $SelectEntry $entry.FullName)) {
                $entries += [pscustomobject]@{ Entry=$entry; Target=$target }
            }
        }
        New-Item -ItemType Directory -Path $Destination | Out-Null
        foreach ($item in $entries) {
            New-Item -ItemType Directory -Path (Split-Path -Parent $item.Target) -Force | Out-Null
            [IO.Compression.ZipFileExtensions]::ExtractToFile($item.Entry, $item.Target, $false)
        }
    } finally { $zip.Dispose() }
}

function Test-JevManifest([string]$Root, [string]$Name='package-manifest.json') {
    Assert-JevPlainPath $Root
    $manifest = Get-Content -LiteralPath (Join-JevPath $Root $Name) -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($manifest.format -ne 1 -or -not $manifest.files -or @($manifest.files.PSObject.Properties).Count -eq 0) {
        throw 'Unsupported or empty package manifest.'
    }
    $seen = @{}
    foreach ($file in $manifest.files.PSObject.Properties) {
        $path = Join-JevPath $Root $file.Name
        Assert-JevPlainPath $path
        if ($seen.ContainsKey($path) -or $file.Value -notmatch '^[a-fA-F0-9]{64}$' -or
            -not (Test-Path -LiteralPath $path -PathType Leaf) -or
            (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash -ne $file.Value) {
            throw "Package integrity check failed: $($file.Name)"
        }
        $seen[$path] = $true
    }
    return $manifest
}

function Add-JevSchemaPatch([string]$Text) {
    if ([string]::IsNullOrWhiteSpace($Text)) { $Text = "patch:`n" }
    $newline = if ($Text.Contains("`r`n")) { "`r`n" } else { "`n" }
    if ($Text -match '(?m)^\s*\t' -or $Text -match '(?m)^(---|\.\.\.)\s*$') {
        throw 'Unsupported YAML layout in default.custom.yaml; merge the Jev schema manually.'
    }
    $Text = [regex]::Replace($Text, '(?m)^patch:\s*\{\}[ \t]*(?=\r?$)', 'patch:')
    $lines = New-Object 'System.Collections.Generic.List[string]'
    foreach ($line in ($Text -split '\r?\n')) { $lines.Add($line) }
    $patches = @()
    for ($i=0; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^patch:[ \t]*(?:#.*)?$') { $patches += $i }
    }
    if ($patches.Count -ne 1) { throw 'Expected one block-style patch: in default.custom.yaml; no Rime files changed.' }
    $start = $patches[0] + 1
    $end = $lines.Count
    for ($i=$start; $i -lt $lines.Count; $i++) {
        if ($lines[$i] -match '^[^\s#]') { $end=$i; break }
    }
    $indent = '  '
    for ($i=$start; $i -lt $end; $i++) {
        if ($lines[$i] -match '^( +)[^ #]') { $indent=$Matches[1]; break }
    }
    $plus = @()
    for ($i=$start; $i -lt $end; $i++) {
        if ($lines[$i] -match '^\s*-\s*(?:\{\s*)?schema:\s*["'']?rime_ice_jev["'']?\s*\}?\s*(?:#.*)?$') {
            return $Text
        }
        if ($lines[$i] -match ('^' + $indent + '["'']?schema_list/\+["'']?\s*:(.*)$')) { $plus += $i }
    }
    if ($plus.Count -gt 1) { throw 'Duplicate schema_list/+ keys; repair default.custom.yaml first.' }
    if ($plus.Count -eq 1) {
        $index = $plus[0]
        $tail = ($lines[$index] -split ':', 2)[1]
        if ($tail -match '^\s*\[\s*\]\s*(?:#.*)?$') {
            $lines[$index] = $lines[$index] -replace '\[\s*\]', ''
        } elseif ($tail -notmatch '^\s*(?:#.*)?$') {
            throw 'Inline schema_list/+ needs a manual merge; use a block list and retry.'
        }
        $insert = $index + 1
        $itemIndent = $indent + '  '
        while ($insert -lt $end) {
            $line = $lines[$insert]
            if ($line -match '^\s*(?:#.*)?$') { $insert++; continue }
            if ($line -match '^( +)\S' -and $Matches[1].Length -le $indent.Length) { break }
            if ($line -match '^( +)-\s') { $itemIndent=$Matches[1] }
            elseif ($line -notmatch '^\s+schema\s*:') { throw 'Complex schema_list/+ needs a manual merge.' }
            $insert++
        }
        $lines.Insert($insert, $itemIndent + '- {schema: rime_ice_jev}')
    } else {
        $lines.Insert($end, $indent + '# rime-jev: keep existing schemas and UI.')
        $lines.Insert($end + 1, $indent + '"schema_list/+":')
        $lines.Insert($end + 2, $indent + '  - {schema: rime_ice_jev}')
    }
    return (($lines -join $newline).TrimEnd("`r", "`n") + $newline)
}

function Set-JevAutostart([string]$Project) {
    $startup = [Environment]::GetFolderPath('Startup')
    $link = (New-Object -ComObject WScript.Shell).CreateShortcut((Join-Path $startup 'Rime Jev Bridge.lnk'))
    $link.TargetPath = Join-Path $env:WINDIR 'System32\WindowsPowerShell\v1.0\powershell.exe'
    $link.Arguments = '-NoProfile -ExecutionPolicy Bypass -WindowStyle Hidden -File "' + (Join-Path $Project 'scripts\Start-Bridge.ps1') + '" -Foreground'
    $link.WorkingDirectory = $Project
    $link.WindowStyle = 7
    $link.Save()
}

function Remove-JevShortcuts([string]$Project) {
    $shell = New-Object -ComObject WScript.Shell
    $programs = Join-Path ([Environment]::GetFolderPath('Programs')) 'Rime Jev'
    $startup = Join-Path ([Environment]::GetFolderPath('Startup')) 'Rime Jev Bridge.lnk'
    $candidates = @($startup) + @('Configure','Status','Uninstall','Rollback-Native' | ForEach-Object { Join-Path $programs ($_.ToString() + '.lnk') })
    foreach ($path in $candidates) {
        if (-not (Test-Path -LiteralPath $path -PathType Leaf)) { continue }
        Assert-JevPlainPath $path
        $link = $shell.CreateShortcut($path)
        $owned = if ($path -eq $startup) {
            $link.Arguments -match [regex]::Escape((Join-Path $Project 'scripts\Start-Bridge.ps1'))
        } else {
            $link.TargetPath -eq (Join-Path $Project (([IO.Path]::GetFileNameWithoutExtension($path)) + '.cmd'))
        }
        if ($owned) { Remove-Item -LiteralPath $path -Force }
    }
    if ((Test-Path -LiteralPath $programs -PathType Container) -and -not @(Get-ChildItem -LiteralPath $programs -Force).Count) {
        Remove-Item -LiteralPath $programs
    }
}
