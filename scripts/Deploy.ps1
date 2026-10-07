$ErrorActionPreference = 'Stop'
$weasel = (Get-ItemProperty 'HKLM:\Software\WOW6432Node\Rime\Weasel' -ErrorAction Stop).WeaselRoot
$info = New-Object System.Diagnostics.ProcessStartInfo
$info.FileName = Join-Path $weasel 'WeaselDeployer.exe'
# Weasel compares the entire argument string. Windows PowerShell Start-Process
# can append a space, opening its settings dialog instead of deploying.
$info.Arguments = '/deploy'
$info.UseShellExecute = $false
$info.CreateNoWindow = $true
$info.WindowStyle = [System.Diagnostics.ProcessWindowStyle]::Hidden
$process = [System.Diagnostics.Process]::Start($info)
if (-not $process.WaitForExit(120000)) { throw 'Deployer is still running. Check the Rime deploy log; do not start another copy.' }
if ($process.ExitCode -ne 0) { throw "Deployer failed: $($process.ExitCode)" }
$process.Dispose()
$rime = (Get-ItemProperty 'HKCU:\Software\Rime\Weasel').RimeUserDir
if (Test-Path -LiteralPath (Join-Path $rime 'rime_ice_jev.schema.yaml')) {
    $compiled = Join-Path $rime 'build\rime_ice_jev.schema.yaml'
    if (-not (Test-Path -LiteralPath $compiled)) { throw 'Jev schema did not compile; inspect Rime logs.' }
    $text = [IO.File]::ReadAllText($compiled)
    if ($text -notmatch 'lua_filter@\*jev_windows\*filter' -or $text -notmatch 'lua_processor@\*jev_windows\*processor') {
        throw 'Compiled schema is missing Jev components.'
    }
}
Write-Output 'Rime deployment completed.'
