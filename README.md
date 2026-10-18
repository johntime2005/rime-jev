# 小狼毫 + 雾凇 + Jev 候选重排（Windows）

保留现有小狼毫、雾凇词库和皮肤，新增独立的 **雾凇拼音 - Jev** 方案。
不安装 PIME，不替换 `rime.dll`，不需要 Visual Studio 或重新编译。
当前机器的小狼毫 0.17.4 / librime 1.13.1 已内置 Lua 5.4.7。

## 换电脑：下载、解压、双击安装

**无需复制原来约 10 GB 的开发目录，也不需要安装 Git、Python、Visual Studio 或手动配置 Node。**
到 [GitHub Releases](https://github.com/johntime2005/rime-jev/releases) 下载
`rime-jev-v0.1.0-windows.2-windows-standard.zip`。仓库目前为私有，需登录有访问权限的 GitHub 账户；
不要选择 GitHub 自动生成的 `Source code` 包作为普通安装包。

1. 新电脑先安装 [Windows 小狼毫 / Rime](https://rime.im/)，确认原输入法能正常打字。
2. 将 ZIP **完整解压**，双击 `Install.cmd`，不要在压缩包预览窗口内运行，也不要以另一个管理员账户运行。
3. 等待依赖下载与方案部署。安装器自动识别本机 Rime 目录；缺少 Node / 雾凇时按固定版本下载并校验 SHA-256。
4. 按配置向导填写服务端点、模型和密钥。自动请求与上文发送默认关闭。
5. 切换小狼毫，按 F4 选择“雾凇拼音 - Jev”；需要云端重排时再按 F8 开启。

安装到 `%LOCALAPPDATA%\RimeJev\app\<内容哈希>`，开始菜单新增 **Rime Jev** 下的配置、状态、卸载、原生回退入口。
安装成功后可以删除下载 ZIP 和解压目录；启动项不再依赖下载位置。标准安装不需要 UAC，不替换小狼毫 DLL / Server。
重复运行新版 `Install.cmd` 会校验并更新，保留首次卸载备份；发现你改过受管理文件时停止，不强行覆盖。

### 安装包选择与限制

| 包 | 适用范围 | 双击入口 |
| --- | --- | --- |
| `windows-standard.zip` | 默认选择；Windows 10/11 x64，兼容带 Lua 的小狼毫，不替换系统组件 | `Install.cmd` |
| `windows-native-x64.zip` | **实验版**；仅精确匹配的小狼毫 0.17.4 / librime 1.13.1 x64，增加停笔候选刷新 | `Install-Native.cmd` |

标准版会异步请求，但原版小狼毫不能在停笔后主动刷新候选窗；按后续键或 Ctrl+Alt+F8 才能读取新结果。
原生版需要输入 `INSTALL NATIVE` 确认并授权 UAC，先备份再替换匹配组件；不替换 `rime.dll`，不强制关闭你的应用。
UAC 需由当前 Windows 账户授权；使用另一管理员账户的凭证不在支持范围内。
原生功能仅覆盖 x64 TSF，不覆盖 x86 / IMM；安装后重新打开应用。它仍是实验版，不能把哈希校验或自动测试当成完整界面验收。
已安装原生版时，先运行 `Rollback-Native.cmd`，再更新、重装或卸载，避免丢失原始回退链。
ARM64 标准版有依赖下载路径，但尚未在 ARM64 机器实测；32 位 Windows 不支持。

这是**按需联网安装包，不是离线全量备份**：首次可能下载 Node 和雾凇，依赖地址需能访问
`nodejs.org` / `codeload.github.com`，编译词典还会占用本机空间。已有合适依赖时直接复用；不复制旧机器的编译缓存。
安装器不覆盖现有皮肤、个人 custom、用户词库；雾凇文件若有冲突会中止，需先自行合并或安装雾凇。

密钥受 Windows 当前账户 DPAPI 保护，**不能跨机器直接搬运**，新电脑需重新填写。
安装包也不携带个人服务地址、用户词频、短语、鼻音配置、浏览器授权名单或输入记录。
如需自己的词频/短语，请使用 Rime 自带的用户资料同步另行迁移；不要把整个 `%LOCALAPPDATA%\RimeJev` 上传 GitHub。

故障处理：双击 `Status.cmd` 或开始菜单中的状态入口查看后台；使用 `Uninstall.cmd` 恢复安装前受管理文件。
备份、加密密钥以及可能被其他方案使用的雾凇依赖会保留，卸载不自动清空个人目录。
下载损坏会在哈希校验处停止；从可信 Release 重新下载即可，`.sha256` 用于检测损坏，不是发布者数字签名。

高级只读检查（不下载、不部署、不更改输入法）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Windows.ps1 -Check
```

非标准路径可以添加 `-RimeUserDir "D:\RimeData" -WeaselRoot "D:\Apps\Weasel"`。
实际部署必须使用小狼毫注册的用户目录；这些参数不迁移或修改小狼毫注册表。
自动化可使用 `-NoConfigure`；测试隔离还可使用 `-NoDeploy -NoStart -NoAutostart -NoShortcuts`。

## 开始使用

安装完成后双击 **`Configure.cmd`**。向导只需填写服务地址、模型和密钥；只填域名或 `/v1` 时补全
`/v1/systemone`，完整 API 路径原样保留，回车保留现有值。自动请求与上文发送默认关闭；启用自动请求后按 F8 可随时切换。
每日上限默认 200 次，失败只保留本地候选。

安装请优先双击 `Install.cmd`，或运行统一入口：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Install-Windows.ps1
```

密钥不要发给聊天助手。在你自己的 PowerShell 中运行：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Set-Key.ps1
```

该脚本先解释云调用范围，确认后才接受隐藏输入的 API Key。
密钥通过当前 Windows 账户的 **DPAPI** 加密保存，不放在 YAML、仓库、启动参数或日志里。
申请密钥：[TypeSafe 控制台](https://console.typesafe.ai/)。
默认使用官方 TypeSafe 接口，也支持自定义中转及本地 OpenJev 的 **System One 兼容接口**。
密钥必须属于配置的服务，不能把第三方 Key 发到官方域名。

配置自定义服务（可填域名，也可填完整请求端点）：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Set-Provider.ps1 -Endpoint "https://your-relay.example/v1/systemone" -Model "openjev"
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Set-Key.ps1
```

本地无鉴权 OpenJev 可以用 `-Auth none`，仅允许 localhost/127.0.0.1/::1。
兼容 Choice 请求的 `/v1/decisions` 也可直接填写。例如 Emrank 使用
`https://emrank.tech/v1/decisions` 和模型名 `typesafe/jev-latest`，不再追加 `/v1/systemone`。
更换服务会清除旧密钥，防止把官方 Key 或其他服务的 Key 误发到新地址。
只有 `/v1/chat/completions` 的中转目前未实现适配，不能仅改 URL 就使用。
服务端若已经混合路由 Jev/OpenJev，本客户端可调用其统一 System One 入口；
客户端暂不做双服务自动切换、并行投票或跨服务传递凭证。
`-WithoutNoneOption` 可去掉“以上皆非”选项，服务须仍返回所有候选的有效概率及 model/usage。

1. 双击 `Configure.cmd` 配置服务；配置后会询问是否开启自动请求，上文发送仍需单独开启。
2. 切换到“小狼毫”，按 F4 选择“雾凇拼音 - Jev”。
3. F8 一键切换自动请求开关；设置保存在本机，重启仍保留。
4. 正常输入会触发后台请求；默认 100ms 防抖，旧输入取消后不发送。
5. **标准小狼毫不能在停笔后主动刷新候选窗**；本机试装的实验版支持 x64 TSF 原生刷新，完整界面验收仍待完成。Ctrl+Alt+F8 是诊断刷新；Ctrl+F8 清空上文。

### 未完成的关键环节

已新增实验性原生前端补丁，见 `native/README.md`：通过 TSF 编辑会话和专用 IPC 刷新，
而不是模拟快捷键。当前补丁已通过 GitHub Actions 构建，已取回匹配的 x64 产物；
配套 Lua 和二进制可通过 `scripts/Package-Native.py` 打包并校验哈希。
真实 TSF 候选窗与焦点切换仍待完整验证。本机已按用户要求试装，回退记录见
`native/REPLACEMENT.md`；这不代表通过发布验收。以下限制适用于未安装原生补丁的标准版本。

现有 Weasel 0.17.4 的 Lua 没有定时器；候选窗也没有可供独立插件安全调用的异步刷新接口。
本项目不使用 SendInput 注入按键、不从后台线程调用 Rime Context，也不在空格/数字选词时偷偷读取结果换词。
因此标准版本目前实现的是自动请求和开关，**不是完整全自动输入法**。停笔后的结果可能仍停留在文件中，候选提示也不会立即更新。
要实现用户不再按刷新键，需要给 Weasel 增加受会话、焦点和手动选择校验的专用刷新通道，或改用提供该能力的前端。
不能只编译 librime-lua 就得到这条通道。不要把此版自动请求视为最终交付。

## 状态提示

候选旁的英文短提示用于避免字体兼容问题：

| 提示 | 含义 |
| --- | --- |
| `Jev: off` | 自动请求关闭 |
| `pending` | 请求等待中；提示可能在结果到达后仍未刷新 |
| `cancelled` | 请求已因焦点或输入变化取消，保留现有候选 |
| `paused` | 手动选择或导航后暂停重排，保留选择 |
| `TIMEOUT` | 接口超时，保留原序，不自动重试 |
| `expired` | 请求已过期或后台实例不可用 |
| `ranked #N->1` | 原第 N 候选已置顶 |
| `same first` | 服务仍选原首选，没有替换 |
| `keep original` | 概率不够明确，保留原序 |
| `configure key` | 服务已启动，但未配置密钥 |
| `start service` | 服务未运行或心跳过期 |
| `DAILY_BUDGET_EXCEEDED` | 达到当天请求次数上限 |

查看后台状态：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Status.ps1
```

默认只显示服务、开关、请求次数和最近结果；底层连接诊断使用 `scripts/Status.ps1 -Detailed`。
后台启动成功不代表接口已调用。要发送一条固定合成样例、测试后台 IPC 到服务的实际链路：

```powershell
node scripts/Measure-Rerank.mjs --live --single
```

这会产生一次真实请求并计入当日用量；不读取实际打字内容，也不验证屏幕候选窗。

## 行为与限制

- **标准版不支持停笔自动刷新**；实验版仅支持 x64 TSF，仍待完整界面验收。x86/IMM 不支持自动刷新。F8 用于开关，Ctrl+Alt+F8 用于诊断读取。
- 只重排首屏，最多 10 个候选，且必须尚未移动选择。当前配置是 7 个；后续候选完整保留。
- 只提升一个胜出词，其他候选相对顺序不变。最高概率至少 0.60，领先第二名/“以上皆非”至少 0.15，否则不调整。
- 输入、光标、候选、会话、请求序号和服务实例都参与有效性检查；12 秒后结果过期。
- API 超时 4 秒，在后台等待；不在按键线程运行网络请求、子进程或等待循环。同步本地文件 I/O 仍可能受磁盘/杀毒软件影响，不能承诺绝对零延迟。
- 网络及响应解析在后台独立 worker 执行；主线程截止定时器不依赖传输层响应取消。收到请求结束确认，或硬终止 worker 并等待退出后，才处理下一笔；已发出的请求仍可能被服务商处理或计费。
- 不设本地一秒请求间隔限制；保留 100ms 防抖和单请求并发。默认每个 UTC 日最多 200 次尝试；计数落盘，重启不会重置。当日上限不是美元预算，服务商仍可能独立限流。
- 不重试，不自动切换服务商。断网、密钥缺失、服务停止、无效响应时保留本地原候选。
- 默认使用 `jev-latest`，可配置服务端模型名；真实准确率和公网延迟需要接通服务后另行实测。

## 隐私

**官方 Jev 通过服务调用；OpenJev 可由你自己的本地/中转服务提供。** 开启自动请求后，会将当前拼音、当前页候选，以及可选的最多 80 个上文字符发送到
你配置的服务端点（默认 `https://api.typesafe.ai/v1/systemone`）。关闭时不自动发送；开启时普通打字会触发防抖请求。上文默认关闭。

上文只来自明确授权的 TSF 应用正文，或单独开启的 Pebrel/Codex 输入区适配。
**不再使用 Rime 提交历史。** TSF 应用名单默认为空，不会自动启用所有编辑器或终端。
名单通过 `rime_ice_jev.custom.yaml` 的 `patch/jev_windows/context_apps` 配置，部署后生效；
建议只加入验证过实际控件的应用。也支持单独的 `"*"`，显式授权所有能提供 TSF 正文的具名应用：

```yaml
patch:
  jev_windows/context_apps:
    - "*"
```

只支持全匹配 `"*"`，不支持 `chrome*` 等部分通配；YAML 中必须给星号加引号。
此设置扩大正文读取和发送范围，不限于浏览器地址栏；未知应用名仍不授权。
自动请求、上文开关、Ctrl+F8 单次抑制和已识别敏感输入拦截仍生效。
授权不代表应用支持正文读取。未取得 TSF 正文时使用无上文排序；Pebrel 输入区
无法验证时保留原候选。已识别的密码/隐私输入范围不提交，不能保证识别所有敏感控件。
本适配器不读取剪贴板、不截屏、不读取整个文档，也无法可靠识别所有密码框。
Ctrl+F8 抑制当前组合的上文读取和发送，提交或取消后解除；F8 关闭自动请求。

**输入密码、验证码、隐私或保密内容时，请切换普通雾凇/系统输入法，确保 Jev 关闭，不要依赖应用自动识别。**
本项目没有声称能自动识别或脱敏全部敏感内容。

IPC 暂存到当前账户私有目录，请求和结果约 15 秒清理；进程运行内存可包含上文。
短时排序缓存仅保存会话/快照哈希及数字结果；哈希不是对低熵输入的加密保护，
同账户进程仍可能访问内存。取消回执也在私有 IPC 中短暂存在，状态输出不保留令牌。
不记录原始输入、API 响应或密钥；状态日志只包含错误代码/调用计数。
DPAPI 保护的是静态密钥；同一登录账户下的恶意进程仍有能力读取本账户数据。

## Codex 上文

仅支持 Windows 上 **Pebrel 本地终端中的 Codex 文本输入区**，不是 Codex 的模型上下文、
聊天历史或工具连接修复。无需改 Codex 配置或更换小狼毫 DLL。

- 在 `Configure.cmd` 中先开启上文，再开启 Pebrel/Codex 输入区适配。后台配置保存
  `contextProvider: {"type":"pebrel-codex","cli":"Pebrel 的绝对路径"}`；不保存 Runtime 令牌。
- Lua 只为 `client_app=pebrel.exe` 的请求标记读取目标；上文关闭时不读取输入区。
  后台要求焦点窗口、活动标签和分屏一致、存在真实 Codex 进程，并识别带底色的输入区。
- 只发送光标前最多 80 个 Unicode 字符，排除光标后的文字、占位提示、附件和聊天输出。
  多行按可见行保留换行；终端未提供 Codex 的硬/软换行语义，不能保证还原原始换行方式。
  仅覆盖当前可见输入区；很长的滚动输入和其他主题/版本布局可能不支持，不会读取滚动历史补齐。
- Pebrel 当前接口返回**可见终端文本格**，最多 40000 个单元格及 128 KiB 字形；完整格子
  短暂存在后台内存中用于定位输入区，不写入文件或状态日志。只有选出的输入区前缀发给
  Jev，终端其他输出不发送；不是截图/OCR，也不读取滚动历史。
- 返回排序后再次读取并核对输入区、光标、窗口/分屏和会话；变化则弃用结果。
  缓存也必须通过相同核对。接口超时、失焦、SSH、未知布局或附件占位都保留原候选，
  `contextError` 说明原因，不使用不可靠的旧历史。Ctrl+F8 会抑制当前组合的外部上文读取。
- 本机读取一次完整文本格约 0.9-1.0 秒；取文加复核可能额外增加约 2 秒。
  **这是上下文正确性修复，不是低延迟方案。** 不会阻塞输入法按键线程，但快打仍可能在
  排序完成前取消。此开销要由 Pebrel 提供有界输入区接口才能进一步改善。

在 Pebrel 的 Codex 输入区保持焦点时，可从代理工具运行只读诊断：

```powershell
node scripts/Check-Context.mjs
```

它只输出字符数、耗时和错误枚举，不打印正文、不提交输入、不调用云端服务。
实际请求用 `scripts/Status.ps1` 查看 `contextState.source=pebrel_codex` 和 `contextChars`；
`tsf` 表示原生 TSF 正文；`context_unavailable` 表示不能安全确认输入区；
`contextReadMs/contextVerifyMs` 单独记录读取及复核耗时。失效前已发出的请求可能仍由服务商计费。

## 文件与回退

- `%APPDATA%\Rime\rime_ice_jev.schema.yaml`：独立方案；共享 `rime_ice` 词库和用户词频。
- `%APPDATA%\Rime\lua\jev_windows.lua`：客户端。
- `%APPDATA%\Rime\default.custom.yaml`：仅追加一个可选方案；安装前原文件已备份。
- `%LOCALAPPDATA%\RimeJev`：加密密钥、配置、状态、IPC 和备份，ACL 仅当前账户及 SYSTEM。
- `config.json` 中的 `callLimit` 可调整（1–10000），修改后重启后台服务。
- `Install.cmd` 默认创建当前用户的 `Rime Jev Bridge.lnk` 登录启动项，后台隐藏运行；可用 `-NoAutostart` 跳过。
- 不改变 `weasel.custom.yaml` 皮肤、不覆盖旧的 `Rime\user` / `Rime\shared` 尝试、不删除用户词库。
- 新安装的启动项引用托管应用目录，下载目录可删除；旧版手动安装仍引用原项目目录，不要直接移动它。

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
node --test tests/*.test.mjs
python -m unittest discover -s tests -p "test_*.py"
python tests/native_rime.py
python tests/native_rime.py --typing-profile
python tests/native_rime.py --nasal-profile
```

原生集成测试复制编译词典到 `runtime/native-*`，直接调用当前 `rime.dll`，不接触真实用户词库。
现在测试结束会自动清理该次编译词典，仅保留小型诊断；确需调试时才使用 `--keep-build`。
原生集成测试 provider 是明确的 **mock**，验证自动请求、开关、诊断/属性刷新置顶、翻页、取消和停服回退；
Node 测试另用本地 HTTP 服务验证超时、取消及错误分类，不访问配置的真实服务。
生产入口不提供 mock 模式。测试通过**不等于**真实 Jev API 已成功调用。

## 本地打字适配

本机雾凇已有首字母简拼、全拼/简拼混输、常见错序纠正、长词补全、中英混输、
自定义短语入口。它们直接生成本地候选，不用等云端。Jev 只能重排首屏已有词，
不能凭空添加词典缺失的专业词。

- **模糊音**改拼写规则，不用给词典重复加错音词条。生成器支持 z/zh、c/ch、s/sh、
  n/l、f/h、r/l、an/ang、en/eng、in/ing、ian/iang、uan/uang；仅选自己需要的组。
- **简拼/混输**不用重新录词。隔离回归已验证 `zg`、`zhongg` 能出现“中国”。
- **自定义短语**在 Rime 用户目录的 `custom_phrase.txt` 中用 UTF-8 与 Tab 分列：
  `文字<Tab>编码<Tab>权重`。适合固定句子、术语快捷码，不适合盲目导入海量条目。
  短语仍是候选，不自动上屏；开启 Jev 时目前仍可能参与云端重排。
- **专业词库**应添加独立扩展词典，保留用户词频与上游词库，先筛选去重、标注正确读音；
  不要直接覆盖雾凇主词典。词越多不等于首选越准确。
- **本地语言模型/双拼**是后续可选路线，需要另行测兼容性、资源开销或学习成本；本次未安装。

例如仅生成 z/zh 与 in/ing 适配（不安装、不联网、不覆盖已有文件）：

```powershell
python scripts/Typing-Profile.py --fuzzy z-zh in-ing --output runtime/rime_ice_jev.custom.yaml
```

确认需要的组后，将生成的 patch 合并到 `%APPDATA%\Rime\rime_ice_jev.custom.yaml`，
再部署；已有该文件时不能直接覆盖。新的方案已显式加载这个文件。
同时修改拼写规则和独立 prism 很重要，否则会与普通雾凇的索引冲突。
只生成不带 `--fuzzy` 的配置不会启用模糊音。

仅前后鼻音可使用预设（6 条规则，不重复叠加 ian/uan 规则）：

```powershell
python scripts/Typing-Profile.py --nasal --output runtime/nasal.custom.yaml
```

`--nasal` 与 `--fuzzy` 不能同时使用。本机已经将此预设部署到个人 custom 文件，
之前没有该文件；部署回执和旧编译索引保存在
`%LOCALAPPDATA%\RimeJev\backups\nasal-profile-20261008-104753`。
custom 文件由用户管理，更新/卸载不会覆盖或删除；回退本次鼻音配置只需移走该文件
并重新部署，不动词库或用户词频。如果文件有后续编辑，应仅移除对应鼻音规则。

`python tests/native_rime.py --typing-profile` 仅在隔离目录验证模糊音、简拼、
混输与固定短语，不改真实用户词库，也不把该耗时当作屏幕显示延迟。
模糊音同时引入更多同音候选，全开往往增加翻页；建议先本地少量适配，再考虑云端纠偏。

配置依据：[Rime 拼写运算](https://github.com/rime/home/wiki/SpellingAlgebra)、
[补丁加载规则](https://github.com/rime/home/wiki/Configuration)。

上游资料：
[小狼毫](https://github.com/rime/weasel) ·
[雾凇拼音](https://github.com/iDvel/rime-ice) ·
[librime-lua](https://github.com/hchunhui/librime-lua) ·
[TypeSafe Choice API](https://docs.typesafe.ai/primitives/choice)

## 持久化和 GitHub

代码在本目录的 Git 仓库；运行时目录、密钥、个人配置、词库和二进制不入库。
普通用户下载 Release 即可；不需要复制 `runtime`、`upstream` 或 `.git`。
`distribution-files.json` 采用文件白名单，打包工具拒绝私人配置、密钥、日志、用户词库和过大源码；
每个 ZIP 附逐文件清单及整体 SHA-256。原生二进制只在 Release 中提供，并附许可证、补丁和来源记录。

2026-10-10 的历史清理审计记录了 94 份重复测试编译目录，共回收 9.60 GiB；
本轮继续回收隔离安装试验和一次性浏览器配置等缓存共 228.54 MiB，打包前工作区约 113.47 MiB。
保留小型验证回执、源码 worktree、原生回退包，
不触碰 `%APPDATA%\Rime`、`%LOCALAPPDATA%\RimeJev` 或已安装小狼毫。
后续安全清理先预览，再按需执行；脚本检查绝对路径、链接、文件年龄和在用进程：

```powershell
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Clean-Runtime.ps1
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Clean-Runtime.ps1 -Apply -IncludeDisposableCaches -IncludeDownloads
```

维护者发布（需要 Python 3.13、Git、已登录的 GitHub CLI；先测试、审查并提交源码）：

```powershell
node --test tests/*.test.mjs
python -X utf8 -m unittest discover -s tests -p "test_*.py" -v
git tag -a v0.1.0-windows.2 -m "Windows migration preview"
python scripts/Package-Release.py --version v0.1.0-windows.2
powershell -NoProfile -ExecutionPolicy Bypass -File .\scripts\Publish-GitHub.ps1 -Tag v0.1.0-windows.2 -Prerelease
```

后续版本使用新标签，不覆盖已发布资产。可选原生 ZIP 需先用 `scripts/Package-Native.py` 验证并准备匹配包，
再给 `Package-Release.py` 传入 `--native-bundle <目录>`。详见 `native/README.md`。
发布脚本先检查干净工作区、标签、源码提交和包哈希，推送已有分支/标签后上传 ZIP 与校验文件；不自动提交、强推或改仓库可见性。
仓库不存在时才创建私有仓库，已有 origin 不匹配时拒绝继续。凭证使用本机 GitHub CLI 登录态，不写进脚本或仓库。
`.github/workflows/windows-installer.yml` 在 Windows runner 上执行隔离回归并生成标准包，不部署真实输入法。

## 维护者记录

开发过程记录，供维护者排查历史实验使用，不是新安装步骤或当前功能承诺。

### 连接复用与延迟（2026-10-10）

后台现通过 TLS ALPN 协商 HTTP/2；服务不支持时在同一端点使用 HTTP/1.1，
不会重发 POST。HTTP/2 取消只关闭当前请求流，保留健康的 TLS 连接，避免连续
打字时反复建连。空闲连接最多保留 60 秒；服务主动关闭或硬超时仍需重新建连。
启动不提前联网，不发送预热请求；单并发、100ms 防抖、4 秒截止、每日上限、
原服务/模型、置信度门槛及上文权限不变。本次仅更新后台，没有替换 DLL 或 Lua。

三笔固定合成样本：修改前结果就绪为 1620/579/604ms，修改后为 1344/545/550ms。
后两笔确认 `protocol=h2`、`reusedConnection=true`、`connectMs=0`，均非缓存命中。
另测 provider 阶段取消后空闲 10 秒，下一笔仍复用连接，598ms 就绪且未重建 worker。
这不是候选窗实测或稳定性能保证：首次建连仍超过 1 秒，复用后仍有约 435ms 的
网络/服务响应等待，另有前端轮询及 TSF 调度；不能称为已经消除一秒延迟。
状态新增协议、连接复用和建连时长；`connectMs` 包含在 `headersMs` 中，不能相加。
测试与安装回执见 `native/VALIDATION.md`、`native/REPLACEMENT.md`。

### 合并后的上文与刷新协议（2026-10-09）

本机已于 17:07 完成新版 DLL/Server/Lua/方案替换，旧试验版的应用限制和 mock IPC
指向已移除。安装助手的跨 PowerShell UTF-8/模块路径问题已修复（`9d7d526`）。
17:40 又部署 Lua 修复（`bbadb1a`）：上文取得后若仍是相同的 pending 菜单，不让前端
重复写入预编辑，避免触发文档变化、取消刚创建的请求。服务配置、皮肤和鼻音设置未改动。
备份及实际安装回执见 `native/REPLACEMENT.md`；安装成功不等于排序效果验收通过。

**Zen 地址／搜索栏上文已在本机显式启用并完成定点验证。** 用户确认后，18:26 在个人
custom 中仅加入 `zen.exe` 并部署，通用方案的默认名单仍为空。19:10/19:11 的独立临时
浏览器配置实测取得 7 字 TSF 上文，“经理”显示首位，空格提交得到完整预期句子；
另测“投入大量……”能把“精力”置顶。删除、移动光标及 Ctrl+F8 的取文边界通过，
一个标准密码框未产生请求。未修改用户原有标签页、服务、门槛、Lua、DLL、皮肤或鼻音。
完整回执及自动化早期失败记录见 `native/ZEN.md`；这不是广泛准确率、长期稳定性或所有
敏感控件的认证。名单按应用授权，不只作用于地址栏。原截图发生在名单为空时，单看
`same first` / `keep original` 仍不能判断选词是否正确。

合入可选的 TSF 光标前正文读取，以及异步编辑会话被取消后不再永久卡住轮询的修复。
`jev_windows/context_apps` 默认空列表；只有显式加入的应用、自动请求和上文开关均开启时，
才允许读取正文。读取从组合输入的起点之前开始，保留真实空白，最多发送 80 个 Unicode
标量值；不读取剪贴板，不以提交历史冒充正文。应用不支持时使用无上文排序，已识别的
敏感输入不提交。TSF 正文结果绑定文档戳，只能在原生编辑会话复核后应用。
Ctrl+F8 抑制本次组合的上文，直到提交或取消；中途按修饰键不会重新授权。

Pebrel/Codex 的显式 Runtime 适配继续保留，与 TSF 应用名单分开配置；读取不可靠时
保留原候选，不回退到提交历史。完整边界和测试说明见 `native/CONTEXT.md`。
这是源代码行为说明，安装状态与回退以 `native/REPLACEMENT.md` 的最新记录为准。

### 先前实验记录（2026-10-08，非当前安装状态）

续写请求复查：现场出现应选“叫”却保留“交”的情况。固定上文对照中，旧请求
即使带完整上文也两次优先选择“教”；改为比较“上文＋候选”的续写片段后选择“叫”。
现已在 `provider.mjs` 中采用续写表达并保留“以上皆非”、完整概率校验和原门槛，
状态标记为 `promptVersion=ime-continuation-with-none-v1`。没有更换服务或模型。
独立“叫／教／交”三笔合成对照符合预期，但不是广泛准确率或真实窗口验收。
上文读取现新增 **Pebrel/Codex 输入区适配**：经明确开启后，后台通过 Pebrel Runtime
读取当前 Codex 输入区的光标前文字，而不是拼接提交历史。删除、移光标、中英混输
以后重新读取；该次更新没有改变原生 DLL。当时其他应用仍使用提交历史；
2026-10-09 的合并已删除这条旧路径，改为显式 TSF 正文或无上文排序。
具体限制和隐私边界见下文“Codex 上文”。

40ms 防抖试验已撤回至 **100ms**：现场观察到大量请求进入 provider 后被取消，
频繁终止 worker 并没有带来有用的排序体验。此前 40ms 的少量延迟样本不能证明
实际打字更快。未取消单并发、截止保护或每日上限；已发出的请求仍可能计费。

新增本地输入适配入口：Jev 现在显式加载 `rime_ice_jev.custom.yaml`，
并使用独立 `rime_ice_jev.prism.bin`，继续共享雾凇词典与 `rime_ice` 用户词频。
不会自动开启所有模糊音，也不覆盖原版雾凇的拼写索引。详见下文“本地打字适配”。
本机已按用户明确的前后鼻音需求启用 `an/ang`、`en/eng`、`in/ing`，
其中 `an/ang` 的后缀规则也覆盖 `ian/iang`、`uan/uang`。其他模糊音未开启。
个人配置位于 Rime 用户目录的 `rime_ice_jev.custom.yaml`，不写入通用方案默认值。

延迟优化：请求线程提前做本地初始化，不提前联网；完全相同的请求可复用
15 秒内的数字排序结果（内存最多 32 项，不写磁盘）。缓存限定同会话、同上下文、
同拼音/预编辑/候选及同清理代次，焦点变化、清空上文、切换开关后不可跨代复用。
命中缓存不等待网络防抖、不调用接口、不消耗新调用额度；仍走完整的 Lua 有效性和
手动选择校验。`source=cache` 明确区分复用结果，不能把它当作 API 提速。
`config.json` 的 `cacheTtlMs: 0` 可禁用；修改后重启后台。
`transport.headersMs/bodyMs/totalMs` 是 worker 内的网络/读取时长；其中 headersMs
也可能包含 DNS、TLS、连接及服务端等待，并非纯推理时间。
`discoveryMs` 是文件发布到后台读入的耗时，可含排队；`localMs` 也包含这部分。
缓存命中仍可能等待前一笔正在执行的请求，不能承诺每次命中都在几十毫秒完成。

取消诊断新增 `lastCancellation`（后台取消阶段）和 `lastAdapterCancellation`
（适配器取消原因），通过 requestId 对照；两者计数不相等不代表丢请求，适配器可能
在后台发现请求前就取消。`contextState` 记录启用状态及最后清空原因，不包含正文。

排序效果复查：用户提供了“经理”仍在第 4 位、提示 `keep original` 的实际截图。
这不是成功置顶；修复卡请求不代表排序效果已修好。现已加入不含文本的
`contextChars` 和 `ranking` 诊断，区分没有上文、服务弃选、概率不足和领先幅度不足。
三笔合成对照中，带任命上文选择第 4 位、无上文保留第 1 位、带投入上文选择第 5 位；
这只能证明这些请求的返回结果，不能推断截图那笔必然缺少上文或宣称界面问题已修复。
`node scripts/Measure-Rerank.mjs --live --context-check` 可运行这三笔真实服务对照，
会计入调用额度，不读取实际输入框，也不测试候选窗口。

最新补充：现场曾记录到队列已空，但 provider 阶段仍持续超过 210 秒；
因此不能只归因于旧 `pending` 标签。后台现将请求放入独立 worker，由主线程设置
4 秒截止定时器。超时或取消未获确认时终止 worker，并等待退出再接受下一笔；
正常完成或 100ms 内完成取消时复用 worker。不自动重试，不改变服务、密钥、
置信度或已落盘的调用额度。
本地回归覆盖忽略取消、正文不结束、worker 死循环/崩溃和停服恢复；这不是对真实服务
底层卡住原因的定论，也不保证操作系统阻塞时严格在 4 秒内完成终止。
`providerWorker` 提供本次后台启动后的重建、硬超时、取消和异常退出计数；
`providerMs` 现包含可能发生的 worker 启动/退出开销，不能等同于纯网络耗时。

2026-10-08 补充：已复现“请求取消后仍显示 pending”，改为仅更新候选注释，
不重建候选顺序或重置手动选择。取消显示 `cancelled`，手动选择后显示 `paused`。
另修复 Windows 短暂占用心跳文件导致后台退出：只对本地原子替换做有限次重试，
不重试 API。`Status.ps1` 的 `requestState` 表示心跳采样时的当前阶段；
为空表示后台当时空闲，不能将旧 `pending` 标签解读为 API 仍在请求。
这些路径已通过隔离测试，真实 TSF 窗口是否还有其他阻塞路径仍需复测。
补充回归覆盖请求中途取消、响应正文卡住后超时、停服时清除 pending。
响应正文读取超时现在正确显示 `TIMEOUT`，不再误报无效响应；没有增加 API 重试。

本机已按用户要求试装原生刷新补丁，未重启的旧应用仍可能加载旧 DLL。
下文“停笔不主动刷新”的限制针对标准小狼毫；实验版支持 x64 TSF 刷新，
但真实候选窗的完整验收仍未完成，不能把文件哈希或单元测试当作界面验收。

本次真实中转测试确实返回 `2,1,3`，不是只返回原序。更新前的三笔结果就绪时间为
570/712/854ms；更新后重启首笔为 1455ms，后两笔为 617/573ms，
其中接口耗时分别为 1327/476/447ms。这些是少量样本，不是性能保证或提速结论。
**100ms 是防抖，不是总延迟**；原生候选窗还有 100ms 轮询及 TSF 编辑会话调度。

后台轮询/取消检查从 80ms 改为 20ms，防抖从请求文件发布时间计时，
替换掉的请求不再占满整个旧防抖窗口。保留单请求并发、置信度门槛和每天调用上限。
`scripts/Status.ps1` 现在区分以下诊断（不记录输入文本或密钥）：

- `same_first` / 候选提示 `same first`：服务仍选原首选，不再误标为换词。
- `promoted` / 提示 `ranked #2->1` 等：服务选择了非首位候选。
- `providerMs`：provider 阶段耗时（含可能的 worker 启动/退出）；`readyMs`：请求文件发布至结果就绪耗时。
- `applyChannel=native`、`applyMs`：Lua 已通过原生刷新重新生成候选及结果就绪后的等待时间。
- `not_observed`：尚无应用回执；可能已取消、仍等待或前端不支持，不能单凭此值判定 UI 故障。

回执证明的是候选生成，不是屏幕像素已更新。可用非敏感文本复现后查看状态，
判断问题落在服务返回、结果应用还是实际显示。`node scripts/Measure-Rerank.mjs --live`
会向当前配置的服务发送三条固定合成样本并计入调用上限；它不测试候选窗。

Jev 协议客户端直接复用 MIT 项目
[Ideny42/jev-keyboard](https://github.com/Ideny42/jev-keyboard)，固定来源和许可证见
`vendor/jev-keyboard/UPSTREAM.md`。Windows Lua、文件 IPC、安装和密钥管理为本项目适配。
