# 小狼毫 + 雾凇 + Jev 候选重排（Windows）

保留现有小狼毫、雾凇词库和皮肤，新增独立的 **雾凇拼音 - Jev** 方案。
不安装 PIME，不替换 `rime.dll`，不需要 Visual Studio 或重新编译。
当前机器的小狼毫 0.17.4 / librime 1.13.1 已内置 Lua 5.4.7。

Jev 协议客户端直接复用 MIT 项目
[Ideny42/jev-keyboard](https://github.com/Ideny42/jev-keyboard)，固定来源和许可证见
`vendor/jev-keyboard/UPSTREAM.md`。Windows Lua、文件 IPC、安装和密钥管理为本项目适配。

## 开始使用

已安装的用户直接双击项目根目录 **`Configure.cmd`**，即可依次设置中转完整端点、
模型名、鉴权、候选选项、每日请求上限及隐藏输入的密钥，最后确认保存并自动重启服务。
回车保留现有值；相同端点允许保留已有密钥，更换端点必须输入新密钥。
配置向导不会进行联网测试或自动发送打字内容。自动请求默认关闭，需要明确开启。F8 是持久化开关。

安装（首次运行；配置文件会先备份）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install.ps1 -Autostart
```

密钥不要发给聊天助手。在你自己的 PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Set-Key.ps1
```

该脚本先解释云调用范围，输入 `YES` 后才接受隐藏输入的 TypeSafe API Key。
密钥通过当前 Windows 账户的 **DPAPI** 加密保存，不放在 YAML、仓库、启动参数或日志里。
申请密钥：[TypeSafe 控制台](https://console.typesafe.ai/)。
默认使用官方 TypeSafe 接口，也支持自定义中转及本地 OpenJev 的 **System One 兼容接口**。
密钥必须属于配置的服务，不能把第三方 Key 发到官方域名。

配置自定义服务（地址应是完整请求端点，模型名以服务端为准）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Set-Provider.ps1 -Endpoint "https://your-relay.example/v1/systemone" -Model "openjev"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Set-Key.ps1
```

本地无鉴权 OpenJev 可以用 `-Auth none`，仅允许 localhost/127.0.0.1/::1。
更换服务会清除旧密钥，防止把官方 Key 或其他服务的 Key 误发到新地址。
只有 `/v1/chat/completions` 的中转目前未实现适配，不能仅改 URL 就使用。
服务端若已经混合路由 Jev/OpenJev，本客户端可调用其统一 System One 入口；
客户端暂不做双服务自动切换、并行投票或跨服务传递凭证。
`-WithoutNoneOption` 可去掉“以上皆非”选项，服务须仍返回所有候选的有效概率及 model/usage。

1. 双击 `Configure.cmd` 配置服务，按需开启自动请求；默认不发送上文。
2. 切换到“小狼毫”，按 F4 选择“雾凇拼音 - Jev”。
3. F8 一键切换自动请求开关；设置保存在本机，重启仍保留。
4. 正常输入触发后台请求；350ms 防抖，旧输入取消后不发送。
5. **当前尚不能在停笔后主动刷新候选窗**。Ctrl+Alt+F8 是诊断刷新，不是最终体验；Ctrl+F8 清空上文。

### 未完成的关键环节

已新增实验性原生前端补丁，见 `native/README.md`：通过 TSF 编辑会话和专用 IPC 刷新，
而不是模拟快捷键。此补丁正在构建和验证，尚未替换本机正在运行的输入法。
以下限制仍适用于当前安装的标准小狼毫版本。

现有 Weasel 0.17.4 的 Lua 没有定时器；候选窗也没有可供独立插件安全调用的异步刷新接口。
本项目不使用 SendInput 注入按键、不从后台线程调用 Rime Context，也不在空格/数字选词时偷偷读取结果换词。
因此目前实现的是自动请求和开关，**不是完整全自动输入法**。停笔后的结果可能仍停留在文件中，候选提示也不会立即更新。
要实现用户不再按刷新键，需要给 Weasel 增加受会话、焦点和手动选择校验的专用刷新通道，或改用提供该能力的前端。
不能只编译 librime-lua 就得到这条通道。不要把此版自动请求视为最终交付。

## 状态提示

候选旁的英文短提示用于避免字体兼容问题：

| 提示 | 含义 |
| --- | --- |
| `Jev: off` | 自动请求关闭 |
| `pending` | 请求等待中；提示可能在结果到达后仍未刷新 |
| `ranked` | 已应用到当前候选 |
| `keep original` | 概率不够明确，保留原序 |
| `configure key` | 服务已启动，但未配置密钥 |
| `start service` | 服务未运行或心跳过期 |
| `RATE_LIMITED` | 两次请求间隔不足一秒 |
| `DAILY_BUDGET_EXCEEDED` | 达到当天请求次数上限 |

查看后台状态：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Status.ps1
```

## 行为与限制

- **尚不是全自动排序**：自动请求已实现，停笔后主动刷新未实现；F8 仅用于开关，Ctrl+Alt+F8 是临时诊断读取。
- 只重排首屏，最多 10 个候选，且必须尚未移动选择。当前配置是 7 个；后续候选完整保留。
- 只提升一个胜出词，其他候选相对顺序不变。最高概率至少 0.60，领先第二名/“以上皆非”至少 0.15，否则不调整。
- 输入、光标、候选、会话、请求序号和服务实例都参与有效性检查；12 秒后结果过期。
- API 超时 4 秒，在后台等待；不在按键线程运行网络请求、子进程或等待循环。同步本地文件 I/O 仍可能受磁盘/杀毒软件影响，不能承诺绝对零延迟。
- 每秒最多一次请求，默认每个 UTC 日最多 200 次尝试；计数落盘，重启不会重置。当日上限不是美元预算。
- 不重试，不自动切换服务商。断网、密钥缺失、服务停止、无效响应时保留本地原候选。
- 默认使用 `jev-latest`，可配置服务端模型名；真实准确率和公网延迟需要接通服务后另行实测。

## 隐私

**官方 Jev 通过服务调用；OpenJev 可由你自己的本地/中转服务提供。** 开启自动请求后，会将当前拼音、当前页候选，以及可选的最多 80 个最近上屏字符发送到
你配置的服务端点（默认 `https://api.typesafe.ai/v1/systemone`）。关闭时不自动发送；开启时普通打字会触发防抖请求。上文默认关闭。

上文改为实验性 x64 TSF 文档快照，不再使用 Rime 提交历史。必须同时开启上文开关并在
`jev_windows/context_apps` 中显式允许目标应用；默认列表为空，不读取任何应用正文。
原生组件在组合起点之前读取最多 80 个 Unicode 码点，并在文档锁内复核后应用排序。
不支持的应用使用无上文排序，已知敏感输入不请求。Ctrl+F8 抑制当前组合的上文读取。
这不是通用终端或游戏支持，也不保证所有密码框识别。构建、测试边界与回滚见 `native/CONTEXT.md`。

**输入密码、验证码、隐私或保密内容时，请切换普通雾凇/系统输入法，确保 Jev 关闭，不要依赖应用自动识别。**
本项目没有声称能自动识别或脱敏全部敏感内容。

IPC 暂存到当前账户私有目录，请求和结果约 15 秒清理；进程运行内存可包含上文。
不记录原始输入、API 响应或密钥；状态日志只包含错误代码/调用计数。
DPAPI 保护的是静态密钥；同一登录账户下的恶意进程仍有能力读取本账户数据。

## 文件与回退

- `%APPDATA%\Rime\rime_ice_jev.schema.yaml`：独立方案；共享 `rime_ice` 词库和用户词频。
- `%APPDATA%\Rime\lua\jev_windows.lua`：客户端。
- `%APPDATA%\Rime\default.custom.yaml`：仅追加一个可选方案；安装前原文件已备份。
- `%LOCALAPPDATA%\RimeJev`：加密密钥、配置、状态、IPC 和备份，ACL 仅当前账户及 SYSTEM。
- `config.json` 中的 `callLimit` 可调整（1–10000），修改后重启后台服务。
- 如果安装时指定 `-Autostart`，创建当前用户的 `Rime Jev Bridge.lnk` 登录启动项，后台隐藏运行。
- 不改变 `weasel.custom.yaml` 皮肤、不覆盖旧的 `Rime\user` / `Rime\shared` 尝试、不删除用户词库。
- 启动项引用本项目目录；不要在使用期间移动或删除本目录。

停止/启动：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Stop-Bridge.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Start-Bridge.ps1
```

卸载并恢复原配置：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Uninstall.ps1
```

卸载检查安装后文件哈希，发现你后续编辑过配置时会停下，不覆盖你的新修改。
备份和加密密钥默认保留，可按需自行删除。普通雾凇始终可以通过 F4 切回。

## 验证

```powershell
node --test tests/bridge.test.mjs tests/provider.test.mjs
python tests/native_rime.py
```

原生集成测试复制编译词典到 `runtime/native-*`，直接调用当前 `rime.dll`，不接触真实用户词库。
测试 provider 是明确的 **mock**，只验证自动请求、开关、诊断刷新置顶、翻页、取消和停服回退；
生产入口不提供 mock 模式。测试通过**不等于**真实 Jev API 已成功调用。

上游资料：
[小狼毫](https://github.com/rime/weasel) ·
[雾凇拼音](https://github.com/iDvel/rime-ice) ·
[librime-lua](https://github.com/hchunhui/librime-lua) ·
[TypeSafe Choice API](https://docs.typesafe.ai/primitives/choice)

## 持久化和 GitHub

代码在本目录的 Git 仓库；运行时目录、密钥、个人配置、词库和二进制不入库。
更新安装文件用 `scripts/Update.ps1`，它先检查用户修改并备份，不覆盖旧卸载备份。

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Publish-GitHub.ps1
```

发布脚本通过 GitHub CLI 的浏览器登录，将当前仓库上传为**私有仓库**，默认名 `rime-jev`。
不要求把 GitHub Token 发给助手；已有 origin 时拒绝覆盖。GitHub 未登录时不会声称已经上传。
