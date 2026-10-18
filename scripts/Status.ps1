param([switch]$Detailed)
$data = Join-Path $env:LOCALAPPDATA 'RimeJev'
$statusFile = Join-Path $data 'status.json'
if (-not (Test-Path -LiteralPath $statusFile)) { Write-Output '后台未启动，请运行 scripts/Start-Bridge.ps1。'; return }
$status = Get-Content -LiteralPath $statusFile -Raw -Encoding UTF8 | ConvertFrom-Json
if ($Detailed) { $status | Format-List }
$diagnosis = @{
    KEY_MISSING = '未配置当前服务的密钥；重新运行 Configure.cmd 并输入密钥。'
    NETWORK_ERROR = '连接服务失败；检查地址、网络及服务是否在线。'
    INVALID_PROVIDER_RESPONSE = '服务返回格式不匹配；确认所选地址提供 System One 接口。'
    PROVIDER_WORKER_FAILED = '服务请求后台异常；稍后重试并检查服务状态。'
    TIMEOUT = '服务响应超时；原候选保留，未自动重试。'
    DAILY_BUDGET_EXCEEDED = '已达每日请求上限；次日 UTC 零点重置。'
}
if ($status.lastError) {
    if ($diagnosis.ContainsKey([string]$status.lastError)) { Write-Warning $diagnosis[[string]$status.lastError] }
    elseif ($status.lastError -eq 'PROVIDER_HTTP_404') { Write-Warning '接口地址不存在（HTTP 404）；检查完整 API 路径，不要在 /v1/decisions 后追加 /v1/systemone。' }
    elseif ($status.lastError -in @('PROVIDER_HTTP_401','PROVIDER_HTTP_403')) { Write-Warning '服务拒绝鉴权；检查当前端点的密钥和模型权限。' }
    elseif ($status.lastError -eq 'PROVIDER_HTTP_429') { Write-Warning '服务商限流或额度不足；请检查服务商控制台。' }
    elseif ([string]$status.lastError -match '^PROVIDER_HTTP_\d+$') { Write-Warning "服务返回 HTTP 状态 $($status.lastError.Substring(14))；请检查服务商状态。" }
    else { Write-Warning ('最近请求错误：' + $status.lastError) }
}
$updated = if ($status.updatedAt -is [datetime]) { [DateTimeOffset]$status.updatedAt } else { [DateTimeOffset]::Parse($status.updatedAt) }
if ([DateTimeOffset]::UtcNow - $updated -gt [TimeSpan]::FromSeconds(5)) {
    Write-Warning '后台心跳过期，服务可能已停止。'
}
if (-not $Detailed) {
    Write-Output ('服务：{0}；模型：{1}' -f $status.endpoint, $status.model)
    Write-Output ('模式：{0}；今日请求：{1}/{2}' -f $status.mode, $status.callsToday, $status.callLimit)
    $preferences = Join-Path $data 'runtime\preferences'
    if (Test-Path -LiteralPath $preferences) {
        $lines = @((Get-Content -LiteralPath $preferences -Raw) -split '\r?\n')
        if ($lines.Count -ge 3 -and $lines[0] -eq 'JEVPREF1') {
            Write-Output ('自动请求：{0}；上文发送：{1}' -f $(if ($lines[1] -eq '1') { '开' } else { '关' }),
                $(if ($lines[2] -eq '1') { '开' } else { '关' }))
        }
    }
    if ($status.mode -eq 'offline') { Write-Output '尚未加载密钥，请运行 Configure.cmd。' }
    if ($status.requestState) { Write-Output ('当前请求：{0}（{1}ms）' -f $status.requestState.phase, $status.requestState.ageMs) }
    elseif (-not $status.lastResult) { Write-Output '尚无请求结果。请选择“雾凇拼音 - Jev”，按 F8 开启后输入拼音。' }
    else { Write-Output '当前无进行中的请求。' }
    if ($status.lastResult) {
        $last = $status.lastResult
        $label = switch ($last.decision) {
            'promoted' { '成功：已提升候选' }
            'same_first' { '成功：原首选不变' }
            'abstain' { '请求完成：保留原候选' }
            'error' { '请求失败' }
            default { [string]$last.decision }
        }
        Write-Output ('最近结果：{0}；总耗时：{1}ms；接口耗时：{2}ms' -f $label, $last.readyMs, $last.providerMs)
        if ($last.applyChannel -eq 'native') { Write-Output '输入法已回执原生刷新。' }
        else { Write-Output '尚无输入法刷新回执；后台结果成功不代表候选窗已显示。' }
    }
    Write-Output '底层连接和计时详情：scripts/Status.ps1 -Detailed'
    return
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
    if ($status.PSObject.Properties.Name -contains 'providerCancelGraceMs') {
        Write-Output ('Cooperative cancellations {0}, forced cancellations {1}; acknowledgement grace {2}ms (within the request deadline).' -f
            $status.providerWorker.cooperativeCancellations, $status.providerWorker.hardCancellations, $status.providerCancelGraceMs)
        Write-Output 'Normal cancellation reuses the settled worker; an ignored abort or timeout retires it before the next request.'
    } else {
        Write-Output 'This bridge version retires the worker on every timeout/cancellation.'
    }
    Write-Output 'No automatic API retry. providerMs includes worker startup/teardown; reuse does not remove provider/network latency.'
}
if ($status.PSObject.Properties.Name -contains 'providerTransport') {
    Write-Output ('Transport: {0}; idle connection limit {1}ms. HTTP/2 cancellation closes the stream, not its healthy TLS connection.' -f
        $status.providerTransport, $status.connectionIdleMs)
    Write-Output 'ALPN selects HTTP/2 or HTTP/1.1 before sending; no speculative API calls, redirects or POST retries.'
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
    if ($status.lastResult.transport.protocol) {
        $transport = $status.lastResult.transport
        Write-Output ('Connection: {0}, reused={1}, connect={2}ms, response headers={3}ms, body={4}ms.' -f
            $transport.protocol, $transport.reusedConnection, $transport.connectMs, $transport.headersMs, $transport.bodyMs)
        Write-Output 'connectMs is included in headersMs, not an additional delay. The rest is not pure model-inference time.'
    }
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
