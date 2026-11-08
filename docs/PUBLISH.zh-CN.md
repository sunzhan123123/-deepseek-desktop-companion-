# 复建与发布

[返回首页](../README.md) · [素材说明](../ASSET-NOTICE.md)

这里说明如何把准备好的项目发布到你自己的 GitHub 仓库。本项目文档不会替你创建仓库或执行远程发布，也没有预填一个不存在的仓库地址。

## 发布前的目录

GitHub 仓库和源码 ZIP 保留程序源码、CMD/PowerShell、教程、提示词、检查与打包脚本；不包含任何图片/视频、编译 EXE、账号、聊天或记忆。完整包额外包含媒体和重建后的 EXE。素材包包含两个媒体目录、`assets/media-manifest.json` 与 `ASSET-NOTICE.md`。

当前示例角色媒体的公开分发授权仍待确认。源码可以单独公开；生成素材/完整 ZIP 只完成本地打包，**不等于可以公开上传这些包**。公开媒体前确认相应权利，或换成自己有权分发的角色和房间。未确认时，仅上传源码包与源码仓库，不上传示例媒体、完整包或角色预览。

文件后缀中的 v1/v3/v4 是现有程序内部命名，首个公开发行版本为 **v1.0.0**。不要仅为统一版本号而改名，否则 HTML、脚本和快捷方式的引用也要逐项改动。

先确认 [LICENSE](../LICENSE) 与 [ASSET-NOTICE.md](../ASSET-NOTICE.md) 适用于你的分发内容。MIT 代码许可不会自动授权角色、图片、视频、商标、音乐或第三方参考图。替换了角色/素材时，更新它们各自的来源与许可；只分发你有权分发的文件。

## 运行检查

在项目根目录使用 Node.js 22.12.0或更新版本，建议24 LTS；打包另外需要 Python 3。

```powershell
npm run check
npm run verify:media
npm test
powershell -NoProfile -File .\build-launcher.ps1
python scripts/package-release.py
```

| 命令 | 验证范围 |
| --- | --- |
| `npm run check` | 源码/发布结构；允许源码模式缺少21件媒体 |
| `npm run verify:media` | 完整媒体目录与清单，要求21件媒体齐全 |
| `npm test` | 隔离的假运行时测试，不登录真实模型账号 |
| `build-launcher.ps1` | 从 C# 源码编译 Windows EXE |
| `package-release.py` | 按发布规则重建三个 ZIP |

只有源码时先合并素材包，再做 `verify:media` 与完整打包。使用脚本的 `--help` 查看当前可用参数；不要假定打包脚本会替你下载媒体、补凭据或修复生成动画。

测试覆盖程序的部分行为，不能替代真实 Windows 桌面、Lively、Edge/WebView2 和官方模型连接验收。正式发布前至少在一个干净目录按 [安装教程](INSTALL.zh-CN.md) 重走启动、聊天、睡觉、起床与停止流程。不要将“测试通过”写成所有电脑都可用。

## 三个固定发布件

打包脚本默认输出到程序目录旁的 `deepseek-desktop-companion-release` 目录：

```text
deepseek-desktop-companion-source-v1.0.0.zip
deepseek-desktop-companion-assets-v1.0.0.zip
deepseek-desktop-companion-complete-v1.0.0.zip
```

检查 ZIP 目录表，确认它们按程序根目录存放，没有多套一层父目录。把源码包与素材包解压到同一新目录，应得到完整的相对路径布局；完整包应能独立解压使用。确认源码包没有21件媒体与 EXE，完整包中的 EXE 对应本次源码构建。

## 建立自己的 GitHub 仓库

1. 在 GitHub 创建你自己的仓库，填写真实名称和简介。上传/提交项目源码目录，保留 `.gitignore`。
2. 使用 `git status` 查看将要提交的文件。不要加入 `%USERPROFILE%\.deepseek-wallpaper-companion`、`.dsh`、`companion-settings.local.json`、运行日志、浏览器配置、私人图片或带聊天内容的截图；也不要把 `node_modules` 或整个本机目录拖进仓库。
3. 在 GitHub 的 Releases 创建标签 `v1.0.0`，标题可用“DeepSeek Desktop Companion v1.0.0”。
4. 将已确认可以公开的具名 ZIP 添加为附件。当前可先发布源码；只有素材授权确认后才添加素材/完整包。GitHub 自动产生的“Source code (zip)”只是仓库快照，不含21件媒体；已获授权的完整包适合普通用户体验。
5. 发布说明写清已验证的依赖版本、自己的素材许可、已知接点问题、凭据需自备，并链接仓库的安装与排错文档。不要写“所有素材开源”“自带免费 API”或“全平台支持”，除非你确有相应证据与授权。

可使用以下简短发布说明，按实际验收改写后再提交：

```text
Windows 互动壁纸原型，包含六种姿态、手机阅读/打字与桌床往返。

本次公开范围：[按实际填写，仅源码／含已获授权的素材与完整包]。
如提供完整包，首次体验请下载 deepseek-desktop-companion-complete-v1.0.0.zip。
源码用户需将 source 与有权使用的 assets 包解压到同一个目录，或制作自己的素材。
需自行安装 Node.js、Edge/WebView2、Lively，并配置官方 DeepSeek Harness 凭据。

代码采用 MIT；媒体许可与来源见 ASSET-NOTICE.md。
当前动画可能存在手部、亮度或接点差异；已验证范围以本次验收记录为准。
```

当前源码仓库不附角色预览图；可用文字状态图说明工作流程。以后加入预览时，既要确认图片可分发，也要确保不含聊天、凭据或私人窗口。
