$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$statusFile = Join-Path $data 'status.json'
if (-not (Test-Path -LiteralPath $statusFile)) { Write-Output 'Not started.'; return }
$status = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json
$status | Format-List
if ([DateTimeOffset]::UtcNow - [DateTimeOffset]::Parse($status.updatedAt) -gt [TimeSpan]::FromSeconds(5)) {
    Write-Warning 'Status is stale: bridge is stopped or unhealthy.'
}
