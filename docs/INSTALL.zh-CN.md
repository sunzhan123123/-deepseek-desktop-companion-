# 安装与使用

[返回首页](../README.md) · [排错](TROUBLESHOOTING.zh-CN.md)

## 1. 选择并解压

Windows 首次使用推荐发布者已确认素材分发授权的完整包 `deepseek-desktop-companion-complete-v1.0.0.zip`。当前示例角色媒体的公开分发授权仍待确认，详见 [素材说明](../ASSET-NOTICE.md)；这份教程不表示素材包已公开可下载。源码用户也可按 [自定义教程](CUSTOMIZE.zh-CN.md) 制作自己的素材。在文件管理器中将可用 ZIP 全部解压到一个固定目录，例如 `C:\Apps\DeepSeekCompanion`，不要在压缩包预览里启动。

源码方式需要同时下载以下两个包，并将两者内容合并解压到同一目录：

- `deepseek-desktop-companion-source-v1.0.0.zip`
- `deepseek-desktop-companion-assets-v1.0.0.zip`

ZIP 内路径直接从程序根目录开始。合并后应当是下面的关系，而不是 `assets/room-animation-v2` 或套在另一个 ZIP 文件夹里：

```text
DeepSeekCompanion/
  README.md
  deepseek-companion-server-v1.mjs
  room-companion-v1.html
  start-deepseek-wallpaper-v3.cmd
  start-deepseek-chat-v4.cmd
  check-environment.cmd
  assets/
    media-manifest.json
  room-animation-v2/
    pose-A.png ... pose-F.png
    AB.mp4 BA.mp4 BC.mp4 CB.mp4 CD.mp4 DC.mp4
    DE.mp4 ED.mp4 EF.mp4 FE.mp4
    loop-B.mp4 loop-E.mp4 loop-F.mp4
  companion-typing-v1/
    B.mp4
    E.mp4
```

完整包另有 `deepseek-launcher-v4.exe`。源码包没有编译 EXE，可直接使用 CMD；如需 EXE，在项目目录运行：

```powershell
powershell -NoProfile -File .\build-launcher.ps1
```

## 2. 准备依赖

| 依赖 | 本项目建议 |
| --- | --- |
| Windows | 当前只支持 Windows 启动与壁纸工作流 |
| Node.js | 建议24 LTS；项目检查要求22.12.0或更新版本 |
| Microsoft Edge | 用于独立聊天应用窗口 |
| Microsoft Edge WebView2 Runtime | 用于 Lively 的网页壁纸播放 |
| Lively Wallpaper | 已验证2.2.1.0，优先官方每用户安装版 |
| DeepSeek Harness | 已验证 `@deepseek-ai/dsh@0.2.1-rc.2` |

从 [Node.js 官网](https://nodejs.org/) 安装 Node.js；从 [Microsoft Edge 官网](https://www.microsoft.com/edge) 和 [WebView2 官网](https://developer.microsoft.com/microsoft-edge/webview2/) 安装所需运行环境。Lively 使用 [官方2.2.1.0发布页](https://github.com/lively-community/lively/releases/tag/v2.2.1.0) 的安装包。该版本是本项目的验证基线，不表示它始终是最新版本。

安装后先独立打开一次 Lively，完成首次设置和 WebView2 初始化。启动器会把本项目挂到主屏；暂不以多屏重复挂载作为推荐用法。在本助手数据目录尚无一次性初始化标记、且 Lively 已停止时，首次启动会先将已有 `Settings.json` 按原字节备份为旁边的 `Settings.json.deepseek-bootstrap-<GUID>.bak`，再把已有 `WebBrowser` 设置为1（WebView2）。已有开机自启、暂停规则、音量、壁纸目录及其他设置保留；缺失的初始化键才补默认值。此后有标记的冷启动不会重复改写设置。只读环境检查不会执行这一步。

## 3. 配置自己的官方 Harness 凭据

此步骤需要你自己的服务账号及可用凭据。本项目不附凭据、模型权重、免费额度或永久免费服务。

在 PowerShell 中安装固定版本：

```powershell
npm install -g @deepseek-ai/dsh@0.2.1-rc.2
npx @deepseek-ai/dsh@0.2.1-rc.2 web
```

`web` 是官方文档提供的入口，通常打开 `http://127.0.0.1:3080`。按照官方界面完成凭据配置：当前 [官方 Web UI 教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.md) 说明在 **Settings → Models** 输入 DeepSeek API key 并保存；若固定版本界面提供官方登录流程，按该版本界面操作。不要把密码或 API key 填到本项目聊天框、示例 JSON 或源码里。上游仍在开发预览，界面与凭据方式可能变化，应以安装版本及 [官方文档](https://deepseek-harness.github.io/deepseek-harness/) 为准。

先确认官方 Harness 本身可以访问模型；如要在官方 Web UI 发测试消息，按官方教程选择一个工作区。本项目默认引用当前用户的 `%USERPROFILE%\.dsh\.credentials.yaml`，并在自己的独立数据目录保存会话，不需要复制账号文件进程序目录。不要把这个凭据文件发到 Issue 或放进发布包。

配置完成后可关闭用于设置的官方 Web UI。助手会启动自己隔离的 Harness 运行时，不要求一直保留那个3080网页。

## 4. 检查环境和自定义安装路径

双击 `check-environment.cmd`，或在项目目录运行：

```powershell
powershell -NoProfile -File .\check-environment.ps1
```

若使用便携版 Node、非默认 Edge 或 Lively 安装目录，将根目录的 `companion-settings.example.json` 复制为 `companion-settings.local.json`，填写实际路径。六个字段均可留空自动发现：

| 字段 | 路径含义 |
| --- | --- |
| `livelyExe` | Lively可执行文件 |
| `edgeExe` | Edge可执行文件 |
| `nodeExe` | Node可执行文件 |
| `dshPackageRoot` | 官方Harness包根目录，包含 `package.json` 和 `lib/bin.js` |
| `livelyDataRoot` | Lively设置/布局数据目录 |
| `livelyLibraryRoot` | Lively壁纸库目录 |

支持绝对路径或相对于程序目录的路径，不展开 `%LOCALAPPDATA%` 等环境变量写法。JSON 中 Windows 反斜杠要写成 `\\`，也可以用 `/`。此文件只配置本机路径，不放账号凭据。环境检查只读文件元数据，不运行 Node/Harness、不读取凭据；PowerShell 检查还支持 `-Json`，出现 FAIL 退出1，仅 WARN 退出0。

默认自动查找常见的 Node/Edge 安装路径，Lively 默认位置是 `%LOCALAPPDATA%\Programs\Lively Wallpaper\Lively.exe`。Microsoft Store 版或自定义安装版能否完成命令挂载仍需在你的机器验证；找不到路径时先使用上述覆盖项。

## 5. 启动与聊天

完整包中，在程序目录打开 PowerShell：

```powershell
.\deepseek-launcher-v4.exe start
.\deepseek-launcher-v4.exe chat
```

| 操作 | EXE 参数 | 可直接双击的 CMD |
| --- | --- | --- |
| 启动主屏房间 | `start` | `start-deepseek-wallpaper-v3.cmd` |
| 打开聊天；房间停止时也会启动房间 | `chat` | `start-deepseek-chat-v4.cmd` |
| 关闭本项目壁纸并停后台 | `stop` | `stop-deepseek-wallpaper-v3.cmd` |

EXE 必须带上参数；直接双击无参数 EXE 不是上述三个操作的替代。源码包没有 EXE 时，直接使用表内 CMD 即可。源码文件的 v1/v3/v4 后缀是内部历史命名，公开发布版本为 v1.0.0。

服务绑定本机 `127.0.0.1`，启动脚本在17865—17869间寻找可用端口。房间和聊天必须连接同一个本地服务。不要双击 `room-companion-v1.html`、`deepseek-chat-v1.html`，也不要同时打开多个 `/room` 页面；当前桌面模式期望一个房间控制连接。

可运行以下命令创建桌面快捷方式：

```powershell
powershell -NoProfile -File .\install-deepseek-shortcuts-v4.ps1
```

会创建“DeepSeek 互动壁纸”“DeepSeek 聊天”“停止 DeepSeek 壁纸”。它不写入开机启动。快捷方式引用当前解压目录，移动整个目录后需要重新创建。

## 6. 停止与本地数据

关闭聊天窗口只关闭窗口。在 Lively 中关闭壁纸只关闭显示，后台可能继续运行。完整停止使用：

```powershell
.\deepseek-launcher-v4.exe stop
```

或双击 `stop-deepseek-wallpaper-v3.cmd`。如果已经在 Lively 中关闭了房间，可使用 `stop-deepseek-chat-v1.cmd` 单独停止后台。不要通过结束所有 `node.exe` 来停止本项目。

标准启动脚本将运行数据保存在 `%USERPROFILE%\.deepseek-wallpaper-companion`，包括可见聊天记录、独立 Harness 会话、运行状态与日志；程序 ZIP 不包含这些数据。直接调用服务器的开发用法有不同默认数据目录，开发时请显式指定 `--data-root` 并使用隔离目录。

“清空聊天记录”只清空界面和本项目可见记录，**仍保留模型会话记忆**；它不是删除所有个人数据的按钮。本版没有一键彻底重置记忆界面。备份、迁移或重置会话前，先完整停止程序，并自行妥善处理数据目录，勿把整个目录上传到公开仓库。
