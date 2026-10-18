$ErrorActionPreference = 'Stop'
try {
    . (Join-Path $PSScriptRoot 'Installer.Common.ps1')
    Import-JevSecurityModule
    $data = Join-Path $env:LOCALAPPDATA 'RimeJev'
    $configFile = Join-Path $data 'config.json'
    if (-not (Test-Path -LiteralPath $configFile)) { throw '尚未安装，请先运行 scripts\Install.ps1。' }
    $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    $current = $config.provider
    $oldEndpoint = if ($current.endpoint) { $current.endpoint } else { 'https://api.typesafe.ai/v1/systemone' }
    $oldModel = if ($current.model) { $current.model } else { 'jev-latest' }
    $oldAuth = if ($current.auth) { $current.auth } else { 'bearer' }
    $oldLimit = if ($config.callLimit) { [int]$config.callLimit } else { 200 }
    $preferencesPath = Join-Path $data 'runtime\preferences'
    $preference = if (Test-Path -LiteralPath $preferencesPath) { Get-Content -LiteralPath $preferencesPath -Raw } else { '' }
    $preferenceLines = @($preference -split "\r?\n" | ForEach-Object { $_.Trim() })
    $oldAuto = if ($preferenceLines.Count -ge 2 -and $preferenceLines[1] -match '^[01]$') { if ($preferenceLines[1] -eq '1') { 'y' } else { 'n' } } else { 'n' }
    $oldContext = if ($preferenceLines.Count -ge 3 -and $preferenceLines[2] -match '^[01]$') { if ($preferenceLines[2] -eq '1') { 'y' } else { 'n' } } else { 'n' }
    Write-Host ''
    Write-Host '=== 小狼毫 Jev / OpenJev 配置 ==='
    Write-Host '填写服务地址、模型和密钥即可开始；回车保留现有值。'
    Write-Host '填写完整 API 地址时保持原路径；只填域名或 /v1 时补全 /v1/systemone。'
    $value = Read-Host "服务端点 [$oldEndpoint]"
    $endpoint = if ($value.Trim()) { $value.Trim() } else { $oldEndpoint }
    $uri = Resolve-JevEndpoint $endpoint
    $localHost = Test-JevLocalEndpoint $uri
    if (-not $uri.IsAbsoluteUri -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        ($uri.Scheme -ne 'https' -and -not ($localHost -and $uri.Scheme -eq 'http'))) {
        throw '远程服务必须用 HTTPS；HTTP 仅允许本机。地址不能包含密钥、查询参数或片段。'
    }
    $value = Read-Host "模型名（以服务端实际名称为准）[$oldModel]"
    $model = if ($value.Trim()) { $value.Trim() } else { $oldModel }
    if (-not $model -or $model.Length -gt 200) { throw '模型名无效。' }
    $auth = 'bearer'
    if ($localHost) {
        $value = Read-Host "本机服务鉴权 bearer / none [$oldAuth]"
        $auth = if ($value.Trim()) { $value.Trim().ToLowerInvariant() } else { $oldAuth }
    }
    if ($auth -notin @('bearer','none') -or ($auth -eq 'none' -and -not $localHost)) { throw '鉴权设置无效。' }
    $value = Read-Host "自动请求 y/n [$oldAuto]（开启后会发送拼音和候选）"
    $auto = if ($value.Trim()) { $value.Trim().ToLowerInvariant() -eq 'y' } else { $oldAuto -eq 'y' }
    if ($value.Trim() -and $value.Trim().ToLowerInvariant() -notin @('y','n')) { throw '请输入 y 或 n。' }
    $none = if ($current -and $current.allowNone -eq $false) { 'n' } else { 'y' }
    $limit = $oldLimit
    $debounce = if ($null -ne $config.debounceMs) { [int]$config.debounceMs } else { 100 }
    $context = $oldContext -eq 'y'
    $documentContext = $config.contextProvider
    if ((Read-Host '更改请求上限、防抖、上文和候选选项？[y/N]') -match '^(?i:y|yes)$') {
        $value = Read-Host "每天最多请求次数 [$limit]"
        if ($value.Trim() -and -not [int]::TryParse($value.Trim(), [ref]$limit)) { throw '请求上限必须是整数。' }
        if ($limit -lt 1 -or $limit -gt 10000) { throw '请求上限必须在 1-10000 之间。' }
        $value = Read-Host "防抖毫秒 [$debounce]"
        if ($value.Trim() -and -not [int]::TryParse($value.Trim(), [ref]$debounce)) { throw '防抖必须是整数。' }
        if ($debounce -lt 0 -or $debounce -gt 2000) { throw '防抖必须在 0-2000 之间。' }
        $value = Read-Host "包含“以上皆非”候选 y/n [$none]"
        $none = if ($value.Trim()) { $value.Trim().ToLowerInvariant() } else { $none }
        if ($none -notin @('y','n')) { throw '请输入 y 或 n。' }
        $value = Read-Host "发送光标前上文 y/n [$oldContext]"
        $context = if ($value.Trim()) { $value.Trim().ToLowerInvariant() -eq 'y' } else { $oldContext -eq 'y' }
        if ($value.Trim() -and $value.Trim().ToLowerInvariant() -notin @('y','n')) { throw '请输入 y 或 n。' }
    }
    if ($context) {
        Write-Host 'Pebrel/Codex 可通过本地 Runtime 读取当前输入区，最多发送光标前 80 字；不发送终端输出。'
        $pebrelDefault = if ($documentContext) { 'y' } else { 'n' }
        $value = Read-Host "启用 Pebrel/Codex 输入区上文 y/n [$pebrelDefault]"
        if ($value.Trim() -and $value.Trim().ToLowerInvariant() -notin @('y','n')) { throw '请输入 y 或 n。' }
        $usePebrel = if ($value.Trim()) { $value.Trim().ToLowerInvariant() -eq 'y' } else { $pebrelDefault -eq 'y' }
        if ($usePebrel) {
            $cli = $env:PEBREL_CLI
            if (-not $cli) { $cli = Read-Host 'Pebrel 可执行文件的完整路径（pebrel.exe）' }
            if (-not [IO.Path]::IsPathRooted($cli) -or -not (Test-Path -LiteralPath $cli -PathType Leaf) -or
                [IO.Path]::GetFileName($cli) -ine 'pebrel.exe') { throw 'Pebrel 路径无效。' }
            $documentContext = @{ type='pebrel-codex'; cli=$cli }
        } else { $documentContext = $null }
    } else {
        $documentContext = $null
    }
    $keyFile = Join-Path $data 'key.dpapi'
    $changed = $uri.AbsoluteUri -cne ([Uri]$oldEndpoint).AbsoluteUri -or $auth -ne $oldAuth
    $canKeepKey = -not $changed -and (Test-Path -LiteralPath $keyFile)
    $encryptedKey = $null
    if ($auth -eq 'bearer') {
        if ($canKeepKey) { Write-Host '密钥隐藏输入；直接回车保留当前服务的已有密钥。' }
        else { Write-Host '请输入此服务的密钥；更换端点不能沿用旧服务的密钥。' }
        $key = Read-Host 'API Key' -AsSecureString
        if ($key.Length -gt 0) { $encryptedKey = $key | ConvertFrom-SecureString }
        elseif (-not $canKeepKey) { throw '未输入密钥，取消配置；原配置未改变。' }
    }
    Write-Host "`n端点：$($uri.AbsoluteUri)"
    Write-Host "模型：$model；每日上限：$limit；自动请求：$(if ($auto) { '开' } else { '关' })"
    if ($auto) { Write-Host '自动请求会将拼音和首屏候选发送到该服务；密码及保密输入请勿使用。' }
    if ((Read-Host '保存并重启？[Y/n]') -match '^(?i:n|no)$') {
        Write-Host '已取消，原配置未改变。'
        return
    }
    $provider = @{ endpoint=$uri.AbsoluteUri; protocol='systemone'; model=$model; auth=$auth; allowNone=($none -eq 'y') }
    $config | Add-Member -NotePropertyName provider -NotePropertyValue $provider -Force
    $config | Add-Member -NotePropertyName callLimit -NotePropertyValue $limit -Force
    $config | Add-Member -NotePropertyName debounceMs -NotePropertyValue $debounce -Force
    $config | Add-Member -NotePropertyName contextProvider -NotePropertyValue $documentContext -Force
    $savedConfig = [IO.File]::ReadAllBytes($configFile)
    $savedKey = if (Test-Path -LiteralPath $keyFile) { [IO.File]::ReadAllBytes($keyFile) } else { $null }
    & (Join-Path $PSScriptRoot 'Stop-Bridge.ps1')
    try {
        Copy-Item -LiteralPath $configFile -Destination ($configFile + '.previous')
        [IO.File]::WriteAllText($configFile, ($config | ConvertTo-Json -Depth 6), (New-Object Text.UTF8Encoding($false)))
        if ($encryptedKey) { [IO.File]::WriteAllText($keyFile, $encryptedKey, [Text.Encoding]::ASCII) }
        elseif ($auth -eq 'none') { Remove-Item -LiteralPath $keyFile -Force -ErrorAction SilentlyContinue }
    } catch {
        [IO.File]::WriteAllBytes($configFile, $savedConfig)
        if ($null -ne $savedKey) { [IO.File]::WriteAllBytes($keyFile, $savedKey) }
        else { Remove-Item -LiteralPath $keyFile -Force -ErrorAction SilentlyContinue }
        & (Join-Path $PSScriptRoot 'Start-Bridge.ps1')
        throw
    }
    $pref = "JEVPREF1`n$(if ($auto) { '1' } else { '0' })`n$(if ($context) { '1' } else { '0' })`n"
    $savedPreferences = if (Test-Path -LiteralPath $preferencesPath) { [IO.File]::ReadAllBytes($preferencesPath) } else { $null }
    [IO.File]::WriteAllText($preferencesPath, $pref, [Text.Encoding]::ASCII)
    try { & (Join-Path $PSScriptRoot 'Start-Bridge.ps1') }
    catch {
        # A bad endpoint or model must not leave the bridge unusable. Restore
        # the last known-good files before attempting to restart it.
        [IO.File]::WriteAllBytes($configFile, $savedConfig)
        if ($null -ne $savedKey) { [IO.File]::WriteAllBytes($keyFile, $savedKey) }
        elseif (Test-Path -LiteralPath $keyFile) { Remove-Item -LiteralPath $keyFile -Force }
        if ($null -ne $savedPreferences) { [IO.File]::WriteAllBytes($preferencesPath, $savedPreferences) }
        else { Remove-Item -LiteralPath $preferencesPath -Force -ErrorAction SilentlyContinue }
        & (Join-Path $PSScriptRoot 'Start-Bridge.ps1')
        throw '新配置未能启动后台服务，已恢复原配置。'
    }
    Start-Sleep -Seconds 2
    & (Join-Path $PSScriptRoot 'Status.ps1')
    Write-Host '已保存。切换到“雾凇拼音 - Jev”即可使用；F8 可切换自动请求。'
} catch {
    Write-Host ('配置失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
