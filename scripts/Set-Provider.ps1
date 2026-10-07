param(
    [Parameter(Mandatory=$true)][string]$Endpoint,
    [Parameter(Mandatory=$true)][string]$Model,
    [ValidateSet('bearer','none')][string]$Auth = 'bearer',
    [switch]$WithoutNoneOption
)
$ErrorActionPreference = 'Stop'
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$uri = [Uri]$Endpoint
$localHost = $uri.Host -in @('localhost','127.0.0.1','[::1]','::1')
if (-not $uri.IsAbsoluteUri -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
    ($uri.Scheme -ne 'https' -and -not ($localHost -and $uri.Scheme -eq 'http'))) {
    throw 'Use HTTPS or local HTTP, no URL credentials/query/fragment.'
}
if ($Auth -eq 'none' -and -not $localHost) { throw 'No-auth is restricted to localhost.' }
if (-not $Model.Trim() -or $Model.Length -gt 200) { throw 'Invalid model.' }
$configFile = Join-Path $data 'config.json'
$config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
$provider = @{ endpoint=$uri.AbsoluteUri; protocol='systemone'; model=$Model; auth=$Auth; allowNone=(-not $WithoutNoneOption) }
Write-Host "Input will be sent to: $($uri.AbsoluteUri)"
Write-Host "Model: $Model; protocol: System One; auth: $Auth"
Write-Host 'Changing provider clears the old key to avoid sending it to a different service.'
if ((Read-Host 'Use this service? Type YES') -cne 'YES') { return }
& (Join-Path $PSScriptRoot 'Stop-Bridge.ps1')
Copy-Item -LiteralPath $configFile -Destination ($configFile + '.previous')
Remove-Item -LiteralPath (Join-Path $data 'key.dpapi') -Force -ErrorAction SilentlyContinue
$config | Add-Member -NotePropertyName provider -NotePropertyValue $provider -Force
$json = $config | ConvertTo-Json -Depth 6
[IO.File]::WriteAllText($configFile, $json, (New-Object Text.UTF8Encoding($false)))
& (Join-Path $PSScriptRoot 'Start-Bridge.ps1')
if ($Auth -eq 'bearer') { Write-Host 'Now run scripts/Set-Key.ps1 for THIS provider key.' }
