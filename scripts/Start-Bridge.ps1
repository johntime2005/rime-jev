param([switch]$Foreground)
$ErrorActionPreference = 'Stop'
$project = Split-Path -Parent $PSScriptRoot
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$node = (Get-Command node.exe -ErrorAction Stop).Source
if (-not $Foreground) {
    # Preserve the PowerShell edition and its PSModulePath. Launching Windows
    # PowerShell from pwsh can break Security-module autoload and hide the key.
    $ps = Join-Path $PSHOME 'pwsh.exe'
    if (-not (Test-Path -LiteralPath $ps)) { $ps = Join-Path $PSHOME 'powershell.exe' }
    $args = '-NoProfile -ExecutionPolicy Bypass -File "{0}" -Foreground' -f $PSCommandPath
    Start-Process -FilePath $ps -ArgumentList $args -WorkingDirectory $project -WindowStyle Hidden | Out-Null
    Write-Output 'Bridge launcher started. Run scripts/Status.ps1 to check it.'
    return
}
$secretFile = Join-Path $data 'key.dpapi'
try {
    if (Test-Path -LiteralPath $secretFile) {
        try {
            $secure = (Get-Content -LiteralPath $secretFile -Raw).Trim() | ConvertTo-SecureString
            $cred = New-Object System.Net.NetworkCredential('', $secure)
            $env:TYPESAFE_API_KEY = $cred.Password
        } catch {
            # Never print the stored value or attempt to interpret it as plaintext.
            Remove-Item Env:TYPESAFE_API_KEY -ErrorAction SilentlyContinue
            Write-Warning ('Key load failure category: ' + $_.Exception.GetType().Name + ' / ' + $_.FullyQualifiedErrorId)
            Write-Warning 'Stored key cannot be decrypted. Starting without it; use Configure.cmd to replace it.'
        }
    }
    & $node (Join-Path $project 'bridge.mjs') $data 2>> (Join-Path $data 'bridge-errors.log')
} finally {
    Remove-Item Env:TYPESAFE_API_KEY -ErrorAction SilentlyContinue
}
