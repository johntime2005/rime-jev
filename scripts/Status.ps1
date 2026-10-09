$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$statusFile = Join-Path $data 'status.json'
if (-not (Test-Path -LiteralPath $statusFile)) { Write-Output 'Not started.'; return }
$status = Get-Content -LiteralPath $statusFile -Raw | ConvertFrom-Json
$status | Format-List
$updated = if ($status.updatedAt -is [datetime]) { [DateTimeOffset]$status.updatedAt } else { [DateTimeOffset]::Parse($status.updatedAt) }
if ([DateTimeOffset]::UtcNow - $updated -gt [TimeSpan]::FromSeconds(5)) {
    Write-Warning 'Status is stale: bridge is stopped or unhealthy.'
}
if ($status.PSObject.Properties.Name -contains 'requestState') {
    if ($status.requestState) {
        Write-Output ('Current request: {0}, phase age {1}ms (last heartbeat sample).' -f $status.requestState.phase, $status.requestState.ageMs)
    } else {
        Write-Output 'Current request: idle at last heartbeat. A visible pending label alone does not mean the API is running.'
    }
}
if ($status.providerIsolation -eq 'worker') {
    Write-Output ('Provider worker: deadline {0}ms; starts {1}, hard timeouts {2}, cancellations {3}, crashes/exits {4} (since bridge start).' -f
        $status.timeoutMs, $status.providerWorker.starts, $status.providerWorker.hardTimeouts,
        $status.providerWorker.cancellations, $status.providerWorker.failures)
    Write-Output 'Timeout/cancellation retires the worker before another request; no automatic API retry. providerMs includes worker startup/teardown.'
}
if ($status.lastResult) {
    Write-Output 'Last result (timings in ms; no input text recorded):'
    $status.lastResult | Format-List
    if ($status.lastResult.ranking) {
        Write-Output 'Ranking decision (numbers only; no candidate or context text):'
        $status.lastResult.ranking | Format-List
        if ($status.lastResult.contextChars -eq 0) { Write-Output 'No preceding text was included in this request.' }
    }
    if ($status.lastResult.contextState) {
        Write-Output ('Context: source={0}, reason={1}, chars={2}.' -f $status.lastResult.contextState.source,
            $status.lastResult.contextState.reason, $status.lastResult.contextChars)
    }
    if ($status.lastResult.contextError) {
        Write-Output ('Document context not verified: {0}. Original candidates retained; stale history is not used.' -f $status.lastResult.contextError)
    }
    Write-Output 'native = Lua regenerated candidates through native refresh; not proof of pixels rendered.'
    Write-Output 'not_observed = no adapter receipt yet; may be cancelled, still waiting, or an old/unsupported frontend.'
}
if ($status.cache) {
    Write-Output ('Exact in-memory cache: hits {0}, network attempts {1}, TTL {2}ms. No cross-session/focus/context reuse.' -f
        $status.cache.hits, $status.cache.misses, $status.cache.ttlMs)
}
if ($status.lastCancellation) {
    Write-Output 'Last bridge cancellation (phase, not cause):'
    $status.lastCancellation | Format-List
}
if ($status.lastAdapterCancellation) {
    Write-Output 'Last adapter cancellation (cause; correlate requestId, not just the newest result):'
    $status.lastAdapterCancellation | Format-List
    Write-Output 'Adapter receipts include requests cancelled before discovery; their count is not the number of API calls.'
}
