# 本地数据与隐私

公开包只含程序、教程、示例路径配置和指定的美术素材。每位使用者在自己的电脑安装并配置官方 Harness；本项目不提供共享账号、API key 或模型额度。

启动脚本通常将本应用运行数据放在 `%USERPROFILE%\.deepseek-wallpaper-companion`，包括聊天显示记录、独立模型会话/记忆、角色状态和诊断日志。直接通过 Node CLI 启动并省略 `--data-root` 时会使用 `%LOCALAPPDATA%\DeepSeekWallpaperCompanion`。官方 Harness 凭据保留在其自己的用户目录，程序在运行时引用，不会写进源码或素材包。

聊天内容会交给使用者自行配置的模型服务；使用搜索/网页功能时也会访问相应网络服务。本地网页服务仅监听 `127.0.0.1`，请勿将其映射到公网或共享不受信任的电脑账户。

“清空聊天记录”只清空界面历史，不清除模型记忆。重新生成素材、重新解压源码或关闭窗口也不代表清空记忆。

## 分享前检查

1. 在只含源码的目录运行 `npm run check`；配齐21项媒体后运行 `npm run verify:media`。
2. 使用 `python scripts/package-release.py` 按明确文件清单生成发布包。不要自行压缩用户主目录、`.dsh`、运行数据目录、整个工作区或 `node_modules`。
3. 不要上传 `companion-settings.local.json`、`.env`、任何 credentials 文件、`chat-ledger-*.json`、`companion-session-*.json`、`harness-home/`、JSONL 会话、日志、数据库或聊天录屏。
4. 问题反馈只提供错误提示、程序版本及环境检查结果；先检查截图与日志是否含路径、账号和消息正文。

如发现误提交的真实凭据，应在对应服务撤销/轮换，并清理已公开内容及历史。请勿在公开 Issue 中贴出凭据。
