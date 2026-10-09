$ErrorActionPreference = 'Stop'
try {
    $data = Join-Path $env:LOCALAPPDATA 'RimeJev'
    $configFile = Join-Path $data 'config.json'
    if (-not (Test-Path -LiteralPath $configFile)) { throw '尚未安装，请先运行 scripts\Install.ps1。' }
    $config = Get-Content -LiteralPath $configFile -Raw | ConvertFrom-Json
    $current = $config.provider
    $oldEndpoint = if ($current.endpoint) { $current.endpoint } else { 'https://api.typesafe.ai/v1/systemone' }
    $oldModel = if ($current.model) { $current.model } else { 'jev-latest' }
    $oldAuth = if ($current.auth) { $current.auth } else { 'bearer' }
    $oldLimit = if ($config.callLimit) { [int]$config.callLimit } else { 200 }
    Write-Host ''
    Write-Host '=== 小狼毫 Jev / OpenJev 配置 ==='
    Write-Host '支持官方、中转或本地服务的 System One 兼容接口。'
    Write-Host '如果混合路由在你的中转里完成，填写中转的统一入口即可。'
    Write-Host '暂不支持仅提供 chat/completions 的接口，也不做客户端双服务切换。'
    Write-Host '地址须填写完整请求端点，例如 https://你的中转/v1/systemone。'
    Write-Host '按回车保留方括号中的现有值。'
    $value = Read-Host "服务端点 [$oldEndpoint]"
    $endpoint = if ($value.Trim()) { $value.Trim() } else { $oldEndpoint }
    $uri = [Uri]$endpoint
    $localHost = $uri.Host -in @('localhost','127.0.0.1','[::1]','::1')
    if (-not $uri.IsAbsoluteUri -or $uri.UserInfo -or $uri.Query -or $uri.Fragment -or
        ($uri.Scheme -ne 'https' -and -not ($localHost -and $uri.Scheme -eq 'http'))) {
        throw '远程服务必须用 HTTPS；HTTP 仅允许本机。地址不能包含密钥、查询参数或片段。'
    }
    $value = Read-Host "模型名（以服务端实际名称为准）[$oldModel]"
    $model = if ($value.Trim()) { $value.Trim() } else { $oldModel }
    if (-not $model -or $model.Length -gt 200) { throw '模型名无效。' }
    $value = Read-Host "鉴权 bearer / none（none 仅本机）[$oldAuth]"
    $auth = if ($value.Trim()) { $value.Trim().ToLowerInvariant() } else { $oldAuth }
    if ($auth -notin @('bearer','none') -or ($auth -eq 'none' -and -not $localHost)) { throw '鉴权设置无效。' }
    $oldNone = if ($current -and $current.allowNone -eq $false) { 'n' } else { 'y' }
    $value = Read-Host "包含“以上皆非”候选 y/n [$oldNone]"
    $none = if ($value.Trim()) { $value.Trim().ToLowerInvariant() } else { $oldNone }
    if ($none -notin @('y','n')) { throw '请输入 y 或 n。' }
    $value = Read-Host "每天最多请求次数（UTC 日期，1-10000）[$oldLimit]"
    $limit = $oldLimit
    if ($value.Trim() -and -not [int]::TryParse($value.Trim(), [ref]$limit)) { throw '请求上限必须是整数。' }
    if ($limit -lt 1 -or $limit -gt 10000) { throw '请求上限必须在 1-10000 之间。' }
    $debounce = if ($null -ne $config.debounceMs) { [int]$config.debounceMs } else { 100 }
    $value = Read-Host "防抖毫秒 0-2000 [$debounce]（40 更快，但可能增加中间拼音请求和费用；不是总延迟）"
    if ($value.Trim() -and -not [int]::TryParse($value.Trim(), [ref]$debounce)) { throw '防抖必须是整数。' }
    if ($debounce -lt 0 -or $debounce -gt 2000) { throw '防抖必须在 0-2000 之间。' }
    $value = Read-Host '自动请求 y/n [n]（开启后普通拼音也会发送；默认关闭）'
    $auto = $value.Trim().ToLowerInvariant() -eq 'y'
    if ($value.Trim() -and $value.Trim().ToLowerInvariant() -notin @('y','n')) { throw '请输入 y 或 n。' }
    $value = Read-Host '发送光标前上文 y/n [n]（默认关闭；其他应用仍是近期提交历史，不等于真实正文）'
    $context = $value.Trim().ToLowerInvariant() -eq 'y'
    if ($value.Trim() -and $value.Trim().ToLowerInvariant() -notin @('y','n')) { throw '请输入 y 或 n。' }
    $documentContext = $config.contextProvider
    if ($context) {
        Write-Host 'Pebrel/Codex 可通过本地 Runtime 读取当前输入区，最多发送光标前 80 字；不发送终端输出。'
        Write-Host '当前版本需读取可见终端文本格，短暂保存在后台内存，可能增加约 2 秒读取/复核延迟。'
        $value = Read-Host '启用 Pebrel/Codex 真实输入区上文 y/n [n]（读不到时保留原候选，不使用旧提交历史）'
        if ($value.Trim() -and $value.Trim().ToLowerInvariant() -notin @('y','n')) { throw '请输入 y 或 n。' }
        $documentContext = $null
        if ($value.Trim().ToLowerInvariant() -eq 'y') {
            $cli = $env:PEBREL_CLI
            if (-not $cli) { $cli = Read-Host 'Pebrel 可执行文件的完整路径（pebrel.exe）' }
            if (-not [IO.Path]::IsPathRooted($cli) -or -not (Test-Path -LiteralPath $cli -PathType Leaf) -or
                [IO.Path]::GetFileName($cli) -ine 'pebrel.exe') { throw 'Pebrel 路径无效。' }
            $documentContext = @{ type='pebrel-codex'; cli=$cli }
        }
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
    Write-Host ''
    Write-Host "端点：$($uri.AbsoluteUri)"
    Write-Host "模型：$model；鉴权：$auth；每日请求上限：$limit"
    Write-Host "F8 是持久化开关；自动请求有 ${debounce}ms 防抖，失败保留原候选。"
    Write-Host '开启后发送拼音和首屏候选；上文仅在你另行开启时发送。费用由你的服务决定。'
    Write-Host '标准小狼毫不支持停笔刷新；实验版仅 x64 TSF 支持，完整界面验收仍待完成。'
    Write-Host '不要在密码、验证码或保密文本中触发。密钥仅以 Windows DPAPI 加密保存。'
    if ((Read-Host '保存并重启？输入 YES 确认') -cne 'YES') {
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
    [IO.File]::WriteAllText((Join-Path $data 'runtime\preferences'), $pref, [Text.Encoding]::ASCII)
    & (Join-Path $PSScriptRoot 'Start-Bridge.ps1')
    Start-Sleep -Seconds 2
    & (Join-Path $PSScriptRoot 'Status.ps1')
    Write-Host '已保存。F4 选择“雾凇拼音 - Jev”，用非敏感文本测试；F8 开关，Ctrl+Alt+F8 诊断读取。'
    Write-Host 'live 只表示服务已启用，真实 API 是否成功需看一次实际请求结果。'
} catch {
    Write-Host ('配置失败：' + $_.Exception.Message) -ForegroundColor Red
    exit 1
}
