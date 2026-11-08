@echo off
setlocal
if exist "%~dp0deepseek-launcher-v4.exe" (
  start "" "%~dp0deepseek-launcher-v4.exe" start
  if errorlevel 1 (
    echo The desktop wallpaper launcher could not open.
    pause
    exit /b 1
  )
  exit /b 0
)
powershell.exe -NoLogo -NoProfile -File "%~dp0start-deepseek-wallpaper-v3.ps1" -NoChat
set "companionExit=%errorlevel%"
if not "%companionExit%"=="0" (
  echo The desktop wallpaper operation failed. Read the PowerShell error above.
  pause
)
exit /b %companionExit%
