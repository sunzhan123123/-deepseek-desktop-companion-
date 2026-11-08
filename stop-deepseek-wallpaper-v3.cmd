@echo off
setlocal
if exist "%~dp0deepseek-launcher-v4.exe" (
  start "" "%~dp0deepseek-launcher-v4.exe" stop
  if errorlevel 1 (
    echo The wallpaper stop launcher could not open.
    pause
    exit /b 1
  )
  exit /b 0
)
powershell.exe -NoLogo -NoProfile -File "%~dp0stop-deepseek-wallpaper-v3.ps1"
set "companionExit=%errorlevel%"
if not "%companionExit%"=="0" (
  echo The wallpaper stop operation failed. Read the PowerShell error above.
  pause
)
exit /b %companionExit%
