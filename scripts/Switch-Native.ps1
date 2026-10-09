param(
    [Parameter(Mandatory=$true)][string]$Receipt,
    [switch]$Rollback
)
$ErrorActionPreference = 'Stop'
$receiptPath = (Resolve-Path -LiteralPath $Receipt).Path
$receiptDir = Split-Path -Parent $receiptPath
$resultPath = Join-Path $receiptDir 'switch-result.json'
function Hash($path) { (Get-FileHash -LiteralPath $path -Algorithm SHA256).Hash }
function Save-Result($phase, $message) {
    @{ phase=$phase; message=$message; rollback=[bool]$Rollback; timeUtc=[DateTime]::UtcNow.ToString('o') } |
        ConvertTo-Json | Set-Content -LiteralPath $resultPath -Encoding UTF8
}
$changed = New-Object System.Collections.Generic.List[object]
try {
    # PowerShell 7 writes BOM-less UTF-8; Windows PowerShell otherwise assumes ANSI.
    $r = Get-Content -LiteralPath $receiptPath -Raw -Encoding UTF8 | ConvertFrom-Json
    if ($r.format -ne 1) { throw 'Unsupported replacement receipt.' }
    $principal = New-Object Security.Principal.WindowsPrincipal([Security.Principal.WindowsIdentity]::GetCurrent())
    if (-not $principal.IsInRole([Security.Principal.WindowsBuiltInRole]::Administrator)) { throw 'Administrator authorization required.' }
    if (-not [Environment]::Is64BitProcess) { throw 'Use 64-bit PowerShell.' }
    $registered = (Get-Item -LiteralPath 'Registry::HKEY_CLASSES_ROOT\CLSID\{A3F4CDED-B1E9-41EE-9CA6-7B4D0DE6CB0A}\InprocServer32').GetValue('')
    if ($registered -ne $r.registeredTsfDll) { throw 'Registered TSF path changed.' }
    if ((Hash (Join-Path $r.bundle 'manifest.json')) -ne $r.bundleManifestHash) { throw 'Bundle manifest changed.' }
    $manifest = Get-Content -LiteralPath (Join-Path $r.bundle 'manifest.json') -Raw -Encoding UTF8 | ConvertFrom-Json
    $mapping = @{
        'WeaselServer.exe'='WeaselServer.exe'; 'weaselx64.dll'='weaselx64.dll'
        'registered-tsf-x64.dll'='weaselx64.dll'; 'jev_windows.lua'='lua/jev_windows.lua'
        'rime_ice_jev.schema.yaml'='rime_ice_jev.schema.yaml'
    }
    $allowed = @((Join-Path $r.installRoot 'WeaselServer.exe'), (Join-Path $r.installRoot 'weaselx64.dll'),
        $r.registeredTsfDll, (Join-Path $r.rimeUserDir 'lua\jev_windows.lua'),
        (Join-Path $r.rimeUserDir 'rime_ice_jev.schema.yaml'), (Join-Path $env:LOCALAPPDATA 'RimeJev\installation.json'))
    $operations = @()
    foreach ($file in $r.files) {
        $path = [IO.Path]::GetFullPath($file.path)
        if ($path -notin $allowed) { throw "Unexpected destination: $path" }
        if ((Hash $file.backup) -ne $file.sha256) { throw "Backup changed: $($file.backup)" }
        $name = Split-Path -Leaf $file.backup
        if ($name -eq 'installation.json') { continue }
        if (-not $mapping.ContainsKey($name)) { throw "Unexpected backup: $name" }
        $relative = $mapping[$name]
        $source = Join-Path $r.bundle $relative
        $expected = $manifest.files.$relative
        if (-not $expected -or (Hash $source) -ne $expected) { throw "Bundle input changed: $relative" }
        $current = Hash $path
        if ($Rollback) {
            if ($current -ne $expected -and $current -ne $file.sha256) { throw "User changes detected: $path" }
            $source = $file.backup
            $expected = $file.sha256
        } elseif ($current -ne $file.sha256) { throw "Installed file changed since backup: $path" }
        $operations += [pscustomobject]@{ path=$path; source=$source; expected=$expected; backup=$file.backup; oldHash=$current }
    }
    # Do not terminate applications. Renamed, mapped DLLs remain available to
    # existing processes; new processes load the replacement at the original path.
    $serverPath = Join-Path $r.installRoot 'WeaselServer.exe'
    $servers = @(Get-Process WeaselServer -ErrorAction SilentlyContinue | Where-Object { $_.Path -eq $serverPath })
    if ($servers.Count) {
        $info = New-Object Diagnostics.ProcessStartInfo
        $info.FileName=$serverPath; $info.Arguments='/q'; $info.UseShellExecute=$false
        $info.CreateNoWindow=$true; $info.WindowStyle=[Diagnostics.ProcessWindowStyle]::Hidden
        $stop = [Diagnostics.Process]::Start($info)
        if (-not $stop.WaitForExit(15000)) { throw 'Shutdown helper still running.' }
        foreach ($server in $servers) { if (-not $server.WaitForExit(15000)) { throw 'Original server did not stop.' } }
    }
    Save-Result 'switching' 'Server stopped; applying verified files.'
    foreach ($op in $operations) {
        if ((Hash $op.path) -eq $op.expected) { continue }
        $parked = $op.path + '.jev-old-' + [guid]::NewGuid().ToString('N')
        # Both absolute paths stay in the same explicitly validated directory.
        if ((Split-Path -Parent $parked) -ne (Split-Path -Parent $op.path)) { throw 'Invalid parked path.' }
        Move-Item -LiteralPath $op.path -Destination $parked
        $changed.Add([pscustomobject]@{ path=$op.path; parked=$parked })
        Copy-Item -LiteralPath $op.source -Destination $op.path
        if ((Hash $op.path) -ne $op.expected) { throw "Post-copy verification failed: $($op.path)" }
    }
    $changed | ConvertTo-Json -Depth 4 | Set-Content -LiteralPath (Join-Path $receiptDir ('parked-' + (Get-Date -Format 'yyyyMMdd-HHmmss') + '.json')) -Encoding UTF8
    Save-Result 'files-switched' 'Restart server from the ordinary user session. Existing applications may retain old DLLs.'
} catch {
    $failure = $_.Exception.Message
    $recovery = @()
    for ($i=$changed.Count-1; $i -ge 0; $i--) {
        $op=$changed[$i]
        try {
            if (Test-Path -LiteralPath $op.path) {
                Move-Item -LiteralPath $op.path -Destination ($op.path + '.jev-failed-' + [guid]::NewGuid().ToString('N'))
            }
            Move-Item -LiteralPath $op.parked -Destination $op.path
        } catch { $recovery += $_.Exception.Message }
    }
    Save-Result 'failed' ($failure + '; recovery errors: ' + ($recovery -join '; '))
    throw
}
