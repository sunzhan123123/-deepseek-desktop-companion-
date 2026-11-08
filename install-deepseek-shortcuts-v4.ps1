param()

$ErrorActionPreference = 'Stop'
$companionExecutable = Join-Path $PSScriptRoot 'deepseek-launcher-v4.exe'
if (-not (Test-Path -LiteralPath $companionExecutable -PathType Leaf)) { throw 'The native launcher is missing. Extract the complete companion package into one directory.' }
$companionDesktop = [Environment]::GetFolderPath('Desktop')
$companionShell = New-Object -ComObject WScript.Shell
$companionLinks = @(
    @{Name='DeepSeek 互动壁纸';Action='start';Description='连接主屏桌面房间，显示启动结果；聊天从独立快捷方式打开'},
    @{Name='停止 DeepSeek 壁纸';Action='stop';Description='仅停止本项目的壁纸和本地服务，显示停止结果'},
    @{Name='DeepSeek 聊天';Action='chat';Description='打开并连接原来的对话；房间停止时自动连接桌面宿主'}
)
foreach ($companionEntry in $companionLinks) {
    $companionPath = Join-Path $companionDesktop ($companionEntry.Name + '.lnk')
    $companionShortcut = $companionShell.CreateShortcut($companionPath)
    $companionShortcut.TargetPath = $companionExecutable
    $companionShortcut.Arguments = $companionEntry.Action
    $companionShortcut.WorkingDirectory = $PSScriptRoot
    $companionShortcut.WindowStyle = 1
    $companionShortcut.IconLocation = $companionExecutable + ',0'
    $companionShortcut.Description = $companionEntry.Description
    $companionShortcut.Save()
    Write-Output ('Desktop shortcut ready: ' + $companionPath)
}
