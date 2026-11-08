@echo off
setlocal
if exist "%~dp0deepseek-launcher-v4.exe" (
  start "" "%~dp0deepseek-launcher-v4.exe" chat
  if errorlevel 1 (
    echo The chat launcher could not open.
    pause
    exit /b 1
  )
  exit /b 0
)
powershell.exe -NoLogo -NoProfile -File "%~dp0start-deepseek-chat-v4.ps1"
set "companionExit=%errorlevel%"
if not "%companionExit%"=="0" (
  echo The chat operation failed. Read the PowerShell error above.
  pause
)
exit /b %companionExit%
