param([string]$Repository = 'rime-jev')
$ErrorActionPreference = 'Stop'
if ($Repository -notmatch '^[A-Za-z0-9_.-]+$') { throw 'Repository must be a simple name.' }
$project = Split-Path -Parent $PSScriptRoot
Push-Location $project
try {
    & gh auth status
    if ($LASTEXITCODE -ne 0) {
        & gh auth login --hostname github.com --git-protocol https --web
        if ($LASTEXITCODE -ne 0) { throw 'GitHub login failed.' }
    }
    $remote = & git remote get-url origin 2>$null
    if ($LASTEXITCODE -eq 0 -and $remote) {
        throw 'origin already exists. Verify the destination and push manually; not overwritten.'
    }
    & gh repo create $Repository --private --source . --remote origin --push
    if ($LASTEXITCODE -ne 0) { throw 'Publish failed. Local commits remain intact.' }
} finally { Pop-Location }
