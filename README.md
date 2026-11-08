# DeepSeek 桌面房间助手

一个 Windows 互动壁纸原型：角色住在桌面房间里，在独立窗口接收消息，拿手机阅读、打字，再回到桌前或床上休息。默认角色叫“小鲸”，绰号“大肥鱼”，偏好简短中文回复。

```text
桌前待机 A ↔ 持机 B ↔ 平板关闭 C ↔ 床沿 D ↔ 床上持机 E ↔ 睡眠 F
```

本项目连接官方 [DeepSeek Harness](https://github.com/deepseek-ai/deepseek-harness)，通过 Lively Wallpaper 承载房间。它不附带模型账号、API 凭据或免费额度；模型服务由使用者自行配置，费用与可用性以服务方为准。代码采用 [MIT](LICENSE)，图片、视频等素材另见 [素材说明](ASSET-NOTICE.md)，不自动适用代码许可。**示例角色媒体的公开分发授权仍待确认；源码可单独公开，不附美术。**发布者应确认素材权利后再公开素材包/完整包，也可换用自己有权分发的角色。

## 先体验

1. 若发布者已提供取得分发授权的完整包，Windows 用户优先下载 `deepseek-desktop-companion-complete-v1.0.0.zip`，解压到固定目录。源码用户先准备自己有权使用的素材。
2. 按 [安装教程](docs/INSTALL.zh-CN.md) 准备 Node.js、Microsoft Edge、WebView2、Lively，以及官方 Harness 凭据。
3. 双击 `check-environment.cmd` 检查环境。
4. 在该目录打开 PowerShell，依次运行：

   ```powershell
   .\deepseek-launcher-v4.exe start
   .\deepseek-launcher-v4.exe chat
   ```

`start` 连接主屏桌面房间，`chat` 打开独立聊天窗口。也可使用 `start-deepseek-wallpaper-v3.cmd` 和 `start-deepseek-chat-v4.cmd`。**不要双击 HTML 文件代替启动服务。**

第一次试试“你好”“去睡觉”“起床工作”。发送普通问题时，角色会到桌前或床上的持机姿态，完成本轮真实手机打字后显示回复；模型尚未完成时会继续等待。房间必须正常播放，回复不会绕过打字结束条件。

## 下载哪个包

| 文件 | 内容 | 用途 |
| --- | --- | --- |
| `deepseek-desktop-companion-complete-v1.0.0.zip` | 程序、文档、21 件媒体和 Windows EXE | Windows 首次体验 |
| `deepseek-desktop-companion-source-v1.0.0.zip` | 源码、文档；无图片/视频、无编译 EXE | 阅读、修改、构建，可单独公开 |
| `deepseek-desktop-companion-assets-v1.0.0.zip` | 两个媒体目录、媒体清单、素材说明 | 给源码包补素材 |

源码包与已取得使用权的素材包解压到**同一个程序目录**，保持相对路径合并，见 [安装教程](docs/INSTALL.zh-CN.md)。这些 ZIP 内没有额外套一层项目目录。仓库本身也不包含图片/视频和编译 EXE；补齐素材后可直接用 CMD 启动，或运行构建脚本生成 EXE。表中的媒体包名称描述打包形态，不表示当前已经公开发布或获得分发授权。

## 当前行为与边界

- 房间包含六种姿态，走固定路径 `A ↔ B ↔ C ↔ D ↔ E ↔ F`。现有片段支持拿放手机、开关平板、往返床边、躺下、入睡及阅读/睡眠循环，详见 [动画说明](docs/ANIMATION.zh-CN.md)。写一句新动作不会自动生成相应动画。
- 动作目标使用关键词的**字面最后命中**：`起床`、`桌`、`上班`、`加班`、`工作` → 桌前 A；`床`、`睡` → 睡觉 F。`起床` 作为完整词优先匹配；无命中保持原目标。它不理解否定或引号，例如“不要睡”仍会命中“睡”。
- “清空聊天记录”只清空可见记录，模型会话记忆保留。关闭聊天窗口也不等于停止后台。
- 时间来自新时钟快照及时间工具读取，回复还要等待生成、动画和显示，所以只能说明读取时刻，不能保证显示瞬间零延迟。
- 当前为 Windows 原型，围绕 Lively 2.2.1.0、Edge/WebView2 和 `@deepseek-ai/dsh@0.2.1-rc.2` 验证。生成动画仍可能有姿态、手部、亮度和接点偏差；本版不承诺所有接点完全无缝。

## 教程

| 想做什么 | 文档 |
| --- | --- |
| 安装、配置凭据、启动、停止 | [安装教程](docs/INSTALL.zh-CN.md) |
| 理解状态、动作路由和打字同步 | [动画说明](docs/ANIMATION.zh-CN.md) |
| 换自己的角色、房间和人设 | [自定义教程](docs/CUSTOMIZE.zh-CN.md) |
| 生成六张姿态图和15段视频 | [提示词入口](prompts/README.md) |
| 复建 ZIP、准备 GitHub Release | [发布教程](docs/PUBLISH.zh-CN.md) |
| 黑屏、找不到依赖、只打字不回复 | [排错](docs/TROUBLESHOOTING.zh-CN.md) |

## 停止

```powershell
.\deepseek-launcher-v4.exe stop
```

这个操作关闭本项目壁纸并停止本地后台；对应 CMD 是 `stop-deepseek-wallpaper-v3.cmd`。如果仅在 Lively 中关闭壁纸，后台可能继续运行，可再用 `stop-deepseek-chat-v1.cmd` 停止后台。无需结束所有 Node 或 Lively 进程。

快捷方式可通过 `install-deepseek-shortcuts-v4.ps1` 创建；它不设置开机自启。更多数据位置与日志说明见 [安装教程](docs/INSTALL.zh-CN.md)。

## 开发检查

本项目建议 Node.js 24 LTS，项目检查最低要求 Node.js 22.12.0；这不是对上游 Harness 顶层包最低版本的承诺。

```powershell
npm run check
npm run verify:media
npm test
python scripts/package-release.py
```

`check` 允许源码目录缺少媒体；`verify:media` 要求完整21件媒体；测试使用隔离的假运行时，不登录模型账号。发布命令与素材重建要求见 [发布教程](docs/PUBLISH.zh-CN.md)。

视频提示词的方法参考 Serge Shima / [smixs/visual-skills](https://github.com/smixs/visual-skills)，[CC BY 4.0](https://creativecommons.org/licenses/by/4.0/)。本项目将其方法改写为中文单镜头、首尾帧及接点验收流程；该署名不代表作者为本项目背书。
