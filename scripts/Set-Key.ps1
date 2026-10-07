$ErrorActionPreference = 'Stop'
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
if (-not (Test-Path -LiteralPath $data)) { throw 'Run Install.ps1 first.' }
$config = Get-Content -LiteralPath (Join-Path $data 'config.json') -Raw | ConvertFrom-Json
$endpoint = if ($config.provider.endpoint) { $config.provider.endpoint } else { 'https://api.typesafe.ai/v1/systemone' }
Write-Host "Configured endpoint: $endpoint"
Write-Host 'Only pressing F8 sends the current pinyin, first-page candidates and up to 80 recent committed characters.'
Write-Host 'Your provider may charge for requests. Default cap: 200 attempts per UTC day. No automatic retries.'
Write-Host 'Do NOT use this mode for passwords, verification codes or confidential text.'
$answer = Read-Host 'Enable this cloud feature? Type YES to continue'
if ($answer -cne 'YES') { Write-Host 'Cancelled; no key changed.'; return }
$key = Read-Host 'Configured provider API key (hidden; never paste it into chat)' -AsSecureString
if ($key.Length -eq 0) { throw 'Empty key; nothing changed.' }
$key | ConvertFrom-SecureString | Set-Content -LiteralPath (Join-Path $data 'key.dpapi') -Encoding Ascii
& (Join-Path $PSScriptRoot 'Stop-Bridge.ps1')
& (Join-Path $PSScriptRoot 'Start-Bridge.ps1')
Write-Host 'Saved with Windows DPAPI for the current Windows account.'
