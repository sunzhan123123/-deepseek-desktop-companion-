# 常见问题与排错

[返回首页](../README.md) · [安装教程](INSTALL.zh-CN.md) · [状态说明](ANIMATION.zh-CN.md)

先双击 `check-environment.cmd`，确认完整解压、依赖路径和媒体目录。需要看启动错误时，在项目目录的 PowerShell 运行对应 `.cmd` 或 `.ps1`，保留本次错误文字。避免连续启动多个副本。

| 现象 | 优先处理 |
| --- | --- |
| 双击HTML后连不上、文件打不开 | 关闭这个页面，使用启动器或 CMD 启动本地 HTTP 服务。`file://` 不能代替服务。 |
| 找不到 Node/Edge/Lively | 安装依赖；自定义路径填根目录 `companion-settings.local.json` 的 `nodeExe`、`edgeExe`、`livelyExe`。从示例复制，留空自动发现，不放凭据。 |
| 找不到官方 Harness 或 SDK | 安装已验证版本 `npm install -g @deepseek-ai/dsh@0.2.1-rc.2`；确认 npm 使用的是预期 Node。自定义路径可设置 `companion-settings.local.json` 的 `dshPackageRoot`。 |
| EXE不存在 | 源码包不带编译 EXE。直接用 CMD，或运行 `build-launcher.ps1`。 |
| 直接双击EXE报参数错误 | 使用 `start` / `chat` / `stop` 参数，或创建桌面快捷方式。 |
| 首次打开Lively黑屏/未连接 | 单独打开 Lively 完成初始设置，检查 WebView2，再运行启动器。 |
| 提示素材未能播放 | 源码包需要合并素材包；核对两个媒体目录都位于程序根目录，运行 `npm run verify:media`。 |
| 只有打字，迟迟不显示回复 | 模型未完成或视频未自然结束都会等待。先恢复房间播放、网络和模型连接；不要以删同步判断来强制显示。 |
| 切换全屏程序后停住 | 检查 Lively 的壁纸暂停规则；若房间出现“继续动画”，按提示恢复。动画暂停时打字结束条件也未满足。 |
| 提示房间已连接/重复控制 | 关闭额外 `/room` 浏览器页或重复壁纸，只保留主屏这一个房间连接。 |
| 提示服务端口不一致 | 完整停止本项目再重新启动；不要手动同时打开不同端口的聊天与房间。 |
| “不要睡”仍去睡觉 | 当前按字面关键词最后命中，否定和引号也会命中。详见状态说明。 |
| 清空聊天后仍记得之前内容 | 按设计只清可见记录，模型会话记忆保留；不是彻底重置按钮。 |
| 关闭聊天后后台仍在 | 用 `stop-deepseek-wallpaper-v3.cmd` 完整停止。只关壁纸后也可用 `stop-deepseek-chat-v1.cmd` 停后台。 |
| 新角色出现局部拉伸/右下角修补异常 | 原呼吸遮罩与地板处理按旧图坐标编写，需按自定义教程适配；不是视频文件损坏的唯一可能。 |

## 模型连接与凭据

先用安装版本的官方 Web UI 确认账号/凭据可用，再检查本项目。官方入口：

```powershell
npx @deepseek-ai/dsh@0.2.1-rc.2 web
```

按 [官方 Web UI 教程](https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/index.md) 配置模型。不要猜测 `dsh login` 等子命令，也不要在 Issue 中粘贴凭据文件。配置或续期后完整停止并重新启动助手；当前凭据插件不是动态监听模式。

运行时默认读取当前用户 `.dsh/.credentials.yaml`，若你只在另一用户账号、另一个主目录或不同凭据路径完成设置，助手可能找不到它。不要通过把凭据拷进公开项目解决；先核对实际运行的 Windows 用户与官方安装。

如果 Harness 安装在自定义 npm 前缀，优先在 `companion-settings.local.json` 的 `dshPackageRoot` 指定包根目录。也可在**同一个 PowerShell 窗口**先设置环境变量，然后启动：

```powershell
$env:DSH_PACKAGE_ROOT = 'C:/your/npm-prefix/node_modules/@deepseek-ai/dsh'
.\start-deepseek-chat-v4.cmd
```

将示例路径替换成真实包目录，其下应有 `package.json` 与 `lib/bin.js`。桌面快捷方式不会继承另一个已打开终端中临时设置的变量；自定义部署推荐使用本机设置文件。设置文件另支持 `livelyDataRoot` / `livelyLibraryRoot`；所有路径支持绝对或相对程序目录写法，不展开 `%变量%`。

## 日志在哪里

标准 Windows 启动脚本的数据目录为 `%USERPROFILE%\.deepseek-wallpaper-companion`，常用日志：

- `server.stderr.log`、`server.stdout.log`：本地服务启动及异常。
- `launcher-start-last.log`、`launcher-chat-last.log`、`launcher-stop-last.log`：原生启动器最近一次结果。

目录还包含聊天、会话与运行状态。报告问题时只整理相关错误、操作系统、Node版本、Harness版本、Lively版本、复现步骤和媒体校验结果；不要直接上传整个数据目录。必要日志先去掉账号、令牌、私人路径和聊天内容。

## 只检查源码能否用

```powershell
node --version
npm run check
npm test
```

测试使用隔离假运行时，所以通过测试也不能证明真实凭据、网络和 Lively 已经正常。完整媒体检查另运行 `npm run verify:media`。若自定义了媒体，发布清单哈希不匹配可能表示你确实换了文件，而非传输损坏；先保留副本再检查。

## 卸载或迁移

先用 `stop` 完整停止，再关闭聊天窗口。程序本体可作为整个目录移动；移动后重新创建快捷方式。本项目数据和官方 Harness 凭据在程序目录之外，不会随着删除 ZIP 或源码自动消失。“清空聊天记录”也不会清除这些独立数据。处理本地数据前自行备份并确认需要保留的内容。
